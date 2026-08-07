// ─────────────────────────────────────────────────────────────────────────────
// src/modules/SuppliersModule.jsx
// Módulo 3 — Proveedores: catálogo de proveedores, compras a proveedor con
// destino a almacén, ventas de almacén a proveedor y su cancelación.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
//
// Este archivo es el "contenedor": todo el estado y los handlers viven acá;
// las 4 vistas (lista, venta, compra, detalle, formulario) son componentes
// de presentación bajo src/components/suppliers/ que solo reciben props.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";
import { Plus } from "lucide-react";
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
import { logAndGetErrorMessage } from "../utils/errors";
import { useCollection } from "../hooks/useCollection";
import SupplierListTab from "../components/suppliers/SupplierListTab";
import SupplierSaleTab from "../components/suppliers/SupplierSaleTab";
import SupplierPurchaseTab from "../components/suppliers/SupplierPurchaseTab";
import SupplierDetailModal from "../components/suppliers/SupplierDetailModal";
import SupplierFormModal from "../components/suppliers/SupplierFormModal";
import { useAuth } from "../contexts/AuthContext";
import { formatMoney } from "../utils/currency";
import { sumTotals } from "../utils/finance";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 3 — SUPPLIERS
// ══════════════════════════════════════════════════════════════════════════════
const SuppliersModule = ({ companyId, userName, canManageSuppliers, canDelete, canViewFinance, billing }) => {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  const [suppliers,     loadingSup] = useCollection(companyId, "suppliers",     "name");
  const [supplierSales, loadingSS]  = useCollection(companyId, "supplierSales", "createdAt");
  const [transactions]              = useCollection(companyId, "transactions",  "createdAt");

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
  const [detailTab,    setDetailTab]   = useState("ventas");
  const EMPTY_FORM = { name: "", ruc: "", contact: "", phone: "", address: "", productIds: [], status: "Activo" };
  const [form,         setForm]        = useState(EMPTY_FORM);
  const [saving,       setSaving]      = useState(false);
  const [saveError,    setSaveError]   = useState("");

  const [ssForm,    setSsForm]    = useState({ supplier: "", product: null, productSearch: "", locationId: "", qty: "", unitPrice: "", note: "", status: "Entregado" });
  const [ssSaving,  setSsSaving]  = useState(false);
  const [ssSuccess, setSsSuccess] = useState(false);
  const [ssError,   setSsError]   = useState("");
  const ssFiltered = ssForm.productSearch && !ssForm.product
    ? warehouseProducts.filter(p => p.name?.toLowerCase().includes(ssForm.productSearch.toLowerCase()))
    : [];
  const ssFromStock = ssForm.product && ssForm.locationId
    ? (stockByProduct[ssForm.product.id] || []).find(s => s.locationId === ssForm.locationId)
    : null;

  const warehousePurchases = useMemo(
    () => transactions.filter(t => t.type === "compra" && t.target === "almacen"),
    [transactions]
  );
  const [pForm,    setPForm]    = useState({ supplier: "", product: null, productSearch: "", locationId: "", packCount: "", unitCost: "", note: "" });
  const [pSaving,  setPSaving]  = useState(false);
  const [pSuccess, setPSuccess] = useState(false);
  const [pError,   setPError]   = useState("");
  const [pMsg,     setPMsg]     = useState("");
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

      let targetProduct = pForm.product;
      let msg = "";
      const storedCost = pForm.product.cost != null ? Number(pForm.product.cost) : null;

      if (storedCost === null) {
        await updateWarehouseProduct(companyId, pForm.product.id, { cost });
        msg = `Costo de referencia registrado: ${formatMoney(cost, currencySymbol)} por ${pForm.product.packName}.`;
      } else if (Math.round(storedCost * 100) !== Math.round(cost * 100)) {
        const newName = `${pForm.product.name} (${formatMoney(cost, currencySymbol)})`;
        const newRef  = await addWarehouseProduct(companyId, {
          name: newName,
          sku: pForm.product.sku || "",
          description: pForm.product.description || "",
          packName: pForm.product.packName,
          packQty: pForm.product.packQty,
          unitPrice: pForm.product.unitPrice || null,
          cost,
        });
        targetProduct = { id: newRef.id, name: newName, sku: pForm.product.sku, description: pForm.product.description, packName: pForm.product.packName, packQty: pForm.product.packQty };
        msg = `⚠️ El costo ingresado (${formatMoney(cost, currencySymbol)}) no coincide con el registrado para "${pForm.product.name}" (${formatMoney(storedCost, currencySymbol)}). Se creó un nuevo producto de almacén: "${newName}" y la compra se registró ahí.`;
      } else {
        msg = `✅ El costo coincide con el registrado (${formatMoney(cost, currencySymbol)} por ${pForm.product.packName}).`;
      }

      const total = await recordWarehousePurchase(companyId, {
        supplierId: sup?.id || "", supplierName: pForm.supplier,
        warehouseProductId: targetProduct.id, warehouseProductName: targetProduct.name, sku: targetProduct.sku || "",
        description: targetProduct.description || pForm.product.description || "",
        locationId: pForm.locationId, locationName: loc?.name || "",
        packCount: qty, packName: targetProduct.packName, packQty: targetProduct.packQty,
        unitCost: cost, note: pForm.note, userName,
      });
      setPSuccess(true);
      setPMsg(msg);
      await emitInvoice({
        partyName: pForm.supplier,
        items: [{ name: targetProduct.name, description: targetProduct.description || pForm.product.description || "", qty, unitPrice: cost, total }],
        total, note: pForm.note,
      });
      setTimeout(() => { setPSuccess(false); setPMsg(""); setPForm({ supplier: "", product: null, productSearch: "", locationId: "", packCount: "", unitCost: "", note: "" }); }, 5000);
    } catch (err) {
      setPError(logAndGetErrorMessage(err, "Error al registrar compra a proveedor:", "Error al registrar la compra."));
    }
    setPSaving(false);
  };

  const handleSaveSupplier = async () => {
    if (!form.name || !form.contact) return;
    setSaveError("");
    setSaving(true);
    try {
      const selectedProducts = form.productIds
        .map(id => warehouseProducts.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({ id: p.id, name: p.name }));
      if (editSupplier) {
        if (!editSupplier.id) throw new Error("ID del proveedor no encontrado");
        await updateSupplier(companyId, editSupplier.id, {
          name: form.name, ruc: form.ruc, contact: form.contact, phone: form.phone,
          address: form.address, products: selectedProducts, status: form.status,
        });
      } else {
        await addSupplier(companyId, {
          name: form.name, ruc: form.ruc, contact: form.contact, phone: form.phone,
          address: form.address, products: selectedProducts, status: "Activo",
        });
      }
      setForm(EMPTY_FORM);
      setEditSupplier(null);
      setShowModal(false);
    } catch (err) {
      setSaveError(logAndGetErrorMessage(err, "Error guardando proveedor:", "Error al guardar. Revisa la consola."));
    }
    setSaving(false);
  };

  function closeSupplierForm() {
    setShowModal(false);
    setEditSupplier(null);
    setForm(EMPTY_FORM);
    setSaveError("");
  }

  function openEditSupplier(s) {
    setSaveError("");
    setEditSupplier(s);
    setForm({ name: s.name||"", ruc: s.ruc||"", contact: s.contact||"", phone: s.phone||"", address: s.address||"", productIds: (s.products||[]).map(p => p.id), status: s.status||"Activo" });
    setShowModal(true);
  }

  const handleToggleSupplierStatus = async (e, s) => {
    e.stopPropagation();
    const next = s.status === "Activo" ? "Inactivo" : "Activo";
    try { await updateSupplier(companyId, s.id, { status: next }); }
    catch (err) { alert(logAndGetErrorMessage(err, "Error cambiando estado del proveedor:", "No se pudo cambiar el estado del proveedor.")); }
  };

  const handleDeleteSupplier = async (supplier) => {
    if (!supplier) return;
    if (window.confirm(`¿Estás seguro de que quieres eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`)) {
      try {
        await deleteSupplier(companyId, supplier.id);
      } catch (err) {
        alert(logAndGetErrorMessage(err, "Error al eliminar proveedor:", "Hubo un error al eliminar el proveedor."));
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
        description: ssForm.product.description || "",
        locationId: ssForm.locationId, locationName: loc?.name || "",
        packCount: qty, packName: ssForm.product.packName, packQty: ssForm.product.packQty,
        unitPricePerPack: Number(ssForm.unitPrice), supplierName: ssForm.supplier,
        note: ssForm.note, userName, status: ssForm.status,
      });
      setSsSuccess(true);
      if (ssForm.status === "Entregado") {
        await emitInvoice({
          partyName: ssForm.supplier,
          items: [{ name: ssForm.product.name, description: ssForm.product.description || "", qty, unitPrice: Number(ssForm.unitPrice), total: qty * Number(ssForm.unitPrice) }],
          total: qty * Number(ssForm.unitPrice),
          note: ssForm.note,
        });
      }
      setTimeout(() => { setSsSuccess(false); setSsForm({ supplier: "", product: null, productSearch: "", locationId: "", qty: "", unitPrice: "", note: "", status: "Entregado" }); }, 2500);
    } catch (err) {
      setSsError(logAndGetErrorMessage(err, "Error al registrar venta a proveedor:", "Error al registrar la venta."));
    }
    setSsSaving(false);
  };

  const totalSales   = sumTotals(supplierSales);
  const pendingCnt   = supplierSales.filter(r => r.status === "Pendiente").length;
  const deliveredCnt = supplierSales.filter(r => r.status === "Entregado").length;
  const cancelledCnt = supplierSales.filter(r => r.status === "Cancelado").length;

  const [invoiceMsgSupplier, setInvoiceMsgSupplier] = useState("");

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
        currencySymbol,
      });
    } catch (err) {
      setInvoiceMsgSupplier(logAndGetErrorMessage(err, "Error al generar comprobante:", "Ocurrió un error al generar el comprobante."));
      setTimeout(() => setInvoiceMsgSupplier(""), 4500);
    }
  }

  async function handleMarkDelivered(sale) {
    setInvoiceMsgSupplier("");
    try {
      await updateSupplierSaleStatus(companyId, sale.id, "Entregado");
      await emitInvoice({
        partyName: sale.supplier,
        items: [{ name: sale.product, description: sale.description || "", qty: sale.qty, unitPrice: sale.unitPrice, total: sale.total }],
        total: sale.total,
        note: sale.note,
      });
    } catch (err) {
      setInvoiceMsgSupplier(logAndGetErrorMessage(err, "Error al marcar entregado / generar comprobante:", "Ocurrió un error al generar el comprobante."));
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
      alert(logAndGetErrorMessage(err, "Error al cancelar venta a proveedor:", "Ocurrió un error al cancelar la venta."));
    }
  }

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
        base[`Precio Unitario (${currencySymbol})`] = Number((sale.unitPrice ?? 0).toFixed(2));
        base[`Total (${currencySymbol})`]           = Number((sale.total ?? 0).toFixed(2));
      }
      return base;
    });
    exportToExcel(rows, "Invenxio_Ventas_Proveedores", "Ventas a Proveedores");
  }

  const supplierOrders = selSupplier
    ? transactions.filter(t => t.type === "compra" && t.supplier === selSupplier.name)
    : [];
  const supplierSalesHistory = selSupplier
    ? supplierSales.filter(sale => sale.supplier === selSupplier.name)
    : [];
  const totalVendido = sumTotals(supplierSalesHistory);

  function closeSupplierDetail() {
    setSelSupplier(null);
    setDetailTab("ventas");
  }

  function goToPurchaseTabFor(supplierName) {
    setPForm(f => ({ ...f, supplier: supplierName }));
    setSupTab("purchase");
    setSelSupplier(null);
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
        <SupplierListTab
          suppliers={suppliers} loadingSup={loadingSup} supplierSales={supplierSales}
          canManageSuppliers={canManageSuppliers} canDelete={canDelete}
          onSelectSupplier={setSelSupplier}
          onToggleStatus={handleToggleSupplierStatus}
          onEditSupplier={openEditSupplier}
          onDeleteSupplier={handleDeleteSupplier}
        />
      )}

      {supTab === "sales" && (
        <SupplierSaleTab
          suppliers={suppliers} warehouseLocations={warehouseLocations} stockByProduct={stockByProduct}
          ssForm={ssForm} setSsForm={setSsForm} ssSaving={ssSaving} ssSuccess={ssSuccess} ssError={ssError}
          ssFiltered={ssFiltered} ssFromStock={ssFromStock}
          onSubmit={handleSupplierSale} canManageSuppliers={canManageSuppliers} canViewFinance={canViewFinance}
          supplierSales={supplierSales} loadingSS={loadingSS}
          totalSales={totalSales} pendingCnt={pendingCnt} deliveredCnt={deliveredCnt} cancelledCnt={cancelledCnt}
          invoiceMsgSupplier={invoiceMsgSupplier}
          onMarkDelivered={handleMarkDelivered} onCancelSale={handleCancelSale}
          onExport={handleExportSupplierSales}
        />
      )}

      {supTab === "purchase" && (
        <SupplierPurchaseTab
          suppliers={suppliers} warehouseLocations={warehouseLocations} stockByProduct={stockByProduct}
          pForm={pForm} setPForm={setPForm} pSaving={pSaving} pSuccess={pSuccess} pError={pError} pMsg={pMsg}
          pFiltered={pFiltered}
          onSubmit={handleSupplierPurchase} canManageSuppliers={canManageSuppliers} canViewFinance={canViewFinance}
          warehousePurchases={warehousePurchases}
        />
      )}

      <SupplierDetailModal
        supplier={selSupplier} onClose={closeSupplierDetail}
        detailTab={detailTab} setDetailTab={setDetailTab}
        supplierOrders={supplierOrders} supplierSalesHistory={supplierSalesHistory} totalVendido={totalVendido}
        canViewFinance={canViewFinance} canManageSuppliers={canManageSuppliers}
        invoiceMsgSupplier={invoiceMsgSupplier}
        onMarkDelivered={handleMarkDelivered} onCancelSale={handleCancelSale}
        onGoToPurchaseTab={() => goToPurchaseTabFor(selSupplier?.name)}
      />

      <SupplierFormModal
        show={showModal} onClose={closeSupplierForm} editSupplier={editSupplier}
        form={form} setForm={setForm} saveError={saveError}
        warehouseProducts={warehouseProducts} saving={saving} onSave={handleSaveSupplier}
      />
    </div>
  );
};

export default SuppliersModule;
