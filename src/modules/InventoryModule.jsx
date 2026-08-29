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
  addProduct, updateProduct, deleteProduct, adjustProductStock, recordPurchase,
  subscribeToProductHistory, addWarehouseProduct, addWarehouseMovement, recordWarehousePurchase,
  addPresentation,
} from "../services/firestoreService";
import { logAndGetErrorMessage } from "../utils/errors";
import { StatusBadge, Spinner, STOCK_STATUS } from "../components/shared/StatusUI";
import { BarcodeDisplay, BarcodeScanner } from "../components/BarcodeUI";
import { generateBarcode } from "../lib/barcode";
import { useAuth } from "../contexts/AuthContext";
import { formatMoney } from "../utils/currency";
import ImportExcelModal from "../components/ImportExcelModal";
import PresentationsManager from "../components/inventory/PresentationsManager";

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

// Plantilla para importar productos de ALMACÉN (independiente de la de
// Inventario — ver PRODUCT_IMPORT_HEADERS de arriba). "Ubicación" debe
// coincidir con el NOMBRE de una ubicación ya creada en Almacén → Mapa
// (no se crean ubicaciones nuevas desde acá).
const WAREHOUSE_IMPORT_HEADERS = [
  "Nombre", "SKU / Código", "Nombre de Unidad de Empaque", "Unidades por Empaque",
  "Precio de cada Empaque", "Cantidad de Empaques", "Descripción", "Ubicación",
];
const WAREHOUSE_IMPORT_EXAMPLE = [
  { "Nombre": "Coca Cola 500ml", "SKU / Código": "", "Nombre de Unidad de Empaque": "Caja", "Unidades por Empaque": 24, "Precio de cada Empaque": 50, "Cantidad de Empaques": 5, "Descripción": "", "Ubicación": "Zona A" },
  { "Nombre": "Arroz Extra 1kg", "SKU / Código": "", "Nombre de Unidad de Empaque": "Saco", "Unidades por Empaque": 12, "Precio de cada Empaque": 42, "Cantidad de Empaques": 3, "Descripción": "", "Ubicación": "Zona A" },
];
import { calcProfit, calcMarginPercent } from "../utils/finance";

// ══════════════════════════════════════════════════════════════════════════════
// MODULE 1 — INVENTORY
// ══════════════════════════════════════════════════════════════════════════════
const InventoryModule = ({
  companyId, userName, canCreate, canEdit, canDelete, canViewFinance, canManageWarehouse,
  products, loadingProducts: loadingP, suppliers, locations = [], warehouseProducts = [],
  presentations = [],
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
  // Qué formulario abrió la cámara de escaneo: null (cerrada) | "new"
  // (formulario Nuevo Producto) | "edit" (formulario Editar Producto) —
  // mismo componente BarcodeScanner que ya usa MovementsModule.jsx para el
  // punto de venta, reutilizado acá para escanear el código de barras real
  // de un producto físico al darlo de alta o corregirlo.
  const [scannerTarget, setScannerTarget] = useState(null);
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
    unitType: "unidad", // "unidad" | "peso" — ver 0019_kits_bulk_presentations.sql
    // — Jerarquía de abastecimiento Caja → Packs → Unidades (ver comentario
    // grande en handleAddProduct): la presentación "Unidad" (factor 1,
    // mismo precio/barcode del producto base) SIEMPRE se crea. Esta es la
    // SEGUNDA presentación vendible, opcional — "Pack" con su propio
    // multiplicador de stock, precio y código de barras exterior. Nombres
    // con prefijo "pres" para no confundirse con `packQty` de arriba, que
    // es un campo distinto (tamaño de LOTE de compra, no de venta).
    hasPresPack: false, presPackName: "Pack", presPackFactor: "6", presPackPrice: "", presPackBarcode: "",
    // — solo Almacén — "Precio de cada empaque" (whUnitPrice) es nuevo: antes
    // quedaba sin definir hasta que alguien lo editaba luego en Almacén →
    // Mis Productos. `whPacksPerBox` × `whUnitsPerPack` reemplaza al viejo
    // campo único "Unidades por empaque": el total de unidades base que
    // trae la Caja se CALCULA en el frontend, nunca se teclea directo (ver
    // handleAddProduct) — así se define la conversión completa Caja→Packs→
    // Unidades en vez de un solo multiplicador que obligaba a hacer la
    // cuenta a mano.
    whPackName: "Caja", whPacksPerBox: "", whUnitsPerPack: "", whUnitPrice: "", whPackCount: "", whLocationId: "",
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
  const [showImportWh, setShowImportWh] = useState(false);

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
        // BUG: antes los SKU autogenerados NUNCA se agregaban a
        // `usedInBatch`, así que si una fila más abajo en el MISMO Excel
        // traía un SKU explícito que coincidía con uno ya autogenerado acá
        // (ej. autoSkuCounter llega a "005" y otra fila explícitamente
        // puso SKU "005"), el choque no se detectaba — quedaban dos
        // productos con el mismo SKU. Ahora se salta cualquier número ya
        // usado (autogenerado o explícito) hasta encontrar uno libre.
        sku = String(autoSkuCounter).padStart(3, "0");
        while (usedInBatch.has(sku.toLowerCase()) || existingSkus.has(sku.toLowerCase())) {
          autoSkuCounter++;
          sku = String(autoSkuCounter).padStart(3, "0");
        }
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
        },
      };
    });
  }

  // Mismo ajuste que "Nuevo Producto" (ver handleAddProduct): el producto
  // se crea con stock 0, y el stock del Excel se aplica aparte — como
  // "Compra" auditada si trae costo (para que cuente como Egreso real en
  // el Historial), o como "Ajuste +" si no trae costo.
  async function importInventoryRow(values) {
    const { stock, cost, ...rest } = values;
    const newProductId = await addProduct(companyId, { ...rest, cost, stock: 0, status: "Agotado" });
    if (stock > 0 && cost > 0) {
      await recordPurchase(companyId, {
        supplierId: "", supplierName: "",
        productId: newProductId, productName: rest.name, sku: rest.sku,
        description: rest.description,
        qty: stock, unitCost: cost, total: stock * cost,
        note: "Stock inicial (importado desde Excel)", userName,
      });
    } else if (stock > 0) {
      await adjustProductStock(companyId, newProductId, { type: "add", qty: stock, user: userName });
    }
  }

  // ── Importar Excel → Almacén (independiente del de Inventario) ─────────
  // "Ubicación" tiene que coincidir con el NOMBRE de una ubicación ya
  // creada en Almacén → Mapa — acá no se crean ubicaciones nuevas.
  function parseWarehouseProductImportRows(rawRows) {
    const existingSkus = new Set(warehouseProducts.map(p => (p.sku || "").trim().toLowerCase()).filter(Boolean));
    let autoSkuCounter = parseInt(nextWhSku, 10);
    const usedInBatch = new Set();
    const locByName = {};
    locations.forEach(l => { locByName[(l.name || "").trim().toLowerCase()] = l; });

    return rawRows.map((raw) => {
      const name = String(raw["Nombre"] ?? "").trim();
      const label = name || "(sin nombre)";
      let sku = String(raw["SKU / Código"] ?? "").trim();
      const packName = String(raw["Nombre de Unidad de Empaque"] ?? "").trim() || "Caja";
      const packQty = Number(raw["Unidades por Empaque"]);
      const unitPrice = Number(raw["Precio de cada Empaque"]) || 0;
      const packCount = Number(raw["Cantidad de Empaques"]) || 0;
      const locationRaw = String(raw["Ubicación"] ?? "").trim();

      if (!name) return { ok: false, label, error: "Falta el nombre del producto." };
      if (!packQty || packQty <= 0) return { ok: false, label, error: 'La columna "Unidades por Empaque" es obligatoria y debe ser mayor a 0.' };
      if (!locationRaw) return { ok: false, label, error: 'La columna "Ubicación" es obligatoria.' };
      const loc = locByName[locationRaw.toLowerCase()];
      if (!loc) return { ok: false, label, error: `No existe ninguna ubicación de almacén llamada "${locationRaw}". Créala primero en Almacén → Mapa.` };

      if (!sku) {
        sku = String(autoSkuCounter).padStart(3, "0");
        while (usedInBatch.has(sku.toLowerCase()) || existingSkus.has(sku.toLowerCase())) {
          autoSkuCounter++;
          sku = String(autoSkuCounter).padStart(3, "0");
        }
        autoSkuCounter++;
      } else if (existingSkus.has(sku.toLowerCase()) || usedInBatch.has(sku.toLowerCase())) {
        return { ok: false, label, error: `El SKU "${sku}" ya existe en Almacén (o está repetido en este mismo archivo).` };
      }
      usedInBatch.add(sku.toLowerCase());

      return {
        ok: true,
        label: `${name} (SKU ${sku})`,
        values: {
          name, sku, packName, packQty, unitPrice, packCount,
          description: String(raw["Descripción"] ?? "").trim(),
          locationId: loc.id, locationName: loc.name,
        },
      };
    });
  }

  // Mismo criterio que Inventario: con costo → "Compra" auditada (cuenta
  // como Egreso); sin costo → "Ajuste +" (entrada de stock sin monto).
  async function importWarehouseRow(values) {
    const { packCount, unitPrice, locationId, locationName, ...rest } = values;
    const newProductId = await addWarehouseProduct(companyId, {
      name: rest.name, sku: rest.sku, description: rest.description,
      packName: rest.packName, packQty: rest.packQty, unitPrice: unitPrice || null,
    });
    if (packCount > 0 && unitPrice > 0) {
      await recordWarehousePurchase(companyId, {
        supplierId: "", supplierName: "",
        warehouseProductId: newProductId, warehouseProductName: rest.name, sku: rest.sku,
        description: rest.description,
        locationId, locationName,
        packCount, packName: rest.packName, packQty: rest.packQty,
        unitCost: unitPrice, note: "Stock inicial (importado desde Excel)", userName,
      });
    } else if (packCount > 0) {
      await addWarehouseMovement(companyId, {
        type: "entrada",
        productId: newProductId, productName: rest.name, sku: rest.sku,
        qty: packCount,
        toLocationId: locationId, toLocationName: locationName,
        reason: "Stock inicial (importado desde Excel)", userName,
        packName: rest.packName, packQty: rest.packQty,
      });
    }
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

  // Recibe el código detectado por la cámara (BarcodeScanner) y lo mete en
  // el campo "barcode" del formulario que estaba abierto cuando se apretó
  // "Escanear" — "new" (Nuevo Producto, código de la Unidad), "newPack"
  // (Nuevo Producto, código exterior de la presentación Pack) o "edit"
  // (Editar Producto).
  const handleBarcodeScan = (code) => {
    if (scannerTarget === "new") setNewProd(p => ({ ...p, barcode: code }));
    else if (scannerTarget === "newPack") setNewProd(p => ({ ...p, presPackBarcode: code }));
    else if (scannerTarget === "edit") setEditForm(p => ({ ...p, barcode: code }));
    setScannerTarget(null);
  };

  const handleAddProduct = async () => {
    if (!newProd.name) return;
    if (newProd.destino === "almacen") {
      // ── Producto nuevo → SOLO Almacén (catálogo independiente) ────────
      if (!canManageWarehouse) { setSaveError("No tienes permiso para gestionar Almacén."); return; }
      if (!newProd.whLocationId) { setSaveError("Selecciona la ubicación de almacén."); return; }
      if (!newProd.whPackName.trim()) { setSaveError('Indica el nombre de la unidad de empaque mayorista (ej: "Caja").'); return; }
      if (!newProd.whPacksPerBox || Number(newProd.whPacksPerBox) <= 0) { setSaveError("Indica cuántos packs trae la caja."); return; }
      if (!newProd.whUnitsPerPack || Number(newProd.whUnitsPerPack) <= 0) { setSaveError("Indica cuántas unidades trae cada pack."); return; }
      if (!newProd.whPackCount || Number(newProd.whPackCount) <= 0) { setSaveError("Indica la cantidad de cajas (stock inicial)."); return; }
      setSaving(true); setSaveError("");
      try {
        const loc = locations.find(l => l.id === newProd.whLocationId);
        // Jerarquía de 3 niveles Caja → Packs → Unidades: el usuario ya no
        // teclea directo el total de unidades por caja (eso invitaba a
        // errores de cálculo mental) — lo definimos como los dos factores
        // reales de la conversión y el FRONTEND multiplica una sola vez
        // acá. `total_unidades_por_caja` sigue viajando al backend como
        // el mismo `packQty` de siempre (addWarehouseProduct/
        // addWarehouseMovement no cambian de forma — para ellos una Caja
        // sigue siendo "un empaque de N unidades base", sin que les
        // importe cómo se llegó a ese N).
        const totalUnidadesPorCaja = Number(newProd.whPacksPerBox) * Number(newProd.whUnitsPerPack);
        const newWhProductId = await addWarehouseProduct(companyId, {
          name: newProd.name,
          sku: newProd.sku || nextWhSku,
          description: newProd.description || "",
          packName: newProd.whPackName.trim(),
          packQty: totalUnidadesPorCaja,
          unitPrice: newProd.whUnitPrice ? Number(newProd.whUnitPrice) : null,
        });
        await addWarehouseMovement(companyId, {
          type: "entrada",
          productId: newWhProductId, productName: newProd.name, sku: newProd.sku || nextWhSku,
          qty: Number(newProd.whPackCount),
          toLocationId: newProd.whLocationId, toLocationName: loc?.name || "",
          reason: "Stock inicial",
          userName,
          packName: newProd.whPackName.trim(), packQty: totalUnidadesPorCaja,
        });
        setShowNewProd(false);
        setNewProd(p => ({
          ...p, name: "", sku: nextWhSku, description: "",
          whPackName: "Caja", whPacksPerBox: "", whUnitsPerPack: "", whUnitPrice: "", whPackCount: "", whLocationId: "",
        }));
      } catch (err) {
        setSaveError(logAndGetErrorMessage(err, "Error al crear producto de almacén:"));
      }
      setSaving(false);
      return;
    }

    // ── Producto nuevo → SOLO Inventario (tienda) ───────────────────────
    if (!newProd.sku) return;
    // Jerarquía Caja→Packs→Unidades, lado venta: la presentación "Unidad"
    // (factor 1) se crea siempre más abajo; si el producto también se
    // vende en Packs, ambos campos son obligatorios ANTES de tocar la
    // base de datos — no tiene sentido crear el producto y dejar el pack
    // a medias si falta el factor o el precio.
    if (newProd.hasPresPack) {
      if (!newProd.presPackName.trim()) { setSaveError('Indica el nombre de la presentación "Pack".'); return; }
      if (!newProd.presPackFactor || Number(newProd.presPackFactor) <= 1) { setSaveError('El multiplicador de stock del Pack debe ser mayor a 1 (ej: "Pack x6" = 6).'); return; }
      if (newProd.presPackPrice === "" || Number(newProd.presPackPrice) < 0) { setSaveError("Indica el precio de venta del Pack."); return; }
    }
    setSaving(true); setSaveError("");
    try {
      const packQty  = Number(newProd.packQty) || 0;
      const stock    = packQty > 0 ? (Number(newProd.stock) || 0) * packQty : (Number(newProd.stock) || 0);
      const minStock = Number(newProd.minStock) || 0;
      const cost     = Number(newProd.cost) || 0;
      const sku = newProd.sku;
      const description = newProd.description || "";
      // BUG QUE ESTO CORRIGE: antes el stock inicial se guardaba directo en
      // el INSERT del producto — nunca generaba ninguna transacción, así
      // que aunque tuviera un costo (ej. "compré 1 unidad a S/3 antes de
      // tener el sistema"), ese costo NUNCA aparecía como "Egreso" en el
      // Historial general (que solo cuenta compras REGISTRADAS, no lo que
      // diga el campo "costo" de la ficha del producto). Ahora: el producto
      // se crea SIEMPRE con stock 0, y si trae stock inicial se aplica
      // aparte — como una "Compra" auditada (si tiene costo, para que sí
      // cuente como egreso real) o como un "Ajuste +" (si no tiene costo,
      // ej. una donación o un conteo inicial sin costo conocido).
      const newProductId = await addProduct(companyId, {
        name: newProd.name,
        sku,
        description,
        price: Number(newProd.price) || 0,
        cost,
        stock: 0,
        minStock,
        packQty: packQty || null,
        barcode: newProd.barcode || generateBarcode(),
        status: "Agotado",
        unitType: newProd.unitType,
        baseUnitLabel: newProd.unitType === "peso" ? "kg" : "un",
      });

      // Presentación base automática (nivel 1 de la jerarquía: la Unidad
      // suelta, factor 1) — así el producto ya aparece listo para vender
      // en el POS sin que el admin tenga que acordarse de crearla a mano
      // (ver PresentationsManager.jsx para agregar más: packs, cajas,
      // sacos, etc. después de creado el producto).
      await addPresentation(companyId, newProductId, {
        name: newProd.unitType === "peso" ? "Kilogramo" : "Unidad",
        factor: 1,
        price: Number(newProd.price) || 0,
        isDefaultSale: true,
        isPurchaseOnly: false,
      });

      // Presentación "Pack" (nivel 2 de la jerarquía Caja→Packs→Unidades)
      // — opcional, solo si el admin marcó "también se vende por Pack".
      // Mismo `factor` que ya usa el resto del sistema de presentaciones
      // (ver 0019_kits_bulk_presentations.sql): "¿a cuántas unidades BASE
      // equivale UNA de esta presentación?" — record_sale_v2 y el POS no
      // necesitan saber nada especial de esta jerarquía, la tratan como
      // cualquier otra presentación con su propio factor y precio.
      if (newProd.hasPresPack) {
        await addPresentation(companyId, newProductId, {
          name: newProd.presPackName.trim(),
          factor: Number(newProd.presPackFactor),
          price: Number(newProd.presPackPrice) || 0,
          barcode: newProd.presPackBarcode.trim() || null,
          isDefaultSale: false,
          isPurchaseOnly: false,
        });
      }

      if (stock > 0 && cost > 0) {
        await recordPurchase(companyId, {
          supplierId: "", supplierName: "",
          productId: newProductId, productName: newProd.name, sku,
          description,
          qty: stock, unitCost: cost, total: stock * cost,
          note: "Stock inicial al crear el producto", userName,
        });
      } else if (stock > 0) {
        await adjustProductStock(companyId, newProductId, { type: "add", qty: stock, user: userName });
      }

      setShowNewProd(false);
      setNewProd(p => ({
        ...p, name: "", sku: nextSku, description: "", price: "", cost: "", stock: "", minStock: "4", packQty: "", barcode: "",
        hasPresPack: false, presPackName: "Pack", presPackFactor: "6", presPackPrice: "", presPackBarcode: "",
      }));
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
      // BUG QUE ESTO CORRIGE: antes "stock" se guardaba acá mismo, junto con
      // el resto de los campos, en un simple UPDATE — un cambio de stock
      // hecho desde Editar Producto no quedaba en ningún lado (ni quién lo
      // hizo, ni cuándo, ni aparecía en el Historial general), a diferencia
      // del botón dedicado "Ajustar stock +/-" que sí pasa por
      // adjustProductStock() y deja rastro en product_history. Ahora: el
      // resto de los campos se guarda acá como antes (con el status
      // calculado sobre el stock TODAVÍA sin cambiar), y si el stock
      // cambió, se aplica aparte más abajo con esa misma función auditada
      // — así cualquier corrección de stock, venga de donde venga, siempre
      // queda registrada igual.
      const statusBeforeStockChange = editProd.stock === 0 ? "Agotado" : editProd.stock <= finalMinStock ? "Stock Bajo" : "En Stock";

      await updateProduct(companyId, editProd.id, {
        name: editForm.name,
        sku: editForm.sku,
        description: editForm.description || "",
        price: !isNaN(price) ? price : editProd.price,
        cost: !isNaN(cost) ? cost : editProd.cost,
        minStock: finalMinStock,
        packQty: editForm.packQty ? Number(editForm.packQty) : null,
        barcode: editForm.barcode || editProd.barcode || generateBarcode(),
        status: statusBeforeStockChange,
      });

      const stockDelta = finalStock - editProd.stock;
      if (stockDelta !== 0) {
        await adjustProductStock(companyId, editProd.id, {
          type: stockDelta > 0 ? "add" : "remove",
          qty: Math.abs(stockDelta),
          user: userName,
        });
      }

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
              <FileSpreadsheet size={15} /> <span className="hidden sm:inline">Importar</span> Inventario
            </button>
            {canManageWarehouse && (
              <button onClick={() => setShowImportWh(true)}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-sm rounded-lg transition-colors">
                <FileSpreadsheet size={15} /> <span className="hidden sm:inline">Importar</span> Almacén
              </button>
            )}
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

              {/* Presentaciones de venta (kits/packs/granel) */}
              <PresentationsManager
                companyId={companyId} product={selectedProduct} presentations={presentations}
                canEdit={canEdit} canDelete={canDelete} currencySymbol={currencySymbol}
              />

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
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Se vende por</label>
                        <div className="flex gap-1.5">
                          {[{ v: "unidad", l: "Unidad" }, { v: "peso", l: "Peso (kg)" }].map(o => (
                            <button key={o.v} type="button" onClick={() => setNewProd(p => ({ ...p, unitType: o.v }))}
                              className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${newProd.unitType === o.v ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                              {o.l}
                            </button>
                          ))}
                        </div>
                        {newProd.unitType === "peso" && (
                          <p className="text-[10px] text-slate-500 mt-1">El stock se maneja en KG con hasta 3 decimales (ej: 0.650 kg).</p>
                        )}
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
                      <button onClick={() => setScannerTarget("new")}
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap flex items-center gap-1">
                        <ScanBarcode size={13} /> Escanear
                      </button>
                      <button onClick={() => setNewProd(p => ({ ...p, barcode: generateBarcode() }))}
                        className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                        Generar
                      </button>
                    </div>
                  </div>

                  {/* Presentaciones de Venta — jerarquía Caja→Packs→Unidades,
                      lado venta. La fila "Unidad" es siempre la base
                      (factor 1, mismo precio/código de arriba) y se crea
                      automáticamente al guardar — se muestra acá solo como
                      referencia, ya está definida por los campos de arriba.
                      La fila "Pack" es la segunda presentación vendible,
                      opcional, con su propio multiplicador de stock, precio
                      y código de barras exterior (el pack suele traer su
                      propio EAN, distinto al de la unidad suelta). Para
                      agregar más niveles (ej. una Caja vendible) o editarlos
                      después, se usa PresentationsManager.jsx una vez creado
                      el producto. */}
                  <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Presentaciones de Venta</p>

                    <div className="flex items-center justify-between gap-2 bg-slate-900/40 rounded-lg p-2.5 border border-slate-700/50 opacity-80">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium">{newProd.unitType === "peso" ? "Kilogramo" : "Unidad"}</p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          1 = 1 {newProd.unitType === "peso" ? "kg" : "un"} base · {formatMoney(Number(newProd.price) || 0, currencySymbol)}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">Siempre incluida</span>
                    </div>

                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={newProd.hasPresPack}
                        onChange={e => setNewProd(p => ({ ...p, hasPresPack: e.target.checked }))}
                        className="accent-amber-500" />
                      Este producto también se vende por Pack
                    </label>

                    {newProd.hasPresPack && (
                      <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700/50 space-y-2.5">
                        <div>
                          <label className="text-[11px] text-slate-400 mb-1 block">Nombre de la presentación</label>
                          <input value={newProd.presPackName} onChange={e => setNewProd(p => ({ ...p, presPackName: e.target.value }))}
                            placeholder='Ej: "Pack"'
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-slate-400 mb-1 block">Multiplicador de stock</label>
                            <p className="text-[10px] text-slate-500 mb-1">Unidades base por Pack (ej: 6)</p>
                            <input type="number" min="1" step="1" value={newProd.presPackFactor}
                              onChange={e => setNewProd(p => ({ ...p, presPackFactor: e.target.value }))}
                              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition-colors" />
                          </div>
                          <div>
                            <label className="text-[11px] text-slate-400 mb-1 block">Precio de venta ({currencySymbol})</label>
                            <input type="number" min="0" step="0.01" value={newProd.presPackPrice}
                              onChange={e => setNewProd(p => ({ ...p, presPackPrice: e.target.value }))} placeholder="0.00"
                              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 mb-1 block">Código de barras exterior (opcional)</label>
                          <p className="text-[10px] text-slate-500 mb-1">El código propio del pack — distinto al de la unidad suelta</p>
                          <div className="flex gap-2">
                            <input value={newProd.presPackBarcode} onChange={e => setNewProd(p => ({ ...p, presPackBarcode: e.target.value }))}
                              placeholder="Opcional"
                              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                            <button onClick={() => setScannerTarget("newPack")}
                              className="px-3 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-500 text-slate-200 text-xs rounded-lg transition-colors whitespace-nowrap flex items-center gap-1">
                              <ScanBarcode size={13} /> Escanear
                            </button>
                          </div>
                        </div>
                        {newProd.presPackFactor > 0 && newProd.presPackPrice !== "" && (
                          <p className="text-[10px] text-slate-500">
                            1 {newProd.presPackName || "Pack"} = {newProd.presPackFactor} {newProd.unitType === "peso" ? "kg" : "un"} base · {formatMoney(Number(newProd.presPackPrice) || 0, currencySymbol)}
                          </p>
                        )}
                      </div>
                    )}
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
                        <label className="text-xs text-slate-400 mb-1 block">Nombre de la unidad mayorista *</label>
                        <input value={newProd.whPackName} onChange={e => setNewProd(p => ({ ...p, whPackName: e.target.value }))} placeholder="Ej: Caja"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Cantidad de {newProd.whPackName.trim() || "cajas"} *</label>
                        <p className="text-[10px] text-slate-500 mb-1">Stock inicial</p>
                        <input type="number" min="1" value={newProd.whPackCount} onChange={e => setNewProd(p => ({ ...p, whPackCount: e.target.value }))} placeholder="Ej: 5"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                      </div>

                      {/* Conversión de 2 niveles: en vez de teclear directo
                          "unidades por empaque" (invitaba a errores de
                          cálculo mental cuando el empaque mayorista trae
                          sub-empaques), se definen los dos factores reales
                          de la cadena de abastecimiento y el total se
                          calcula solo — ver handleAddProduct. */}
                      <div className="col-span-2 bg-slate-900/40 border border-slate-700/50 rounded-lg p-3 space-y-2.5">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Conversión — {newProd.whPackName.trim() || "Caja"} → Packs → Unidades</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">¿Cuántos packs trae {newProd.whPackName.trim() ? `la ${newProd.whPackName.trim().toLowerCase()}` : "la caja"}? *</label>
                            <input type="number" min="1" value={newProd.whPacksPerBox} onChange={e => setNewProd(p => ({ ...p, whPacksPerBox: e.target.value }))} placeholder="Ej: 10"
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">¿Cuántas unidades trae cada pack? *</label>
                            <input type="number" min="1" value={newProd.whUnitsPerPack} onChange={e => setNewProd(p => ({ ...p, whUnitsPerPack: e.target.value }))} placeholder="Ej: 6"
                              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                          </div>
                        </div>
                        {Number(newProd.whPacksPerBox) > 0 && Number(newProd.whUnitsPerPack) > 0 && (
                          <p className="text-[11px] text-amber-400/90">
                            = {Number(newProd.whPacksPerBox) * Number(newProd.whUnitsPerPack)} unidades base por {newProd.whPackName.trim() || "Caja"}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Precio de cada {newProd.whPackName.trim() || "Caja"} ({currencySymbol})</label>
                        <input type="number" min="0" step="0.01" value={newProd.whUnitPrice} onChange={e => setNewProd(p => ({ ...p, whUnitPrice: e.target.value }))} placeholder="0.00"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
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
                  <button onClick={() => setScannerTarget("edit")}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs rounded-lg transition-colors flex items-center gap-1">
                    <ScanBarcode size={13} /> Escanear
                  </button>
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
        title="Importar productos a Inventario desde Excel"
        templateFilename="Invenxio_Plantilla_Productos"
        templateHeaders={PRODUCT_IMPORT_HEADERS}
        templateExample={PRODUCT_IMPORT_EXAMPLE}
        parseRows={parseProductImportRows}
        onImportRow={importInventoryRow}
        itemNoun="productos"
      />

      {canManageWarehouse && (
        <ImportExcelModal
          open={showImportWh}
          onClose={() => setShowImportWh(false)}
          title="Importar productos a Almacén desde Excel"
          templateFilename="Invenxio_Plantilla_Almacen"
          templateHeaders={WAREHOUSE_IMPORT_HEADERS}
          templateExample={WAREHOUSE_IMPORT_EXAMPLE}
          parseRows={parseWarehouseProductImportRows}
          onImportRow={importWarehouseRow}
          itemNoun="productos de almacén"
        />
      )}

      {scannerTarget && (
        <BarcodeScanner onDetected={handleBarcodeScan} onClose={() => setScannerTarget(null)} />
      )}
    </div>
  );
};


export default InventoryModule;
