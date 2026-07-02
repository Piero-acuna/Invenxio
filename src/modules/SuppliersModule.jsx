// ─────────────────────────────────────────────────────────────────────────────
// src/modules/SuppliersModule.jsx
// Módulo 3 — Proveedores: catálogo de proveedores, compras a proveedor con
// destino a almacén, ventas de almacén a proveedor y su cancelación.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";
import {
  X, Plus, Package, Truck, History, ArrowUpCircle, AlertTriangle, CheckCircle,
  Edit3, Users, TrendingUp, Trash2, Phone, MapPin, FileText, Clock, Receipt,
  Send, Tag, Calendar, Loader2, FileSpreadsheet,
} from "lucide-react";
import {
  addSupplier, updateSupplier, deleteSupplier,
  recordWarehousePurchase,
  updateSupplierSaleStatus, sellWarehouseToSupplier, cancelSupplierSale,
  subscribeToLocations, subscribeToWarehouseStock, subscribeToWarehouseProducts,
  addWarehouseProduct, updateWarehouseProduct,
  getNextInvoiceNumber,
} from "../services/firestoreService";
import { exportToExcel } from "../utils/exportExcel";
import { generateInvoicePDF } from "../utils/generateInvoicePDF";
import { useCollection } from "../hooks/useCollection";
import { StatusBadge, Spinner } from "../components/shared/StatusUI";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — SUPPLIERS
// ══════════════════════════════════════════════════════════════════════════════
const SuppliersModule = ({ companyId, userName, canManageSuppliers, canDelete, canViewFinance, billing }) => {
  const [suppliers,     loadingSup] = useCollection(companyId, "suppliers",     "name");
  const [supplierSales, loadingSS]  = useCollection(companyId, "supplierSales", "createdAt");
  const [products]                  = useCollection(companyId, "products",      "name");
  const [transactions]              = useCollection(companyId, "transactions",  "createdAt");

  // Productos y stock del ALMACÉN — lo que se vende a los proveedores.
  const [warehouseProducts,  setWarehouseProducts]  = useState([]);
  const [warehouseStock,     setWarehouseStock]     = useState([]);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  useEffect(() => {
    if (!companyId) return;
    const u1 = subscribeToWarehouseProducts(companyId, setWarehouseProducts);
    const u2 = subscribeToWarehouseStock(companyId, setWarehouseStock);
    const u3 = subscribeToLocations(companyId, setWarehouseLocations);
    return () => { u1(); u2(); u3(); };
  }, [companyId]);
  const stockByProduct = useMemo(() => {
    const map = {};
    warehouseStock.forEach(s => {
      if (!map[s.productId]) map[s.productId] = [];
      map[s.productId].push(s);
    });
    return map;
  }, [warehouseStock]);

  const [supTab,       setSupTab]      = useState("list");
  const [showModal,    setShowModal]   = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [selSupplier,  setSelSupplier] = useState(null);
  const [detailTab,    setDetailTab]   = useState("ventas"); // "ventas" | "ordenes" | "nueva" | "info"
  const EMPTY_FORM = { name: "", ruc: "", contact: "", phone: "", address: "", productIds: [], status: "Activo" };
  const [form,         setForm]        = useState(EMPTY_FORM);
  const [saving,       setSaving]      = useState(false);

  const [ssForm,    setSsForm]    = useState({ supplier: "", product: null, productSearch: "", locationId: "", qty: "", unitPrice: "", note: "", status: "Entregado" });
  const [ssSaving,  setSsSaving]  = useState(false);
  const [ssSuccess, setSsSuccess] = useState(false);
  const [ssError,   setSsError]   = useState("");
  const ssFiltered = ssForm.productSearch && !ssForm.product
    ? warehouseProducts.filter(p => p.name?.toLowerCase().includes(ssForm.productSearch.toLowerCase()))
    : [];
  // Stock disponible del producto de almacén elegido, en la ubicación elegida
  const ssFromStock = ssForm.product && ssForm.locationId
    ? (stockByProduct[ssForm.product.id] || []).find(s => s.locationId === ssForm.locationId)
    : null;

  // ── Registrar Compra de Proveedor (nivel superior, no depende de abrir un proveedor) ──
  const warehousePurchases = useMemo(
    () => transactions.filter(t => t.type === "compra" && t.target === "almacen"),
    [transactions]
  );
  const [pForm,    setPForm]    = useState({ supplier: "", product: null, productSearch: "", locationId: "", packCount: "", unitCost: "", note: "" });
  const [pSaving,  setPSaving]  = useState(false);
  const [pSuccess, setPSuccess] = useState(false);
  const [pError,   setPError]   = useState("");
  const [pMsg,     setPMsg]     = useState(""); // mensaje sobre coincidencia de costo — siempre se muestra
  const pFiltered = pForm.productSearch && !pForm.product
    ? warehouseProducts.filter(p => p.name?.toLowerCase().includes(pForm.productSearch.toLowerCase()))
    : [];

  const handleSupplierPurchase = async () => {
    setPError(""); setPMsg("");
    if (!pForm.supplier || !pForm.product || !pForm.locationId || !pForm.packCount || !pForm.unitCost) return;
    setPSaving(true);
    try {
      const sup   = suppliers.find(s => s.name === pForm.supplier);
      const loc   = warehouseLocations.find(l => l.id === pForm.locationId);
      const qty   = Number(pForm.packCount);
      const cost  = Number(pForm.unitCost);

      // ── Validación de costo por empaque ──────────────────────────────────
      // El costo ingresado tiene que coincidir con el costo registrado para
      // este producto de almacén. Si es la primera compra, se establece como
      // referencia. Si no coincide con una compra anterior, en vez de
      // mezclar costos distintos bajo el mismo producto, se crea un nuevo
      // producto de almacén con ese costo — así el stock y el costo promedio
      // no se distorsionan. Siempre se muestra un mensaje explicando qué pasó.
      let targetProduct = pForm.product;
      let msg = "";
      const storedCost = pForm.product.cost != null ? Number(pForm.product.cost) : null;

      if (storedCost === null) {
        await updateWarehouseProduct(companyId, pForm.product.id, { cost });
        msg = `Costo de referencia registrado: S/ ${cost.toFixed(2)} por ${pForm.product.packName}.`;
      } else if (Math.round(storedCost * 100) !== Math.round(cost * 100)) {
        const newName = `${pForm.product.name} (S/ ${cost.toFixed(2)})`;
        const newRef  = await addWarehouseProduct(companyId, {
          name: newName,
          sku: pForm.product.sku || "",
          packName: pForm.product.packName,
          packQty: pForm.product.packQty,
          unitPrice: pForm.product.unitPrice || null,
          cost,
        });
        targetProduct = { id: newRef.id, name: newName, sku: pForm.product.sku, packName: pForm.product.packName, packQty: pForm.product.packQty };
        msg = `⚠️ El costo ingresado (S/ ${cost.toFixed(2)}) no coincide con el registrado para "${pForm.product.name}" (S/ ${storedCost.toFixed(2)}). Se creó un nuevo producto de almacén: "${newName}" y la compra se registró ahí.`;
      } else {
        msg = `✅ El costo coincide con el registrado (S/ ${cost.toFixed(2)} por ${pForm.product.packName}).`;
      }

      const total = await recordWarehousePurchase(companyId, {
        supplierId: sup?.id || "", supplierName: pForm.supplier,
        warehouseProductId: targetProduct.id, warehouseProductName: targetProduct.name, sku: targetProduct.sku || "",
        locationId: pForm.locationId, locationName: loc?.name || "",
        packCount: qty, packName: targetProduct.packName, packQty: targetProduct.packQty,
        unitCost: cost, note: pForm.note, userName,
      });
      setPSuccess(true);
      setPMsg(msg);
      await emitInvoice({
        partyName: pForm.supplier,
        items: [{ name: targetProduct.name, qty, unitPrice: cost, total }],
        total, note: pForm.note,
      });
      setTimeout(() => { setPSuccess(false); setPMsg(""); setPForm({ supplier: "", product: null, productSearch: "", locationId: "", packCount: "", unitCost: "", note: "" }); }, 5000);
    } catch (err) {
      console.error(err);
      setPError(err?.message || "Error al registrar la compra.");
    }
    setPSaving(false);
  };

  const [saveError, setSaveError] = useState("");

  const handleSaveSupplier = async () => {
    if (!form.name || !form.contact) return;
    setSaveError("");
    setSaving(true);
    try {
      const products = form.productIds
        .map(id => warehouseProducts.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({ id: p.id, name: p.name }));
      if (editSupplier) {
        if (!editSupplier.id) throw new Error("ID del proveedor no encontrado");
        await updateSupplier(companyId, editSupplier.id, {
          name:    form.name,
          ruc:     form.ruc,
          contact: form.contact,
          phone:   form.phone,
          address: form.address,
          products,
          status:  form.status,
        });
      } else {
        await addSupplier(companyId, {
          name:    form.name,
          ruc:     form.ruc,
          contact: form.contact,
          phone:   form.phone,
          address: form.address,
          products,
          status:  "Activo",
        });
      }
      setForm(EMPTY_FORM);
      setEditSupplier(null);
      setShowModal(false);
    } catch (err) {
      console.error("Error guardando proveedor:", err);
      setSaveError(err?.message || "Error al guardar. Revisa la consola.");
    }
    setSaving(false);
  };

  const handleToggleSupplierStatus = async (e, s) => {
    e.stopPropagation();
    const next = s.status === "Activo" ? "Inactivo" : "Activo";
    try { await updateSupplier(companyId, s.id, { status: next }); }
    catch (err) { console.error("Error cambiando estado:", err); }
  };

  const handleDeleteSupplier = async (supplier) => {
    if (!supplier) return;
    if (window.confirm(`¿Estás seguro de que quieres eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`)) {
      try {
        await deleteSupplier(companyId, supplier.id);
      } catch (err) {
        console.error("Error deleting supplier:", err);
        alert("Hubo un error al eliminar el proveedor.");
      }
    }
  };

  const handleSupplierSale = async () => {
    setSsError("");
    if (!ssForm.supplier || !ssForm.product || !ssForm.locationId || !ssForm.qty || !ssForm.unitPrice) return;
    const qty = Number(ssForm.qty);
    if (ssFromStock && qty > ssFromStock.qty) {
      setSsError(`Solo hay ${ssFromStock.qty} ${ssForm.product.packName} disponibles en esa ubicación.`);
      return;
    }
    setSsSaving(true);
    try {
      const loc = warehouseLocations.find(l => l.id === ssForm.locationId);
      await sellWarehouseToSupplier(companyId, {
        warehouseProductId: ssForm.product.id, warehouseProductName: ssForm.product.name, sku: ssForm.product.sku || "",
        locationId: ssForm.locationId, locationName: loc?.name || "",
        packCount: qty, packName: ssForm.product.packName, packQty: ssForm.product.packQty,
        unitPricePerPack: Number(ssForm.unitPrice), supplierName: ssForm.supplier,
        note: ssForm.note, userName, status: ssForm.status,
      });
      setSsSuccess(true);
      if (ssForm.status === "Entregado") {
        await emitInvoice({
          partyName: ssForm.supplier,
          items: [{ name: ssForm.product.name, qty, unitPrice: Number(ssForm.unitPrice), total: qty * Number(ssForm.unitPrice) }],
          total: qty * Number(ssForm.unitPrice),
          note: ssForm.note,
        });
      }
      setTimeout(() => { setSsSuccess(false); setSsForm({ supplier: "", product: null, productSearch: "", locationId: "", qty: "", unitPrice: "", note: "", status: "Entregado" }); }, 2500);
    } catch (err) {
      console.error(err);
      setSsError(err?.message || "Error al registrar la venta.");
    }
    setSsSaving(false);
  };

  const totalSales   = supplierSales.reduce((s, r) => s + r.total, 0);
  const pendingCnt   = supplierSales.filter(r => r.status === "Pendiente").length;
  const deliveredCnt = supplierSales.filter(r => r.status === "Entregado").length;
  const cancelledCnt = supplierSales.filter(r => r.status === "Cancelado").length;

  // ── Marcar como Entregado + emitir comprobante de compra en PDF ───────────
  const [invoiceMsgSupplier, setInvoiceMsgSupplier] = useState("");

  // Comprobante reutilizable — lo usan tanto compras a proveedor (almacén)
  // como ventas a proveedor, para que TODA operación con proveedores emita
  // su comprobante automáticamente.
  async function emitInvoice({ partyName, items, total, note }) {
    if (!billing?.razonSocial) {
      setInvoiceMsgSupplier("No se generó comprobante: completa tus Datos de Facturación en el Panel.");
      setTimeout(() => setInvoiceMsgSupplier(""), 4500);
      return;
    }
    try {
      const invoiceNumber = await getNextInvoiceNumber(companyId);
      generateInvoicePDF({
        billing, docType: "PROVEEDOR", partyLabel: "Proveedor",
        partyName: partyName || "—", items, total, note: note || "", invoiceNumber,
      });
    } catch (err) {
      console.error("Error al generar comprobante:", err);
      setInvoiceMsgSupplier("Ocurrió un error al generar el comprobante.");
      setTimeout(() => setInvoiceMsgSupplier(""), 4500);
    }
  }

  async function handleMarkDelivered(sale) {
    setInvoiceMsgSupplier("");
    try {
      await updateSupplierSaleStatus(companyId, sale.id, "Entregado");
      await emitInvoice({
        partyName: sale.supplier,
        items: [{ name: sale.product, qty: sale.qty, unitPrice: sale.unitPrice, total: sale.total }],
        total: sale.total,
        note: sale.note,
      });
    } catch (err) {
      console.error("Error al marcar entregado / generar comprobante:", err);
      setInvoiceMsgSupplier("Ocurrió un error al generar el comprobante.");
      setTimeout(() => setInvoiceMsgSupplier(""), 4500);
    }
  }

  async function handleCancelSale(sale) {
    const hasReturn = sale.warehouseProductId && sale.locationId;
    const confirmMsg = hasReturn
      ? `¿Cancelar esta venta? Se devolverán ${sale.qty} ${sale.packName || "empaque(s)"} de "${sale.product}" al almacén (${sale.locationName}).`
      : `¿Cancelar esta venta? Esta venta es de antes de esta función y no tiene datos de almacén guardados, así que el stock NO se devolverá automáticamente — tendrás que agregarlo tú manualmente si corresponde.`;
    if (!confirm(confirmMsg)) return;
    try {
      await cancelSupplierSale(companyId, sale, userName);
      alert(hasReturn ? "Venta cancelada. El stock volvió al almacén." : "Venta marcada como cancelada. Recuerda ajustar el stock manualmente.");
    } catch (err) {
      console.error("Error al cancelar la venta:", err);
      alert("Ocurrió un error al cancelar la venta.");
    }
  }

  // ── Exportar ventas a proveedores a Excel (.xlsx) ──────────────────────────
  function handleExportSupplierSales() {
    const rows = supplierSales.map(sale => {
      const base = {
        "Proveedor": sale.supplier || "—",
        "Producto":  sale.product || "",
        "Cantidad":  sale.qty ?? "",
        "Fecha":     sale.date || "",
        "Estado":    sale.status || "",
      };
      if (canViewFinance) {
        base["Precio Unitario (S/)"] = Number((sale.unitPrice ?? 0).toFixed(2));
        base["Total (S/)"]           = Number((sale.total ?? 0).toFixed(2));
      }
      return base;
    });
    exportToExcel(rows, "Invenxio_Ventas_Proveedores", "Ventas a Proveedores");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Proveedores</h2>
          <p className="text-sm text-slate-400">{suppliers.length} registrados</p>
        </div>
        {canManageSuppliers && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm rounded-xl transition-colors shadow-lg shadow-amber-500/20">
            <Plus size={16} /> Nuevo Proveedor
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 w-fit">
        {[{ id: "list", label: "📋 Proveedores" }, { id: "sales", label: "📤 Venta a Proveedor" }, { id: "purchase", label: "📥 Registrar Compra de Proveedor" }].map(t => (
          <button key={t.id} onClick={() => setSupTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${supTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {supTab === "list" && (
        loadingSup ? <Spinner /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {suppliers.map(s => (
              <div key={s.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col gap-4 hover:border-amber-500/30 transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center">
                    <Truck size={20} className="text-amber-400" />
                  </div>
                  {canManageSuppliers ? (
                    <button
                      onClick={e => handleToggleSupplierStatus(e, s)}
                      title={s.status === "Activo" ? "Click para desactivar" : "Click para activar"}
                      className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                        s.status === "Activo"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
                          : "bg-slate-700/50 border-slate-600 text-slate-400 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400"
                      }`}
                    >
                      {s.status === "Activo" ? "● Activo" : "○ Inactivo"}
                    </button>
                  ) : (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border ${s.status === "Activo" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-700/50 border-slate-600 text-slate-400"}`}>
                      {s.status === "Activo" ? "● Activo" : "○ Inactivo"}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-white group-hover:text-amber-400 transition-colors">{s.name}</h3>
                  {s.ruc && <p className="text-[11px] text-slate-500 font-mono">RUC/DNI: {s.ruc}</p>}
                </div>
                <div className="space-y-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2"><Users size={11} /><span>{s.contact}</span></div>
                  <div className="flex items-center gap-2"><Phone size={11} /><span>{s.phone}</span></div>
                  {s.address && <div className="flex items-center gap-2"><MapPin size={11} /><span className="truncate">{s.address}</span></div>}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">Vende</p>
                  {s.products?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {s.products.map(p => (
                        <span key={p.id} className="text-[10px] px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400">{p.name}</span>
                      ))}
                    </div>
                  ) : <p className="text-xs text-slate-600 italic">Sin productos asignados</p>}
                </div>
                <div className="flex items-center justify-end">
                  <div className="text-right"><p className="text-xs text-slate-500">Ventas</p><p className="text-sm font-mono font-bold text-slate-300">{supplierSales.filter(sale => sale.supplier === s.name).length}</p></div>
                </div>
                <div className="flex gap-2 mt-auto pt-2 border-t border-slate-700/50">
                  <button onClick={() => setSelSupplier(s)}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-600 text-slate-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center justify-center gap-1">
                    <History size={12} />Ver Historial
                  </button>
                  {canManageSuppliers && (
                    <button onClick={e => {
                      e.stopPropagation();
                      setSaveError("");
                      setEditSupplier(s);
                      setForm({ name: s.name||"", ruc: s.ruc||"", contact: s.contact||"", phone: s.phone||"", address: s.address||"", productIds: (s.products||[]).map(p => p.id), status: s.status||"Activo" });
                      setShowModal(true);
                    }}
                      className="py-2 px-3 text-xs font-semibold rounded-lg border border-transparent text-slate-400 hover:border-amber-500/30 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                      title="Editar proveedor">
                      <Edit3 size={12} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); handleDeleteSupplier(s); }}
                      className="py-2 px-3 text-xs font-semibold rounded-lg border border-transparent text-slate-500 hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Eliminar Proveedor">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {suppliers.length === 0 && <div className="col-span-3 text-center py-16 text-slate-600">Sin proveedores registrados</div>}
          </div>
        )
      )}

      {supTab === "sales" && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Ventas", value: supplierSales.length,          color: "text-blue-400",  icon: <Receipt size={16} /> },
              ...(canViewFinance ? [{ label: "Monto Total", value: `S/ ${totalSales.toFixed(2)}`, color: "text-amber-400", icon: <TrendingUp size={16} /> }] : []),
              { label: "Pendientes",   value: pendingCnt,                    color: "text-amber-400", icon: <Clock size={16} /> },
            ].map((s, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
                <span className={`${s.color} bg-slate-700/50 p-2 rounded-lg`}>{s.icon}</span>
                <div>
                  <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {canManageSuppliers && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Send size={16} className="text-amber-400" />Registrar Venta a Proveedor</h3>
              <div className="space-y-4">
                {ssError && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{ssError}
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
                  <select value={ssForm.supplier} onChange={e => setSsForm(p => ({ ...p, supplier: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="">Seleccionar…</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
                  <div className="relative">
                    <input value={ssForm.productSearch} onChange={e => setSsForm(p => ({ ...p, productSearch: e.target.value, product: null }))} placeholder="Buscar…"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    {ssForm.product && (
                      <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                        <Package size={13} className="text-amber-400" /><span className="text-sm text-amber-400 font-medium">{ssForm.product.name}</span>
                        <span className="text-xs text-slate-500 ml-1">({ssForm.product.packName} × {ssForm.product.packQty} und)</span>
                        <button onClick={() => setSsForm(p => ({ ...p, product: null, productSearch: "" }))} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                      </div>
                    )}
                    {ssFiltered.length > 0 && !ssForm.product && (
                      <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                        {ssFiltered.slice(0, 5).map(p => {
                          const totalStock = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                          return (
                            <button key={p.id} onClick={() => setSsForm(prev => ({ ...prev, product: p, productSearch: p.name, locationId: "" }))}
                              className="w-full text-left px-3 py-2 hover:bg-slate-700 flex justify-between items-center">
                              <span className="text-sm text-slate-200">{p.name}</span>
                              <span className="text-xs font-mono text-amber-400">Stock: {totalStock} {p.packName}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {ssForm.productSearch && !ssForm.product && ssFiltered.length === 0 && (
                      <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir en el catálogo de Almacén.</p>
                    )}
                  </div>
                </div>
                {ssForm.product && (
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Ubicación de origen *</label>
                    <select value={ssForm.locationId} onChange={e => setSsForm(p => ({ ...p, locationId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                      <option value="">Seleccionar…</option>
                      {warehouseLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    {ssFromStock && <p className="text-xs text-slate-500 mt-1">Disponible: <span className="font-mono text-amber-400 font-bold">{ssFromStock.qty} {ssForm.product.packName}</span></p>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad de {ssForm.product?.packName || "empaques"} *</label>
                    <input type="number" value={ssForm.qty} onChange={e => setSsForm(p => ({ ...p, qty: e.target.value }))} min="1" placeholder="0"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Precio por {ssForm.product?.packName || "empaque"} (S/) *</label>
                    <input type="number" value={ssForm.unitPrice} onChange={e => setSsForm(p => ({ ...p, unitPrice: e.target.value }))} min="0" placeholder="0.00"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
                    <select value={ssForm.status} onChange={e => setSsForm(p => ({ ...p, status: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                      {["Entregado", "Pendiente", "Cancelado"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Total</label>
                    <div className="px-3 py-2.5 bg-slate-700/50 border border-amber-500/30 rounded-lg text-sm font-mono font-bold text-amber-400">
                      S/ {(Number(ssForm.qty || 0) * Number(ssForm.unitPrice || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
                  <input value={ssForm.note} onChange={e => setSsForm(p => ({ ...p, note: e.target.value }))} placeholder="Observaciones…"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
                {ssSuccess ? (
                  <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado!</div>
                ) : (
                  <button onClick={handleSupplierSale} disabled={!ssForm.supplier || !ssForm.product || !ssForm.locationId || !ssForm.qty || !ssForm.unitPrice || ssSaving}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                    {ssSaving && <Loader2 size={16} className="animate-spin" />}<Send size={16} />Registrar Venta
                  </button>
                )}
              </div>
            </div>
            )}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <Receipt size={16} className="text-amber-400" />Ventas Registradas
                <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">{supplierSales.length}</span>
              </h3>
              <button
                onClick={handleExportSupplierSales}
                disabled={supplierSales.length === 0}
                title="Descargar como archivo Excel"
                className="flex items-center justify-center gap-1.5 mb-4 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
              >
                <FileSpreadsheet size={13} /> Descargar Excel
              </button>
              {invoiceMsgSupplier && (
                <div className="mb-4 py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsgSupplier}
                </div>
              )}
              <div className="flex gap-2 mb-4">
                <div className="flex-1 bg-slate-700/40 border border-emerald-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Entregados</p>
                  <p className="text-base font-bold font-mono text-emerald-400">{deliveredCnt}</p>
                </div>
                <div className="flex-1 bg-slate-700/40 border border-amber-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Pendientes</p>
                  <p className="text-base font-bold font-mono text-amber-400">{pendingCnt}</p>
                </div>
                <div className="flex-1 bg-slate-700/40 border border-red-500/20 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500 mb-0.5">Cancelados</p>
                  <p className="text-base font-bold font-mono text-red-400">{cancelledCnt}</p>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto max-h-80">
                {loadingSS ? <Spinner /> : supplierSales.length === 0 ? (
                  <div className="text-center py-10 text-slate-600 text-sm">Sin ventas registradas</div>
                ) : supplierSales.map(sale => (
                  <div key={sale.id} className="p-3 bg-slate-700/40 border border-slate-700/50 rounded-xl hover:border-amber-500/20 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-200 truncate">{sale.product}</p>
                        <p className="text-xs text-slate-400">{sale.supplier}</p>
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <StatusBadge status={sale.status} />
                        {canManageSuppliers && sale.status !== "Cancelado" && (
                          <div className="flex items-center gap-2">
                            {sale.status === "Pendiente" && (
                              <>
                                <button onClick={() => handleMarkDelivered(sale)}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Marcar entregado</button>
                                <span className="text-slate-600">·</span>
                              </>
                            )}
                            <button onClick={() => handleCancelSale(sale)}
                              className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancelar</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3 text-slate-500">
                        <span className="flex items-center gap-1"><Calendar size={10} />{sale.date}</span>
                        <span className="flex items-center gap-1"><Tag size={10} />x{sale.qty} {sale.packName || ""}{canViewFinance ? ` · S/${sale.unitPrice}` : ""}</span>
                      </div>
                      {canViewFinance && <span className="font-bold font-mono text-emerald-400">+ S/ {(sale.total || 0).toFixed(2)}</span>}
                    </div>
                    {sale.note && <p className="text-xs text-slate-500 mt-1 italic">{sale.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {supTab === "purchase" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {canManageSuppliers && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Truck size={16} className="text-amber-400" />Registrar Compra de Proveedor</h3>
              <div className="space-y-4">
                {pError && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{pError}
                  </div>
                )}
                {pMsg && (
                  <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${pMsg.startsWith("⚠️") ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"}`}>
                    {pMsg.startsWith("⚠️") ? <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> : <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />}
                    {pMsg}
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
                  <select value={pForm.supplier} onChange={e => setPForm(p => ({ ...p, supplier: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                    <option value="">Seleccionar…</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
                  <div className="relative">
                    <input value={pForm.productSearch} onChange={e => setPForm(p => ({ ...p, productSearch: e.target.value, product: null }))} placeholder="Buscar…"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    {pForm.product && (
                      <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                        <Package size={13} className="text-amber-400" /><span className="text-sm text-amber-400 font-medium">{pForm.product.name}</span>
                        <span className="text-xs text-slate-500 ml-1">({pForm.product.packName} × {pForm.product.packQty} und)</span>
                        <button onClick={() => setPForm(p => ({ ...p, product: null, productSearch: "" }))} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                      </div>
                    )}
                    {pForm.product && (
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        {pForm.product.cost != null
                          ? <>Costo registrado: <span className="text-amber-400 font-mono">S/ {Number(pForm.product.cost).toFixed(2)}</span> por {pForm.product.packName}. Si ingresas un costo distinto, se creará un producto nuevo.</>
                          : "Sin costo registrado todavía — el que ingreses ahora quedará como referencia."}
                      </p>
                    )}
                    {pFiltered.length > 0 && !pForm.product && (
                      <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                        {pFiltered.slice(0, 5).map(p => {
                          const totalStock = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                          return (
                            <button key={p.id} onClick={() => setPForm(prev => ({ ...prev, product: p, productSearch: p.name, locationId: "" }))}
                              className="w-full text-left px-3 py-2 hover:bg-slate-700 flex justify-between items-center">
                              <span className="text-sm text-slate-200">{p.name}</span>
                              <span className="text-xs font-mono text-amber-400">Stock: {totalStock} {p.packName}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {pForm.productSearch && !pForm.product && pFiltered.length === 0 && (
                      <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir en el catálogo de Almacén.</p>
                    )}
                  </div>
                </div>
                {pForm.product && (
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Ubicación destino *</label>
                    <select value={pForm.locationId} onChange={e => setPForm(p => ({ ...p, locationId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                      <option value="">Seleccionar…</option>
                      {warehouseLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad de {pForm.product?.packName || "empaques"} *</label>
                    <input type="number" value={pForm.packCount} onChange={e => setPForm(p => ({ ...p, packCount: e.target.value }))} min="1" placeholder="0"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Costo por {pForm.product?.packName || "empaque"} (S/) *</label>
                    <input type="number" value={pForm.unitCost} onChange={e => setPForm(p => ({ ...p, unitCost: e.target.value }))} min="0" placeholder="0.00"
                      className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
                  <input value={pForm.note} onChange={e => setPForm(p => ({ ...p, note: e.target.value }))} placeholder="Observaciones…"
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
                {pForm.packCount && pForm.unitCost && (
                  <div className="flex justify-between items-center p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <span className="text-sm text-amber-400 font-semibold">Total (costo registrado)</span>
                    <span className="text-lg font-bold font-mono text-amber-400">S/ {(Number(pForm.packCount || 0) * Number(pForm.unitCost || 0)).toFixed(2)}</span>
                  </div>
                )}
                {pSuccess ? (
                  <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado!</div>
                ) : (
                  <button onClick={handleSupplierPurchase} disabled={!pForm.supplier || !pForm.product || !pForm.locationId || !pForm.packCount || !pForm.unitCost || pSaving}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                    {pSaving && <Loader2 size={16} className="animate-spin" />}<ArrowUpCircle size={16} />Registrar Compra (emite comprobante)
                  </button>
                )}
              </div>
            </div>
            )}

            {/* Compras registradas al almacén */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><History size={16} className="text-amber-400" />Compras Registradas</h3>
              <div className="flex-1 space-y-2 overflow-y-auto max-h-[480px]">
                {warehousePurchases.length === 0 ? (
                  <div className="text-center py-10 text-slate-500">
                    <Truck size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin compras registradas todavía.</p>
                  </div>
                ) : warehousePurchases.map(t => (
                  <div key={t.id} className="p-3 bg-slate-900/40 border border-slate-700/40 rounded-xl">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-200 truncate">{t.product}</p>
                      {canViewFinance && <span className="font-bold font-mono text-red-400 flex-shrink-0">- S/ {(t.total || 0).toFixed(2)}</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Calendar size={10} />{t.date}{t.time ? ` · ${t.time}` : ""}</span>
                      <span>x{t.qty} {t.packName || ""} · {t.supplier}</span>
                    </div>
                    {t.note && <p className="text-xs text-slate-500 mt-1 italic">{t.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supplier detail modal */}
      {selSupplier && (() => {
        // Órdenes de compra de este proveedor (filtradas del historial global)
        const supplierOrders = transactions.filter(
          t => t.type === "compra" && (t.supplier === selSupplier.name)
        );
        const totalGastado = supplierOrders.reduce((s, t) => s + (t.total || 0), 0);
        // Ventas de productos de almacén hechas a este proveedor
        const supplierSalesHistory = supplierSales.filter(sale => sale.supplier === selSupplier.name);
        const totalVendido = supplierSalesHistory.reduce((s, sale) => s + (sale.total || 0), 0);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setSelSupplier(null); setDetailTab("ventas"); }} />
            <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-700 flex-shrink-0">
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">{selSupplier.name}</h3>
                  {selSupplier.ruc && <p className="text-xs text-slate-400">RUC/DNI: {selSupplier.ruc}</p>}
                </div>
                <button onClick={() => { setSelSupplier(null); setDetailTab("ventas"); }} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 flex-shrink-0 ml-3"><X size={18} /></button>
              </div>

              {/* Stats rápidas */}
              <div className="grid grid-cols-3 gap-2 px-4 sm:px-5 pt-4 flex-shrink-0">
                {[
                  { label: "Ventas", value: supplierSalesHistory.length },
                  ...(canViewFinance ? [{ label: "Total Vendido", value: `S/ ${totalVendido.toFixed(2)}` }] : []),
                  { label: "Órdenes", value: supplierOrders.length },
                ].map((s, i) => (
                  <div key={i} className="bg-slate-800 rounded-xl p-2.5 text-center border border-slate-700/50">
                    <p className="text-[10px] text-slate-400 mb-0.5 uppercase tracking-wider">{s.label}</p>
                    <p className="text-sm font-bold font-mono text-amber-400 truncate">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Pestañas internas */}
              <div className="flex border-b border-slate-800 px-4 sm:px-5 mt-4 flex-shrink-0 overflow-x-auto">
                {[
                  { id: "ventas",  label: `Ventas (${supplierSalesHistory.length})` },
                  { id: "ordenes", label: `Órdenes (${supplierOrders.length})` },
                  { id: "info", label: "Info" },
                ].map(t => (
                  <button key={t.id} onClick={() => setDetailTab(t.id)}
                    className={`px-3 py-2 text-xs font-semibold transition-colors mr-1 whitespace-nowrap ${detailTab === t.id ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Contenido scrollable */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                {invoiceMsgSupplier && (
                  <div className="mb-4 py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsgSupplier}
                  </div>
                )}

                {/* ── Historial de ventas (productos de almacén vendidos a este proveedor) ── */}
                {detailTab === "ventas" && (
                  <div className="space-y-2">
                    {supplierSalesHistory.length === 0 ? (
                      <div className="text-center py-10 text-slate-500">
                        <Send size={28} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Sin ventas registradas a este proveedor.</p>
                      </div>
                    ) : supplierSalesHistory.map(sale => (
                      <div key={sale.id} className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="text-sm font-semibold text-slate-200 truncate">{sale.product}</p>
                          <StatusBadge status={sale.status} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Calendar size={10}/>{sale.date}{sale.time ? ` · ${sale.time}` : ""}</span>
                          <span>x{sale.qty} {sale.packName || ""}</span>
                          {canViewFinance && <span className="font-bold font-mono text-emerald-400">+ S/ {(sale.total || 0).toFixed(2)}</span>}
                        </div>
                        {sale.note && <p className="text-xs text-slate-500 mt-1 italic">{sale.note}</p>}
                        {canManageSuppliers && sale.status !== "Cancelado" && (
                          <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-700/50">
                            {sale.status === "Pendiente" && (
                              <>
                                <button onClick={() => handleMarkDelivered(sale)}
                                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Marcar entregado</button>
                                <span className="text-slate-600">·</span>
                              </>
                            )}
                            <button onClick={() => handleCancelSale(sale)}
                              className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancelar</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Órdenes de Compra ── */}
                {detailTab === "ordenes" && (
                  <div className="space-y-2">
                    {supplierOrders.length === 0 ? (
                      <div className="text-center py-10 text-slate-500">
                        <Truck size={28} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Sin órdenes de compra registradas.</p>
                        {canManageSuppliers && (
                          <button onClick={() => {
                            setPForm(f => ({ ...f, supplier: selSupplier.name }));
                            setSupTab("purchase");
                            setSelSupplier(null);
                          }}
                            className="mt-3 text-xs text-amber-400 hover:text-amber-300">
                            + Registrar primera compra
                          </button>
                        )}
                      </div>
                    ) : (
                      supplierOrders.map((order, i) => (
                        <div key={order.id || i} className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-200 truncate">{order.product}</p>
                              <p className="text-xs text-slate-500 font-mono">{order.sku}</p>
                            </div>
                            <p className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{order.date}</p>
                          </div>
                          <div className="flex items-center justify-between mt-2 text-xs">
                            <span className="text-slate-400">
                              {order.qty} und
                              {canViewFinance && ` × S/ ${(order.unitCost || 0).toFixed(2)}`}
                            </span>
                            {canViewFinance && (
                              <span className="font-bold font-mono text-amber-400">S/ {(order.total || 0).toFixed(2)}</span>
                            )}
                          </div>
                          {order.note && <p className="text-xs text-slate-600 mt-1 italic">{order.note}</p>}
                        </div>
                      ))
                    )}
                  </div>
                )}


                {/* ── Info del proveedor ── */}
                {detailTab === "info" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {[
                        { icon: <Users size={13} />,   value: selSupplier.contact },
                        { icon: <Phone size={13} />,   value: selSupplier.phone },
                        { icon: <MapPin size={13} />,  value: selSupplier.address },
                        ...(selSupplier.ruc ? [{ icon: <FileText size={13} />, value: `RUC/DNI: ${selSupplier.ruc}` }] : []),
                      ].filter(r => r.value).map((row, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-slate-300 p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/40">
                          <span className="text-amber-400 mt-0.5 flex-shrink-0">{row.icon}</span>
                          <span className="break-all">{row.value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/50 space-y-2">
                      <span className="text-xs text-slate-400">Productos que vende</span>
                      {selSupplier.products?.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selSupplier.products.map(p => (
                            <span key={p.id} className="text-xs px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400">{p.name}</span>
                          ))}
                        </div>
                      ) : <p className="text-xs text-slate-600 italic">Sin productos asignados</p>}
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800/60 rounded-xl border border-slate-700/50">
                      <span className="text-xs text-slate-400">Estado</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${selSupplier.status === "Activo" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-slate-400 border-slate-600 bg-slate-700/40"}`}>
                        {selSupplier.status || "Activo"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* New Supplier Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h3 className="font-bold text-white flex items-center gap-2">
                {editSupplier ? <Edit3 size={16} className="text-amber-400" /> : <Plus size={16} className="text-amber-400" />}
                {editSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
              </h3>
              <button onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">

              {/* Error visible */}
              {saveError && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  {saveError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Nombre empresa *", key: "name",    placeholder: "TechPro SA",         full: true },
                  { label: "RUC / DNI",        key: "ruc",     placeholder: "20123456789"                     },
                  { label: "Contacto *",        key: "contact", placeholder: "Juan García"                    },
                  { label: "Teléfono",          key: "phone",   placeholder: "+51 999 000 111"                },
                  { label: "Dirección",         key: "address", placeholder: "Av. Lima 123",       full: true },
                ].map(f => (
                  <div key={f.key} className={f.full ? "col-span-2" : ""}>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">{f.label}</label>
                    <input value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                ))}

                {/* Toggle Activo/Inactivo — solo visible al editar */}
                {editSupplier && (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
                    <div className="flex gap-2">
                      {["Activo", "Inactivo"].map(st => (
                        <button key={st} type="button"
                          onClick={() => setForm(p => ({ ...p, status: st }))}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                            form.status === st
                              ? st === "Activo"
                                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                                : "bg-red-500/20 border-red-500/50 text-red-400"
                              : "bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600"
                          }`}>
                          {st === "Activo" ? "● Activo" : "○ Inactivo"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="col-span-2">
                  <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto(s) que vende</label>
                  {warehouseProducts.length === 0 ? (
                    <p className="text-xs text-slate-600 italic">No hay productos en el catálogo de Almacén todavía.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-slate-800/60 border border-slate-700 rounded-lg">
                      {warehouseProducts.map(p => {
                        const checked = form.productIds.includes(p.id);
                        return (
                          <button key={p.id} type="button"
                            onClick={() => setForm(prev => ({
                              ...prev,
                              productIds: checked ? prev.productIds.filter(id => id !== p.id) : [...prev.productIds, p.id],
                            }))}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${checked ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                            {checked ? "✓ " : ""}{p.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowModal(false); setEditSupplier(null); setForm(EMPTY_FORM); setSaveError(""); }} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleSaveSupplier} disabled={!form.name || !form.contact || saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}{editSupplier ? "Guardar cambios" : "Registrar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuppliersModule;
