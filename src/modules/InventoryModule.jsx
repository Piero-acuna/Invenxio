// ─────────────────────────────────────────────────────────────────────────────
// src/modules/InventoryModule.jsx
// Módulo 1 — Inventario: catálogo de productos, alta/edición/baja, ajustes de
// stock y generación de código de barras/SKU.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";
import {
  Search, X, Plus, Package, History, ArrowUpCircle, ArrowDownCircle,
  AlertTriangle, CheckCircle, Edit3, Box, Zap, Loader2, ScanBarcode, Save,
  FileSpreadsheet,
} from "lucide-react";
import {
  addProduct, updateProduct, deleteProduct, adjustProductStock,
  subscribeToProductHistory, addWarehouseProduct, addWarehouseMovement,
} from "../services/firestoreService";
import { logAndGetErrorMessage } from "../utils/errors";
import { StatusBadge, Spinner, STOCK_STATUS } from "../components/shared/StatusUI";
import { BarcodeDisplay } from "../components/BarcodeUI";
import { generateBarcode } from "../lib/barcode";
import { useAuth } from "../contexts/AuthContext";
import { formatMoney } from "../utils/currency";
import ImportExcelModal from "../components/ImportExcelModal";

// ── Plantilla de importación por Excel ───────────────────────────────────
// Encabezados EXACTOS que debe traer el archivo (fila 1). "SKU / Código" y
// "Código de Barras" son opcionales — si se dejan vacíos, se autogeneran
// igual que en el alta manual (ver `nextSku` y generateBarcode()).
const PRODUCT_IMPORT_HEADERS = [
  "SKU / Código", "Nombre", "Descripción", "Categoría",
  "Precio de Venta", "Costo", "Stock Inicial", "Stock Mínimo",
  "Unidades por Empaque", "Código de Barras",
];
const PRODUCT_IMPORT_EXAMPLE = [
  { "SKU / Código": "001", "Nombre": "Coca Cola 500ml", "Descripción": "Bebida gaseosa", "Categoría": "Bebidas", "Precio de Venta": 3.5, "Costo": 2.2, "Stock Inicial": 48, "Stock Mínimo": 10, "Unidades por Empaque": 6, "Código de Barras": "" },
  { "SKU / Código": "", "Nombre": "Arroz Extra 1kg", "Descripción": "", "Categoría": "Abarrotes", "Precio de Venta": 5.9, "Costo": 4.3, "Stock Inicial": 30, "Stock Mínimo": 5, "Unidades por Empaque": "", "Código de Barras": "" },
];
import { calcProfit, calcMarginPercent } from "../utils/finance";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — INVENTORY
// ══════════════════════════════════════════════════════════════════════════════
const InventoryModule = ({
  companyId, userName, canCreate, canEdit, canDelete, canViewFinance, canManageWarehouse,
  products, loadingProducts: loadingP, suppliers, locations = [], warehouseProducts = [],
}) => {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  // "products" y "suppliers" YA NO se suscriben acá — llegan como prop
  // desde InventorySystem.jsx (compartidos también con el Dashboard), en
  // vez de que este módulo abra su propia suscripción independiente a
  // exactamente los mismos datos.

  const [search,          setSearch]          = useState("");
  const [statusFilter,    setStatusFilter]    = useState("Todos");
  const [selectedProductId, setSelectedProdId] = useState(null);
  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const [adjustQty,       setAdjustQty]       = useState("");
  const [adjustType,      setAdjustType]      = useState("add");
  const [adjusting,       setAdjusting]       = useState(false);
  const [adjustError,     setAdjustError]     = useState("");

  // Historial del producto seleccionado — vive en la subcolección
  // products/{id}/history (ver src/services/firestore/products.js), NO en
  // un array dentro del propio documento del producto. Se suscribe bajo
  // demanda, solo mientras el detalle de ese producto está abierto.
  const [productHistory,        setProductHistory]        = useState([]);
  const [loadingProductHistory, setLoadingProductHistory]  = useState(false);
  useEffect(() => {
    if (!selectedProductId) { setProductHistory([]); return; }
    setLoadingProductHistory(true);
    const unsub = subscribeToProductHistory(companyId, selectedProductId, (items) => {
      setProductHistory(items);
      setLoadingProductHistory(false);
    });
    return unsub;
  }, [companyId, selectedProductId]);

  // Nuevo producto
  const [showNewProd, setShowNewProd] = useState(false);
  // "destino" reemplaza al viejo booleano sendToWarehouse: ahora Inventario
  // y Almacén son dos catálogos independientes, cada uno con su propia
  // numeración de código — elegir uno NO crea nada en el otro (antes,
  // "Inventario + Almacén" creaba SIEMPRE el producto de tienda primero).
  // name/sku/description se comparten entre ambos destinos porque solo uno
  // está activo a la vez (nunca se muestran ni se guardan los dos juntos).
  const [newProd, setNewProd] = useState({
    destino: "inventario", // "inventario" | "almacen"
    name: "", sku: "", description: "",
    // — solo Inventario —
    price: "", cost: "", stock: "", minStock: "4", packQty: "", barcode: "",
    // — solo Almacén — "Precio de cada empaque" (whUnitPrice) es nuevo: antes
    // quedaba sin definir hasta que alguien lo editaba luego en Almacén →
    // Mis Productos.
    whPackName: "Caja", whPackQty: "", whUnitPrice: "", whPackCount: "", whLocationId: "",
  });
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState("");

  // Editar producto
  const [editProd,    setEditProd]    = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [editSaving,  setEditSaving]  = useState(false);
  const [editError,   setEditError]   = useState("");

  // ── SKU / Código interno automático ──────────────────────────────────
  // Empieza en "001" y sube según cuántos productos hay. Se calcula a
  // partir del SKU numérico más alto que ya exista (no solo products.length)
  // para no repetir un código si se borró algún producto de en medio —
  // ej. si el producto "005" se eliminó, el siguiente sigue siendo "00N+1"
  // según el más alto existente, nunca vuelve a ofrecer "005".
  // Si algún producto tiene un SKU con letras (ej. "EL-001", de una época
  // anterior), simplemente se ignora para este cálculo — solo cuentan los
  // SKU 100% numéricos.
  const nextSku = useMemo(() => {
    const maxExisting = products.reduce((max, p) => {
      const n = /^\d+$/.test(p.sku || "") ? parseInt(p.sku, 10) : 0;
      return n > max ? n : max;
    }, 0);
    const next = maxExisting + 1;
    // Ancho mínimo 3 dígitos ("001"..."999"); si ya hay más de 999
    // productos, crece a "1000" en vez de truncar.
    return String(next).padStart(3, "0");
  }, [products]);

  // Igual que nextSku, pero contando SOLO warehouseProducts — Almacén es un
  // catálogo independiente de Inventario, así que lleva su propia
  // numeración "001", "002"... sin importar cuántos productos de tienda
  // existan.
  const nextWhSku = useMemo(() => {
    const maxExisting = warehouseProducts.reduce((max, p) => {
      const n = /^\d+$/.test(p.sku || "") ? parseInt(p.sku, 10) : 0;
      return n > max ? n : max;
    }, 0);
    return String(maxExisting + 1).padStart(3, "0");
  }, [warehouseProducts]);

  // ── Importar Excel ────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);

  // Valida TODAS las filas leídas del Excel de una vez (no una por una),
  // porque necesita ver el conjunto completo para: continuar la numeración
  // automática de SKU sin repetir dentro del mismo archivo, y detectar SKUs
  // duplicados contra el inventario actual Y entre filas del propio Excel.
  function parseProductImportRows(rawRows) {
    const existingSkus = new Set(products.map(p => (p.sku || "").trim().toLowerCase()).filter(Boolean));
    let autoSkuCounter = parseInt(nextSku, 10);
    const usedInBatch = new Set();

    return rawRows.map((raw) => {
      const name = String(raw["Nombre"] ?? "").trim();
      const label = name || "(sin nombre)";
      let sku = String(raw["SKU / Código"] ?? "").trim();
      const priceRaw = raw["Precio de Venta"];
      const price = Number(priceRaw);

      if (!name) return { ok: false, label, error: "Falta el nombre del producto." };
      if (priceRaw === "" || priceRaw === null || priceRaw === undefined || Number.isNaN(price) || price < 0) {
        return { ok: false, label, error: 'La columna "Precio de Venta" es obligatoria y debe ser un número.' };
      }

      if (!sku) {
        sku = String(autoSkuCounter).padStart(3, "0");
        autoSkuCounter++;
      } else if (existingSkus.has(sku.toLowerCase()) || usedInBatch.has(sku.toLowerCase())) {
        return { ok: false, label, error: `El SKU "${sku}" ya existe (en tu inventario, o repetido en este mismo archivo).` };
      }
      usedInBatch.add(sku.toLowerCase());

      const packQty  = Number(raw["Unidades por Empaque"]) || 0;
      const stock    = Number(raw["Stock Inicial"]) || 0;
      const minStock = Number(raw["Stock Mínimo"]) || 4;
      const cost     = Number(raw["Costo"]) || 0;
      const barcode  = String(raw["Código de Barras"] ?? "").trim() || generateBarcode();

      return {
        ok: true,
        label: `${name} (SKU ${sku})`,
        values: {
          name, sku,
          description: String(raw["Descripción"] ?? "").trim(),
          category:    String(raw["Categoría"] ?? "").trim(),
          price, cost, stock, minStock,
          packQty: packQty || null,
          barcode,
          status: stock === 0 ? "Agotado" : stock <= minStock ? "Stock Bajo" : "En Stock",
        },
      };
    });
  }

  const filtered = useMemo(() => products.filter(p => {
    const q = search.toLowerCase();    return (p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q)) &&
      (statusFilter === "Todos" || p.status === statusFilter);
  }), [products, search, statusFilter]);

  const openEdit = (p, e) => {
    e.stopPropagation();
    setEditForm({
      name: p.name || "",
      sku: p.sku || "",
      description: p.description || "",
      price: p.price ?? "",
      cost: p.cost ?? "",
      stock: p.stock ?? "",
      minStock: p.minStock ?? 4,
      packQty: p.packQty ?? "",
      barcode: p.barcode || "",
    });
    setEditProd(p);
    setEditError("");
  };

  const handleAdjust = async () => {
    const hasPacking = Number(selectedProduct?.packQty) > 0;
    const qty = hasPacking ? Number(adjustQty) * Number(selectedProduct.packQty) : Number(adjustQty);
    if (!adjustQty || qty <= 0) return;
    setAdjusting(true); setAdjustError("");
    try {
      await adjustProductStock(companyId, selectedProduct.id, { type: adjustType, qty, user: userName });
      setAdjustQty("");
    } catch (err) {
      setAdjustError(logAndGetErrorMessage(err, "Error al ajustar stock:"));
    }
    setAdjusting(false);
  };

  const handleAddProduct = async () => {
    if (!newProd.name) return;
    if (newProd.destino === "almacen") {
      // ── Producto nuevo → SOLO Almacén (catálogo independiente) ────────
      if (!canManageWarehouse) { setSaveError("No tienes permiso para gestionar Almacén."); return; }
      if (!newProd.whLocationId) { setSaveError("Selecciona la ubicación de almacén."); return; }
      if (!newProd.whPackName.trim()) { setSaveError('Indica el nombre de la unidad de empaque (ej: "Caja").'); return; }
      if (!newProd.whPackQty || Number(newProd.whPackQty) <= 0) { setSaveError("Indica cuántas unidades trae cada empaque."); return; }
      if (!newProd.whPackCount || Number(newProd.whPackCount) <= 0) { setSaveError("Indica la cantidad de empaques (stock inicial)."); return; }
      setSaving(true); setSaveError("");
      try {
        const loc = locations.find(l => l.id === newProd.whLocationId);
        const newWhProductId = await addWarehouseProduct(companyId, {
          name: newProd.name,
          sku: newProd.sku || nextWhSku,
          description: newProd.description || "",
          packName: newProd.whPackName.trim(),
          packQty: Number(newProd.whPackQty),
          unitPrice: newProd.whUnitPrice ? Number(newProd.whUnitPrice) : null,
        });
        await addWarehouseMovement(companyId, {
          type: "entrada",
          productId: newWhProductId, productName: newProd.name, sku: newProd.sku || nextWhSku,
          qty: Number(newProd.whPackCount),
          toLocationId: newProd.whLocationId, toLocationName: loc?.name || "",
          reason: "Stock inicial",
          userName,
          packName: newProd.whPackName.trim(), packQty: Number(newProd.whPackQty),
        });
        setShowNewProd(false);
        setNewProd(p => ({
          ...p, name: "", sku: nextWhSku, description: "",
          whPackName: "Caja", whPackQty: "", whUnitPrice: "", whPackCount: "", whLocationId: "",
        }));
      } catch (err) {
        setSaveError(logAndGetErrorMessage(err, "Error al crear producto de almacén:"));
      }
      setSaving(false);
      return;
    }

    // ── Producto nuevo → SOLO Inventario (tienda) ───────────────────────
    if (!newProd.sku) return;
    setSaving(true); setSaveError("");
    try {
      const packQty  = Number(newProd.packQty) || 0;
      const stock    = packQty > 0 ? (Number(newProd.stock) || 0) * packQty : (Number(newProd.stock) || 0);
      const minStock = Number(newProd.minStock) || 0;
      const sku = newProd.sku;
      const description = newProd.description || "";
      await addProduct(companyId, {
        name: newProd.name,
        sku,
        description,
        price:    Number(newProd.price) || 0,
        cost:     Number(newProd.cost) || 0,
        stock,
        minStock,
        packQty:  packQty || null,
        barcode:  newProd.barcode || generateBarcode(),
        status:   stock === 0 ? "Agotado" : stock <= minStock ? "Stock Bajo" : "En Stock",
      });
      setShowNewProd(false);
      setNewProd(p => ({ ...p, name: "", sku: nextSku, description: "", price: "", cost: "", stock: "", minStock: "4", packQty: "", barcode: "" }));
    } catch (err) {
      setSaveError(logAndGetErrorMessage(err, "Error al crear producto:"));
    }
    setSaving(false);
  };

  const handleEditSave = async () => {
    if (!editProd || !editForm.name || !editForm.sku) return;
    setEditSaving(true); setEditError("");
    try {
      const price = parseFloat(editForm.price);
      const cost = parseFloat(editForm.cost);
      const stock = parseInt(editForm.stock, 10);
      const minStock = parseInt(editForm.minStock, 10);

      const finalStock = !isNaN(stock) ? stock : editProd.stock;
      const finalMinStock = !isNaN(minStock) ? minStock : editProd.minStock;
      const finalStatus = finalStock === 0 ? "Agotado" : finalStock <= finalMinStock ? "Stock Bajo" : "En Stock";

      await updateProduct(companyId, editProd.id, {
        name: editForm.name,
        sku: editForm.sku,
        description: editForm.description || "",
        price: !isNaN(price) ? price : editProd.price,
        cost: !isNaN(cost) ? cost : editProd.cost,
        stock: finalStock,
        minStock: finalMinStock,
        packQty: editForm.packQty ? Number(editForm.packQty) : null,
        barcode: editForm.barcode || editProd.barcode || generateBarcode(),
        status: finalStatus,
      });
      setEditProd(null);
    } catch (err) {
      setEditError(logAndGetErrorMessage(err, "Error al editar producto:"));
    }
    setEditSaving(false);
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;
    if (window.confirm(`¿Estás seguro de que quieres eliminar "${selectedProduct.name}"? Esta acción no se puede deshacer.`)) {
      try {
        await deleteProduct(companyId, selectedProduct.id);
        setSelectedProdId(null);
      } catch (err) {
        alert(logAndGetErrorMessage(err, "Error al eliminar producto:", "Hubo un error al eliminar el producto."));
      }
    }
  };

  const stats = [
    { label: "Total Productos", value: products.length,                                      icon: <Box size={18} />,           color: "text-blue-400"    },
    { label: "En Stock",        value: products.filter(p => p.status === "En Stock").length,   icon: <CheckCircle size={18} />,   color: "text-emerald-400" },
    { label: "Stock Bajo",      value: products.filter(p => p.status === "Stock Bajo").length, icon: <AlertTriangle size={18} />, color: "text-amber-400"   },
    { label: "Agotados",        value: products.filter(p => p.status === "Agotado").length,    icon: <X size={18} />,             color: "text-red-400"     },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <span className={`${s.color} bg-slate-700/50 p-1.5 sm:p-2 rounded-lg flex-shrink-0`}>{s.icon}</span>
            <div className="min-w-0">
              <div className="text-xl sm:text-2xl font-bold text-white font-mono">{s.value}</div>
              <div className="text-xs text-slate-400 truncate">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, SKU o código de barras…"
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          {["Todos", ...STOCK_STATUS].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
              {s}
            </button>
          ))}
        </div>
        {canCreate && (
          <>
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-sm rounded-lg transition-colors">
              <FileSpreadsheet size={15} /> <span className="hidden sm:inline">Importar</span> Excel
            </button>
            <button onClick={() => { setShowNewProd(true); setSaveError(""); setNewProd(p => ({ ...p, destino: "inventario", sku: nextSku })); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm rounded-lg transition-colors">
              <Plus size={15} /> Producto
            </button>
          </>
        )}
      </div>

      {/* Table */}
      {loadingP ? <Spinner /> : (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
          {/* max-h + overflow-y-auto: con muchos productos la tabla scrollea
              adentro de su propio recuadro en vez de estirar toda la página
              (que se veía "amontonada" al mezclarse con el resto de la UI).
              El thead queda sticky arriba para no perder las columnas al
              bajar. */}
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-800">
                <tr className="border-b border-slate-700/80">
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">SKU</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Producto</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-400 uppercase tracking-wider hidden md:table-cell">Empaque</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Stock</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-400 uppercase tracking-wider hidden sm:table-cell">Precio</th>
                  <th className="text-center py-3 px-4 text-xs text-slate-400 uppercase tracking-wider">Estado</th>
                  <th className="py-3 px-4 text-xs text-slate-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr key={p.id} onClick={() => { setSelectedProdId(p.id); setAdjustError(""); setAdjustQty(""); }}
                    className={`border-b border-slate-700/30 cursor-pointer hover:bg-slate-700/40 transition-colors group ${idx % 2 === 0 ? "" : "bg-slate-800/20"}`}>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">{p.sku}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0"><Package size={13} className="text-slate-400" /></div>
                        <span className="text-slate-200 font-medium group-hover:text-amber-400 transition-colors">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-xs text-slate-400">{p.packQty ? `${p.packQty} und/empaque` : "—"}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      <span className={p.stock === 0 ? "text-red-400" : p.stock <= p.minStock ? "text-amber-400" : "text-emerald-400"}>{p.stock}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-300 hidden sm:table-cell">{formatMoney(p.price, currencySymbol)}</td>
                    <td className="py-3 px-4 text-center"><StatusBadge status={p.status} /></td>
                    <td className="py-3 px-4 text-center">
                      {canEdit && (
                        <button onClick={e => openEdit(p, e)}
                          className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors">
                          <Edit3 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-slate-500">No se encontraron productos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Slide-over detalle ── */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex">
          <div className="hidden sm:block flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedProdId(null)} />
          <div className="w-full sm:max-w-md bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-700">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono text-amber-400">{selectedProduct.sku}</p>
                <h3 className="text-base sm:text-lg font-bold text-white truncate">{selectedProduct.name}</h3>
              </div>
              <button onClick={() => setSelectedProdId(null)} className="ml-3 p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors flex-shrink-0"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5">
              {/* Barcode */}
              {selectedProduct.barcode && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><ScanBarcode size={11} className="text-amber-400" />Código de Barras</p>
                  <BarcodeDisplay value={selectedProduct.barcode} showDownload productName={selectedProduct.name} />
                </div>
              )}
              {/* Descripción */}
              {selectedProduct.description && (
                <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                  <p className="text-xs text-slate-400 mb-1">Descripción</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{selectedProduct.description}</p>
                </div>
              )}
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Stock Actual",  value: selectedProduct.stock,                        mono: true,  color: selectedProduct.stock === 0 ? "text-red-400" : selectedProduct.stock <= selectedProduct.minStock ? "text-amber-400" : "text-emerald-400" },
                  { label: "Stock Mínimo",  value: selectedProduct.minStock,                     mono: true,  color: "text-slate-300" },
                  { label: "Costo de Venta", value: `${formatMoney(selectedProduct.price, currencySymbol)}`, mono: true, color: "text-slate-300" },
                  ...(canViewFinance ? [{ label: "Costo de Compra", value: `${formatMoney(selectedProduct.cost, currencySymbol)}`, mono: true, color: "text-slate-300" }] : []),
                  { label: "Unid. por Empaque", value: selectedProduct.packQty || "—",            mono: true, color: "text-slate-300" },
                  ...(selectedProduct.packQty > 0 ? [{ label: "Empaques Disponibles", value: `≈ ${Math.floor(selectedProduct.stock / selectedProduct.packQty)}`, mono: true, color: "text-amber-400" }] : []),
                ].map((item, i) => (
                  <div key={i} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                    <p className="text-xs text-slate-400 mb-1">{item.label}</p>
                    <p className={`font-semibold ${item.mono ? "font-mono" : ""} ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50"><StatusBadge status={selectedProduct.status} /></div>

              {/* Ajustar Stock */}
              {canEdit && (
                <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Zap size={14} className="text-amber-400" />Ajustar Stock</h4>
                  <div className="flex gap-2 mb-3">
                    {[{ t: "add", l: "Entrada", icon: <ArrowUpCircle size={13} />, cls: "bg-emerald-500/20 border-emerald-500/50 text-emerald-400" }, { t: "remove", l: "Salida", icon: <ArrowDownCircle size={13} />, cls: "bg-red-500/20 border-red-500/50 text-red-400" }].map(b => (
                      <button key={b.t} onClick={() => setAdjustType(b.t)}
                        className={`flex-1 py-2 text-xs rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${adjustType === b.t ? b.cls : "border-slate-600 text-slate-400 hover:border-slate-500"}`}>
                        {b.icon}{b.l}
                      </button>
                    ))}
                  </div>
                  {Number(selectedProduct.packQty) > 0 && (
                    <p className="text-[11px] text-amber-400/80 mb-2">📦 Este producto viene en empaques de {selectedProduct.packQty} und. Ingresa cuántos empaques, y el stock se despacha automáticamente en unidades.</p>
                  )}
                  <div className="flex gap-2">
                    <input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} min="0"
                      placeholder={Number(selectedProduct.packQty) > 0 ? "Cantidad de empaques" : "Cantidad"}
                      className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                    <button onClick={handleAdjust} disabled={adjusting}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 font-semibold text-sm rounded-lg transition-colors flex items-center gap-1">
                      {adjusting && <Loader2 size={13} className="animate-spin" />}Aplicar
                    </button>
                  </div>
                  {Number(selectedProduct.packQty) > 0 && Number(adjustQty) > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1.5">= {Number(adjustQty) * Number(selectedProduct.packQty)} unidades en total</p>
                  )}
                  {adjustError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg mt-2">{adjustError}</p>}
                </div>
              )}

              {/* Historial */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><History size={14} className="text-amber-400" />Historial</h4>
                <div className="space-y-2">
                  {loadingProductHistory ? <Spinner /> : (<>
                    {productHistory.map((h, i) => {
                      const isIncrease = h.action?.includes("Compra") || h.action?.includes("Recibido") || h.action?.includes("+");
                      return (
                      <div key={h.id || i} className="flex items-center gap-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                        <div className={`p-1.5 rounded-lg ${isIncrease ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                          {isIncrease ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-slate-300">
                            {h.action} <span className={`font-mono font-bold ${isIncrease ? "text-emerald-400" : "text-red-400"}`}>{isIncrease ? "+" : "-"}{h.qty}</span>
                          </p>
                          <p className="text-xs text-slate-500">{h.date} · {h.user}</p>
                        </div>
                      </div>
                      );
                    })}
                    {productHistory.length === 0 && <p className="text-xs text-slate-600 text-center py-4">Sin historial</p>}
                  </>)}
                </div>
              </div>

              {/* Zona de Peligro */}
              {canDelete && (
                <div className="bg-red-500/10 rounded-xl border border-red-500/20 p-4 mt-5">
                  <h4 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} />Zona de Peligro</h4>
                  <button
                    onClick={handleDeleteProduct}
                    className="w-full text-center py-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-bold rounded-lg transition-colors"
                  >
                    Eliminar Producto Permanentemente
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo Producto ── */}
      {showNewProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNewProd(false)} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h3 className="font-bold text-white flex items-center gap-2"><Plus size={16} className="text-amber-400" />Nuevo Producto</h3>
              <button onClick={() => setShowNewProd(false)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh] space-y-4">
              {/* Destino — Inventario y Almacén son catálogos totalmente
                  independientes: elegir uno NO crea nada en el otro, cada
                  uno con su propia numeración de código. */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Destino</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setNewProd(p => ({ ...p, destino: "inventario", sku: nextSku })); setSaveError(""); }}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${
                      newProd.destino === "inventario"
                        ? "bg-amber-500 border-amber-500 text-slate-900"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                    }`}>
                    📋 Inventario
                  </button>
                  <button type="button" disabled={!canManageWarehouse}
                    onClick={() => { setNewProd(p => ({ ...p, destino: "almacen", sku: nextWhSku })); setSaveError(""); }}
                    title={!canManageWarehouse ? "No tienes permiso para gestionar Almacén" : undefined}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      newProd.destino === "almacen"
                        ? "bg-amber-500 border-amber-500 text-slate-900"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                    }`}>
                    📦 Almacén
                  </button>
                </div>
              </div>

              {newProd.destino === "inventario" ? (
                <>
                  {/* Identificación */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Identificación</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 mb-1 block">Nombre del producto *</label>
                        <input type="text" value={newProd.name} onChange={e => setNewProd(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Galleta de chocolate 100g"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Código * <span className="text-slate-500 normal-case font-normal">(autogenerado, editable)</span></label>
                        <input type="text" value={newProd.sku} onChange={e => setNewProd(p => ({ ...p, sku: e.target.value }))} placeholder="Ej: EL-001"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Unidades por Empaque</label>
                        <input type="number" min="1" value={newProd.packQty} onChange={e => setNewProd(p => ({ ...p, packQty: e.target.value }))} placeholder="Ej: 12"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 mb-1 block">Descripción</label>
                        <p className="text-[10px] text-slate-500 mb-1">Se muestra al vender y en el comprobante</p>
                        <textarea value={newProd.description} onChange={e => setNewProd(p => ({ ...p, description: e.target.value }))} placeholder="Ej: oreo 100g free" rows={2}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors resize-none" />
                      </div>
                    </div>
                  </div>

                  {/* Precios — sección destacada */}
                  {canViewFinance && (
                    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">Precios</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-emerald-400 mb-0.5 block">Costo de Venta ({currencySymbol})</label>
                          <p className="text-[10px] text-slate-500 mb-1.5">Lo que cobra al cliente</p>
                          <input type="number" min="0" step="0.01" value={newProd.price} onChange={e => setNewProd(p => ({ ...p, price: e.target.value }))} placeholder="0.00"
                            className="w-full px-3 py-2 bg-slate-900 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-sky-400 mb-0.5 block">Costo de Compra ({currencySymbol})</label>
                          <p className="text-[10px] text-slate-500 mb-1.5">Lo que paga al proveedor</p>
                          <input type="number" min="0" step="0.01" value={newProd.cost} onChange={e => setNewProd(p => ({ ...p, cost: e.target.value }))} placeholder="0.00"
                            className="w-full px-3 py-2 bg-slate-900 border border-sky-500/30 rounded-lg text-sm text-sky-300 font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors" />
                        </div>
                      </div>
                      {/* Margen calculado en tiempo real (ver src/utils/finance.js) */}
                      {newProd.price > 0 && newProd.cost > 0 && (() => {
                        const profit = calcProfit(newProd.price, newProd.cost);
                        const margin = calcMarginPercent(newProd.price, newProd.cost);
                        return (
                          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${margin >= 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                            <span className="text-slate-400">Ganancia por unidad</span>
                            <div className="text-right">
                              <span className={`font-mono font-bold ${margin >= 0 ? "text-amber-400" : "text-red-400"}`}>{formatMoney(profit, currencySymbol)}</span>
                              <span className={`ml-2 ${margin >= 0 ? "text-amber-400" : "text-red-400"}`}>({margin.toFixed(1)}% margen)</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Si no tiene finanzas, mostrar solo precio de venta */}
                  {!canViewFinance && (
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Precio</p>
                      <div>
                        <label className="text-xs font-semibold text-emerald-400 mb-0.5 block">Costo de Venta ({currencySymbol})</label>
                        <p className="text-[10px] text-slate-500 mb-1.5">Lo que cobra al cliente por unidad</p>
                        <input type="number" min="0" step="0.01" value={newProd.price} onChange={e => setNewProd(p => ({ ...p, price: e.target.value }))} placeholder="0.00"
                          className="w-full px-3 py-2 bg-slate-800 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors" />
                      </div>
                    </div>
                  )}

                  {/* Stock */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Stock</p>
                    {Number(newProd.packQty) > 0 && (
                      <p className="text-[11px] text-amber-400/80 mb-2">📦 Ingresa el stock inicial en cantidad de empaques ({newProd.packQty} und c/u); se convierte a unidades automáticamente.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">{Number(newProd.packQty) > 0 ? "Stock inicial (empaques)" : "Stock inicial"}</label>
                        <input type="number" min="0" value={newProd.stock} onChange={e => setNewProd(p => ({ ...p, stock: e.target.value }))} placeholder="0"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                        {Number(newProd.packQty) > 0 && Number(newProd.stock) > 0 && (
                          <p className="text-[10px] text-slate-500 mt-1">= {Number(newProd.stock) * Number(newProd.packQty)} unidades</p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Stock mínimo</label>
                        <p className="text-[10px] text-slate-500 mb-1">Alerta cuando baje de aquí</p>
                        <input type="number" min="0" value={newProd.minStock} onChange={e => setNewProd(p => ({ ...p, minStock: e.target.value }))} placeholder="0"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                    </div>
                  </div>

                  {/* Código de barras */}
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block flex items-center gap-1"><ScanBarcode size={11} />Código de Barras</label>
                    <div className="flex gap-2">
                      <input value={newProd.barcode} onChange={e => setNewProd(p => ({ ...p, barcode: e.target.value }))} placeholder="Se genera automáticamente"
                        className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      <button onClick={() => setNewProd(p => ({ ...p, barcode: generateBarcode() }))}
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                        Generar
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Producto de ALMACÉN — catálogo independiente: solo
                      identificador de empaque, precio por empaque,
                      descripción y ubicación. Sin precio de venta/costo por
                      unidad ni código de barras (eso es propio de tienda). */}
                  {locations.length === 0 ? (
                    <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-lg">
                      Todavía no tienes ninguna ubicación creada en Almacén → Mapa. Crea una primero para poder registrar productos ahí.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 mb-1 block">Nombre del producto *</label>
                        <input type="text" value={newProd.name} onChange={e => setNewProd(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Galleta de chocolate 100g"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Código <span className="text-slate-500 normal-case font-normal">(autogenerado, editable)</span></label>
                        <input type="text" value={newProd.sku} onChange={e => setNewProd(p => ({ ...p, sku: e.target.value }))} placeholder="Ej: 001"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Nombre de unidad por empaque *</label>
                        <input value={newProd.whPackName} onChange={e => setNewProd(p => ({ ...p, whPackName: e.target.value }))} placeholder="Ej: Caja"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Unidades por empaque *</label>
                        <input type="number" min="1" value={newProd.whPackQty} onChange={e => setNewProd(p => ({ ...p, whPackQty: e.target.value }))} placeholder="Ej: 24"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Precio de cada empaque ({currencySymbol})</label>
                        <input type="number" min="0" step="0.01" value={newProd.whUnitPrice} onChange={e => setNewProd(p => ({ ...p, whUnitPrice: e.target.value }))} placeholder="0.00"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Cantidad de empaques *</label>
                        <p className="text-[10px] text-slate-500 mb-1">Stock inicial</p>
                        <input type="number" min="1" value={newProd.whPackCount} onChange={e => setNewProd(p => ({ ...p, whPackCount: e.target.value }))} placeholder="Ej: 5"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 mb-1 block">Descripción</label>
                        <p className="text-[10px] text-slate-500 mb-1">Se muestra en Compra/Venta a Proveedor y en el comprobante</p>
                        <textarea value={newProd.description} onChange={e => setNewProd(p => ({ ...p, description: e.target.value }))} placeholder="Ej: Presentación de 500ml, vidrio retornable…" rows={2}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors resize-none" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-slate-400 mb-1 block">Ubicación *</label>
                        <select value={newProd.whLocationId} onChange={e => setNewProd(p => ({ ...p, whLocationId: e.target.value }))}
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                          <option value="">Selecciona…</option>
                          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {saveError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg mt-3">{saveError}</p>}
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowNewProd(false)} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleAddProduct}
                  disabled={saving || !newProd.name || (newProd.destino === "inventario" ? !newProd.sku : locations.length === 0)}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />}Guardar Producto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar Producto ── */}
      {editProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditProd(null)} />
          <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2"><Edit3 size={16} className="text-amber-400" />Editar Producto</h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{editProd.sku}</p>
              </div>
              <button onClick={() => setEditProd(null)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh] space-y-4">
              {/* Identificación */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Identificación</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1 block">Nombre del producto *</label>
                    <input type="text" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">SKU *</label>
                    <input type="text" value={editForm.sku} onChange={e => setEditForm(p => ({ ...p, sku: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Unidades por Empaque</label>
                    <input type="number" min="1" value={editForm.packQty} onChange={e => setEditForm(p => ({ ...p, packQty: e.target.value }))} placeholder="Ej: 12"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 mb-1 block">Descripción</label>
                    <p className="text-[10px] text-slate-500 mb-1">Se muestra al vender y en el comprobante</p>
                    <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} placeholder="Ej: Talla M, color azul, incluye garantía de 6 meses…" rows={2}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors resize-none" />
                  </div>
                </div>
              </div>

              {/* Precios */}
              {canViewFinance && (
                <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Precios</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-emerald-400 mb-0.5 block">Costo de Venta ({currencySymbol})</label>
                      <p className="text-[10px] text-slate-500 mb-1.5">Lo que cobra al cliente</p>
                      <input type="number" min="0" step="0.01" value={editForm.price} onChange={e => setEditForm(p => ({ ...p, price: e.target.value }))}
                        className="w-full px-3 py-2 bg-slate-900 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 font-mono focus:outline-none focus:border-emerald-500 transition-colors" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-sky-400 mb-0.5 block">Costo de Compra ({currencySymbol})</label>
                      <p className="text-[10px] text-slate-500 mb-1.5">Lo que paga al proveedor</p>
                      <input type="number" min="0" step="0.01" value={editForm.cost} onChange={e => setEditForm(p => ({ ...p, cost: e.target.value }))}
                        className="w-full px-3 py-2 bg-slate-900 border border-sky-500/30 rounded-lg text-sm text-sky-300 font-mono focus:outline-none focus:border-sky-500 transition-colors" />
                    </div>
                  </div>
                  {editForm.price > 0 && editForm.cost > 0 && (() => {
                    const profit = calcProfit(editForm.price, editForm.cost);
                    const margin = calcMarginPercent(editForm.price, editForm.cost);
                    return (
                      <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs ${margin >= 0 ? "bg-amber-500/10 border-amber-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                        <span className="text-slate-400">Ganancia por unidad</span>
                        <div className="text-right">
                          <span className={`font-mono font-bold ${margin >= 0 ? "text-amber-400" : "text-red-400"}`}>{formatMoney(profit, currencySymbol)}</span>
                          <span className={`ml-2 ${margin >= 0 ? "text-amber-400" : "text-red-400"}`}>({margin.toFixed(1)}% margen)</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {!canViewFinance && (
                <div>
                  <label className="text-xs font-semibold text-emerald-400 mb-0.5 block">Costo de Venta ({currencySymbol})</label>
                  <p className="text-[10px] text-slate-500 mb-1.5">Lo que cobra al cliente por unidad</p>
                  <input type="number" min="0" step="0.01" value={editForm.price} onChange={e => setEditForm(p => ({ ...p, price: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-800 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 font-mono focus:outline-none focus:border-emerald-500 transition-colors" />
                </div>
              )}

              {/* Stock */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Stock</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Stock actual</label>
                    <input type="number" min="0" value={editForm.stock} onChange={e => setEditForm(p => ({ ...p, stock: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Stock mínimo</label>
                    <p className="text-[10px] text-slate-500 mb-1">Alerta cuando baje de aquí</p>
                    <input type="number" min="0" value={editForm.minStock} onChange={e => setEditForm(p => ({ ...p, minStock: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
                  </div>
                </div>
              </div>

              {/* Código de barras */}
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block flex items-center gap-1"><ScanBarcode size={11} />Código de Barras</label>
                <div className="flex gap-2">
                  <input value={editForm.barcode} onChange={e => setEditForm(p => ({ ...p, barcode: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500 transition-colors" />
                  <button onClick={() => setEditForm(p => ({ ...p, barcode: generateBarcode() }))}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors">
                    Generar
                  </button>
                </div>
              </div>

              {/* Vista previa código de barras */}
              {editForm.barcode && (
                <div className="mt-1">
                  <BarcodeDisplay value={editForm.barcode} height={50} />
                </div>
              )}

              {editError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg mt-3">{editError}</p>}
              <div className="flex gap-3 mt-5">
                <button onClick={() => setEditProd(null)} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
                <button onClick={handleEditSave} disabled={!editForm.name || !editForm.sku || editSaving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
                  {editSaving && <Loader2 size={14} className="animate-spin" />}<Save size={14} />Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImportExcelModal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Importar productos desde Excel"
        templateFilename="Invenxio_Plantilla_Productos"
        templateHeaders={PRODUCT_IMPORT_HEADERS}
        templateExample={PRODUCT_IMPORT_EXAMPLE}
        parseRows={parseProductImportRows}
        onImportRow={(values) => addProduct(companyId, values)}
        itemNoun="productos"
      />
    </div>
  );
};


export default InventoryModule;
