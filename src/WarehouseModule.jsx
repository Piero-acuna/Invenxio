// src/WarehouseModule.jsx
// Módulo completo de Almacén: ubicaciones físicas + entradas/salidas + historial
import { useState, useEffect, useMemo } from "react";
import {
  Warehouse, Plus, X, Edit3, Trash2, ArrowUpCircle, ArrowDownCircle,
  MoveRight, Send, Package, Search, RefreshCw, CheckCircle, AlertTriangle,
  MapPin, Tag, History, Filter, List, LayoutGrid, Store, Boxes,
} from "lucide-react";
import {
  subscribeToLocations, addLocation, updateLocation, deleteLocation,
  subscribeToWarehouseStock, subscribeToWarehouseMovements,
  addWarehouseMovement,
  subscribeToWarehouseProducts, addWarehouseProduct, updateWarehouseProduct, deleteWarehouseProduct,
  sendWarehouseToInventory,
} from "./services/firestoreService";
import { useAuth } from "./contexts/AuthContext";
import { formatMoney } from "./utils/currency";
import { calcUnitsFromPacks } from "./utils/packaging";

// ── Helpers ──────────────────────────────────────────────────────────────────
const LOCATION_TYPES = ["Zona", "Estante", "Pasillo", "Refrigerador", "Bodega", "Otro"];
const MOVEMENT_TYPES = [
  { id: "entrada",  label: "Entrada",  icon: <ArrowUpCircle size={14} />,   color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  { id: "salida",   label: "Salida",   icon: <ArrowDownCircle size={14} />, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30"       },
  { id: "traslado", label: "Traslado", icon: <MoveRight size={14} />,       color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/30"       },
  { id: "envio_inventario", label: "Enviar a Tienda", icon: <Send size={14} />, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
];
const TYPE_CFG = Object.fromEntries(MOVEMENT_TYPES.map(t => [t.id, t]));

function useWarehouseData(companyId) {
  const [locations,        setLocations]        = useState([]);
  const [stock,            setStock]            = useState([]);
  const [movements,        setMovements]        = useState([]);
  const [warehouseProducts,setWarehouseProducts]= useState([]);
  const [loading,          setLoading]          = useState(true);

  useEffect(() => {
    if (!companyId) return;
    let done = 0;
    const check = () => { if (++done >= 4) setLoading(false); };
    const u1 = subscribeToLocations(companyId, d => { setLocations(d); check(); });
    const u2 = subscribeToWarehouseStock(companyId, d => { setStock(d); check(); });
    const u3 = subscribeToWarehouseMovements(companyId, d => { setMovements(d); check(); });
    const u4 = subscribeToWarehouseProducts(companyId, d => { setWarehouseProducts(d); check(); });
    return () => { u1(); u2(); u3(); u4(); };
  }, [companyId]);

  return { locations, stock, movements, warehouseProducts, loading };
}

// ── Componente principal ──────────────────────────────────────────────────────
// `storeProducts` = catálogo de la TIENDA (colección "products"). El almacén
// solo lo usa como lista de destino posible en "Enviar a Tienda" — nunca para
// elegir qué hay en el almacén. El almacén tiene su propio catálogo
// (`warehouseProducts`) que se gestiona en la pestaña "Mis Productos".
export default function WarehouseModule({ companyId, userName, storeProducts = [], canManage }) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  const { locations, stock, movements, warehouseProducts, loading } = useWarehouseData(companyId);
  const [wTab, setWTab] = useState("mapa");   // "mapa" | "productos" | "movimiento" | "historial"

  // Stock agrupado por ubicación
  const stockByLocation = useMemo(() => {
    const map = {};
    stock.forEach(s => {
      if (!map[s.locationId]) map[s.locationId] = [];
      map[s.locationId].push(s);
    });
    return map;
  }, [stock]);

  // Stock agrupado por producto (de almacén)
  const stockByProduct = useMemo(() => {
    const map = {};
    stock.forEach(s => {
      if (!map[s.productId]) map[s.productId] = [];
      map[s.productId].push(s);
    });
    return map;
  }, [stock]);

  const INNER_TABS = [
    { id: "mapa",       label: "🗺 Mapa del Almacén"  },
    { id: "productos",  label: "📦 Mis Productos",        hide: !canManage },
    { id: "movimiento", label: "🔁 Registrar Movimiento", hide: !canManage },
    { id: "historial",  label: "📋 Historial"           },
  ].filter(t => !t.hide);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw size={24} className="animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Inner tabs */}
      <div className="flex w-full sm:w-fit gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 overflow-x-auto">
        {INNER_TABS.map(t => (
          <button key={t.id} onClick={() => setWTab(t.id)}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${wTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {wTab === "mapa"       && <MapaTab       locations={locations} stockByLocation={stockByLocation} stockByProduct={stockByProduct} warehouseProducts={warehouseProducts} canManage={canManage} companyId={companyId} stock={stock} currencySymbol={currencySymbol} />}
      {wTab === "productos"  && canManage && <ProductosTab warehouseProducts={warehouseProducts} stockByProduct={stockByProduct} locations={locations} userName={userName} companyId={companyId} currencySymbol={currencySymbol} />}
      {wTab === "movimiento" && canManage && <MovimientoTab locations={locations} warehouseProducts={warehouseProducts} storeProducts={storeProducts} companyId={companyId} userName={userName} stockByProduct={stockByProduct} />}
      {wTab === "historial"  && <HistorialTab  movements={movements} />}
    </div>
  );
}

// ── Pestaña: Mapa del Almacén ─────────────────────────────────────────────────
function MapaTab({ locations, stockByLocation, stockByProduct, warehouseProducts, canManage, companyId, stock, currencySymbol }) {
  const [showLocForm,  setShowLocForm]  = useState(false);
  const [editLoc,      setEditLoc]      = useState(null);
  const [locForm,      setLocForm]      = useState({ name: "", type: "Zona", code: "", description: "" });
  const [savingLoc,    setSavingLoc]    = useState(false);
  const [locError,     setLocError]     = useState("");
  const [view,         setView]         = useState("ubicaciones"); // "ubicaciones" | "productos"
  const [search,       setSearch]       = useState("");

  async function handleSaveLoc() {
    if (!locForm.name.trim()) { setLocError("El nombre es obligatorio."); return; }
    setLocError(""); setSavingLoc(true);
    try {
      if (editLoc) {
        await updateLocation(companyId, editLoc.id, locForm);
      } else {
        await addLocation(companyId, locForm);
      }
      setLocForm({ name: "", type: "Zona", code: "", description: "" });
      setEditLoc(null); setShowLocForm(false);
    } catch (e) { setLocError(e?.message || "Error al guardar."); }
    setSavingLoc(false);
  }

  async function handleDeleteLoc(loc) {
    if (!confirm(`¿Eliminar la ubicación "${loc.name}"? El stock registrado aquí se perderá.`)) return;
    try { await deleteLocation(companyId, loc.id); } catch (e) { console.error(e); }
  }

  // Mapa rápido productId → producto (para sacar packName/packQty/unitPrice,
  // ya que el stock por ubicación solo guarda productId/qty).
  const productMap = useMemo(() => Object.fromEntries(warehouseProducts.map(p => [p.id, p])), [warehouseProducts]);

  // Stats globales — el stock siempre se cuenta en EMPAQUES completos (cajas),
  // nunca en unidades sueltas.
  const totalPacks = stock.reduce((s, i) => s + (i.qty || 0), 0);
  const totalLocs  = locations.length;
  const fullLocs   = locations.filter(l => (stockByLocation[l.id] || []).some(s => s.qty > 0)).length;

  const filteredLocations = locations.filter(l =>
    l.name?.toLowerCase().includes(search.toLowerCase()) ||
    l.code?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredProducts = warehouseProducts.filter(p =>
    (p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())) &&
    stockByProduct[p.id]?.some(s => s.qty > 0)
  );

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "Ubicaciones",   value: totalLocs,                    color: "text-amber-400" },
          { label: "Ocupadas",      value: `${fullLocs}/${totalLocs}`,   color: "text-sky-400" },
          { label: "Empaques total",value: totalPacks,                   color: "text-emerald-400" },
        ].map((s,i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
            <p className={`text-lg sm:text-xl font-bold font-mono mt-0.5 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-36">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
        {/* Vista */}
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button onClick={() => setView("ubicaciones")} title="Ver por ubicación"
            className={`p-1.5 rounded ${view === "ubicaciones" ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><MapPin size={13}/></button>
          <button onClick={() => setView("productos")} title="Ver por producto"
            className={`p-1.5 rounded ${view === "productos" ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}><Package size={13}/></button>
        </div>
        {canManage && (
          <button onClick={() => { setShowLocForm(true); setEditLoc(null); setLocForm({ name: "", type: "Zona", code: "", description: "" }); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded-lg transition-colors">
            <Plus size={13} /> Nueva Ubicación
          </button>
        )}
      </div>

      {/* Formulario nueva/editar ubicación */}
      {showLocForm && canManage && (
        <div className="p-4 bg-slate-800/60 border border-slate-700 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white">{editLoc ? "Editar ubicación" : "Nueva ubicación"}</p>
            <button onClick={() => { setShowLocForm(false); setEditLoc(null); }} className="text-slate-500 hover:text-slate-300"><X size={15}/></button>
          </div>
          {locError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">{locError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input value={locForm.name} onChange={e => setLocForm(f => ({...f, name: e.target.value}))} placeholder="Zona A / Estante 1"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Código</label>
              <input value={locForm.code} onChange={e => setLocForm(f => ({...f, code: e.target.value}))} placeholder="A1"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Tipo</label>
              <select value={locForm.type} onChange={e => setLocForm(f => ({...f, type: e.target.value}))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                {LOCATION_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
              <input value={locForm.description} onChange={e => setLocForm(f => ({...f, description: e.target.value}))} placeholder="Opcional…"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowLocForm(false); setEditLoc(null); }} className="flex-1 py-2 text-xs border border-slate-700 text-slate-400 rounded-lg hover:border-slate-600 transition-colors">Cancelar</button>
            <button onClick={handleSaveLoc} disabled={savingLoc}
              className="flex-1 py-2 text-xs bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold rounded-lg transition-colors flex items-center justify-center gap-1">
              {savingLoc ? <RefreshCw size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
              {editLoc ? "Guardar cambios" : "Crear ubicación"}
            </button>
          </div>
        </div>
      )}

      {/* Vista por Ubicación */}
      {view === "ubicaciones" && (
        filteredLocations.length === 0 ? (
          <EmptyState icon={<MapPin size={28}/>} msg={locations.length === 0 ? "Aún no hay ubicaciones en el almacén." : "Sin resultados para tu búsqueda."} sub={canManage && locations.length === 0 ? "Crea tu primera ubicación con el botón de arriba." : ""} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredLocations.map(loc => {
              const items      = stockByLocation[loc.id] || [];
              const withStock  = items.filter(i => i.qty > 0);
              const totalQty   = withStock.reduce((s, i) => s + (i.qty || 0), 0);
              const isOccupied = withStock.length > 0;
              return (
                <div key={loc.id} className={`bg-slate-800/60 border rounded-xl p-4 space-y-3 ${isOccupied ? "border-slate-600" : "border-slate-700/40"}`}>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={isOccupied ? "text-amber-400" : "text-slate-600"}><Warehouse size={13}/></span>
                        <p className="text-sm font-bold text-white truncate">{loc.name}</p>
                        {loc.code && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">{loc.code}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-slate-500">{loc.type}{loc.description ? ` · ${loc.description}` : ""}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${isOccupied ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-700/50 border-slate-700 text-slate-600"}`}>
                          {isOccupied ? "● Ocupada" : "○ Vacía"}
                        </span>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => { setEditLoc(loc); setLocForm({ name: loc.name, type: loc.type, code: loc.code||"", description: loc.description||"" }); setShowLocForm(true); }}
                          className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"><Edit3 size={12}/></button>
                        <button onClick={() => handleDeleteLoc(loc)}
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={12}/></button>
                      </div>
                    )}
                  </div>

                  {/* Productos en esta ubicación */}
                  <div className="border-t border-slate-700/50 pt-2.5 space-y-2.5 min-h-[2.5rem]">
                    {withStock.length === 0 ? (
                      <div className="flex items-center gap-2 py-1">
                        <Package size={12} className="text-slate-700 flex-shrink-0"/>
                        <span className="text-xs text-slate-600 italic">Sin mercancía asignada</span>
                      </div>
                    ) : (
                      withStock.map(item => {
                        const prod = productMap[item.productId];
                        const packName  = prod?.packName || "empaque";
                        const packQty   = Number(prod?.packQty) || 1;
                        const unitPrice = Number(prod?.unitPrice) || 0;
                        const totalUnits = item.qty * packQty;
                        return (
                          <div key={item.id} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 mt-0.5"/>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-200 truncate font-medium">{item.productName}</p>
                                {item.sku && <p className="text-[10px] font-mono text-slate-500">{item.sku}</p>}
                              </div>
                              <div className="flex-shrink-0 bg-slate-700/60 border border-slate-600 px-2 py-0.5 rounded-lg text-right">
                                <span className="text-xs font-bold font-mono text-amber-400">{item.qty}</span>
                                <span className="text-[10px] text-slate-500"> {packName}</span>
                              </div>
                            </div>
                            {/* Equivalencia en unidades y precio */}
                            <div className="ml-3.5 px-2 py-1.5 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-0.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-amber-400/80">= {totalUnits} unidades</span>
                                <span className="text-slate-500 font-mono">×{packQty} und/{packName}</span>
                              </div>
                              {unitPrice > 0 && (
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-emerald-400/80">{formatMoney(unitPrice, currencySymbol)} / und</span>
                                  <span className="text-slate-600">Total: {formatMoney(unitPrice * totalUnits, currencySymbol)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-[11px] border-t border-slate-700/50 pt-2">
                    <span className="text-slate-500">{withStock.length} {withStock.length === 1 ? "producto" : "productos"}</span>
                    {totalQty > 0 && <span className="font-mono font-bold text-amber-400">{totalQty} empaques total</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Vista por Producto */}
      {view === "productos" && (
        filteredProducts.length === 0 ? (
          <EmptyState icon={<Package size={28}/>} msg="No hay productos con stock registrado en el almacén." sub="Registra una entrada de mercancía en la pestaña Registrar Movimiento." />
        ) : (
          <div className="space-y-2">
            {filteredProducts.map(p => {
              const locs = (stockByProduct[p.id] || []).filter(s => s.qty > 0);
              const totalQty = locs.reduce((s, l) => s + (l.qty || 0), 0);
              return (
                <div key={p.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{p.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">{p.sku}</p>
                    </div>
                    <span className="font-mono font-bold text-amber-400 flex-shrink-0 ml-3">{totalQty} {p.packName || "empaques"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {locs.map(l => (
                      <span key={l.id} className="text-[11px] px-2 py-0.5 bg-slate-700 border border-slate-600 rounded-full text-slate-300">
                        📍 {l.locationName}: <span className="font-mono font-bold text-amber-400">{l.qty}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

// ── Pestaña: Mis Productos (catálogo propio del almacén) ─────────────────────
// Aquí el almacén define SUS artículos: nombre, código, cómo vienen empacados
// (ej. "Caja" de 24 unidades), precio por unidad, y dónde están guardados.
// Este catálogo es independiente del inventario de la tienda: nada de lo que
// se crea aquí aparece automáticamente en la tienda hasta que se use
// "Enviar a Tienda". El stock siempre se cuenta en EMPAQUES completos
// (cajas), nunca en unidades sueltas.
function ProductosTab({ warehouseProducts, stockByProduct, locations, userName, companyId, currencySymbol }) {
  const EMPTY_FORM = { name: "", sku: "", description: "", packName: "", packQty: "", unitPrice: "", locationId: "", packCount: "" };
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [search,   setSearch]   = useState("");
  const [stockFor, setStockFor] = useState(null); // producto para el que se abrió "Agregar Stock"

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function openNew() { setEditItem(null); setForm(EMPTY_FORM); setError(""); setShowForm(true); }
  function openEdit(p) {
    setEditItem(p);
    setForm({ ...EMPTY_FORM, name: p.name || "", sku: p.sku || "", description: p.description || "", packName: p.packName || "", packQty: p.packQty ?? "", unitPrice: p.unitPrice ?? "" });
    setError(""); setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim())              { setError("El nombre es obligatorio."); return; }
    if (!form.packName.trim())          { setError("Indica la unidad de empaque (ej: Caja, Paquete)."); return; }
    if (!form.packQty || Number(form.packQty) <= 0) { setError("Indica cuántas unidades trae cada empaque."); return; }
    if (!editItem) {
      if (!form.locationId)             { setError("Selecciona la ubicación donde está guardado."); return; }
      if (!form.packCount || Number(form.packCount) <= 0) { setError("Indica la cantidad de empaques (cajas)."); return; }
    }
    setError(""); setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        description: form.description.trim(),
        packName: form.packName.trim(),
        packQty: Number(form.packQty),
        unitPrice: form.unitPrice ? Number(form.unitPrice) : null,
      };
      if (editItem) {
        await updateWarehouseProduct(companyId, editItem.id, payload);
      } else {
        const ref = await addWarehouseProduct(companyId, payload);
        // Stock inicial: siempre junto con la creación, contado en empaques.
        const loc = locations.find(l => l.id === form.locationId);
        await addWarehouseMovement(companyId, {
          type: "entrada",
          productId: ref.id, productName: payload.name, sku: payload.sku,
          qty: Number(form.packCount),
          toLocationId: form.locationId, toLocationName: loc?.name || "",
          reason: "Stock inicial",
          userName,
          packName: payload.packName, packQty: payload.packQty,
        });
      }
      setShowForm(false); setEditItem(null); setForm(EMPTY_FORM);
    } catch (e) { setError(e?.message || "Error al guardar el producto."); }
    setSaving(false);
  }

  async function handleDelete(p) {
    const hasStock = (stockByProduct[p.id] || []).some(s => s.qty > 0);
    if (hasStock) { alert("No puedes eliminar un producto con stock registrado en alguna ubicación. Trasládalo o envíalo a la tienda primero."); return; }
    if (!confirm(`¿Eliminar "${p.name}" del catálogo de almacén?`)) return;
    try { await deleteWarehouseProduct(companyId, p.id); } catch (e) { console.error(e); }
  }

  const filtered = warehouseProducts.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl text-xs text-sky-300">
        <Boxes size={14} className="flex-shrink-0 mt-0.5" />
        <span>Este es el catálogo propio del almacén. Es independiente del inventario de la tienda — para abastecer la tienda usa <strong>Registrar Movimiento → Enviar a Tienda</strong>. El stock se cuenta siempre en empaques completos (cajas).</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-36">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs rounded-lg transition-colors">
          <Plus size={13} /> Nuevo Producto de Almacén
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-slate-800/60 border border-slate-700 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white">{editItem ? "Editar producto" : "Nuevo producto de almacén"}</p>
            <button onClick={() => { setShowForm(false); setEditItem(null); }} className="text-slate-500 hover:text-slate-300"><X size={15}/></button>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Nombre *</label>
              <input value={form.name} onChange={e => setF("name", e.target.value)} placeholder="Ej: Gaseosa Cola 500ml"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Código</label>
              <input value={form.sku} onChange={e => setF("sku", e.target.value)} placeholder="Opcional"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Descripción</label>
              <textarea value={form.description} onChange={e => setF("description", e.target.value)} placeholder="Ej: Presentación de 500ml, caja de 24 unidades" rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors resize-none"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Unidad por empaque *</label>
              <input value={form.packName} onChange={e => setF("packName", e.target.value)} placeholder="Ej: Caja"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Unidades por empaque *</label>
              <input type="number" min="1" value={form.packQty} onChange={e => setF("packQty", e.target.value)} placeholder="Ej: 24"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Precio de cada uno ({currencySymbol})</label>
              <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e => setF("unitPrice", e.target.value)} placeholder="0.00"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
            </div>

            {!editItem && (<>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Ubicación *</label>
                <select value={form.locationId} onChange={e => setF("locationId", e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                  <option value="">Selecciona…</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Cantidad de empaques *</label>
                <input type="number" min="1" value={form.packCount} onChange={e => setF("packCount", e.target.value)} placeholder="Ej: 5"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
              </div>
            </>)}
          </div>
          {!editItem && form.packQty && form.packCount && (
            <p className="text-[11px] text-amber-400/80">📦 {form.packCount} {form.packName || "empaques"} × {form.packQty} und = {calcUnitsFromPacks(form.packCount, form.packQty)} unidades en total</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setShowForm(false); setEditItem(null); }} className="flex-1 py-2 text-xs border border-slate-700 text-slate-400 rounded-lg hover:border-slate-600 transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 text-xs bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold rounded-lg transition-colors flex items-center justify-center gap-1">
              {saving ? <RefreshCw size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
              {editItem ? "Guardar cambios" : "Crear producto"}
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={<Boxes size={28}/>} msg={warehouseProducts.length === 0 ? "Aún no has creado productos de almacén." : "Sin resultados para tu búsqueda."} sub={warehouseProducts.length === 0 ? "Crea el primero con el botón de arriba." : ""} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(p => {
            const locs = (stockByProduct[p.id] || []).filter(s => s.qty > 0);
            const totalPacks = locs.reduce((s, i) => s + (i.qty || 0), 0);
            return (
              <div key={p.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{p.name}</p>
                    {p.sku && <p className="text-[10px] font-mono text-slate-500">{p.sku}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(p)} className="p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-700 rounded-lg transition-colors"><Edit3 size={12}/></button>
                    <button onClick={() => handleDelete(p)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={12}/></button>
                  </div>
                </div>
                <p className="text-[11px] text-amber-400/80">📦 {p.packName} × {p.packQty} und{Number(p.unitPrice) > 0 ? ` · ${formatMoney(p.unitPrice, currencySymbol)} c/u` : ""}</p>
                {p.description && <p className="text-[11px] text-slate-500 leading-snug">{p.description}</p>}

                {/* Ubicación, nombre y cantidad por ubicación */}
                <div className="border-t border-slate-700/50 pt-2 space-y-1">
                  {locs.length === 0 ? (
                    <p className="text-[11px] text-slate-600 italic">Sin stock en ninguna ubicación</p>
                  ) : locs.map(l => (
                    <div key={l.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 flex items-center gap-1"><MapPin size={10} className="text-amber-400"/>{l.locationName}</span>
                      <span className="font-mono font-bold text-amber-400">{l.qty} {p.packName}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-slate-700/50 pt-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Total</span>
                  <span className="font-mono font-bold text-amber-400">{totalPacks} {p.packName}</span>
                </div>
                <button onClick={() => setStockFor(p)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors">
                  <Plus size={11}/> Agregar Stock
                </button>
              </div>
            );
          })}
        </div>
      )}

      {stockFor && (
        <AddStockModal product={stockFor} locations={locations} companyId={companyId} userName={userName} onClose={() => setStockFor(null)} />
      )}
    </div>
  );
}

// ── Modal: Agregar Stock a un producto de almacén existente ─────────────────
// Siempre se cuenta en empaques (cajas), igual que el resto del almacén.
function AddStockModal({ product, locations, companyId, userName, onClose }) {
  const [locationId, setLocationId] = useState("");
  const [packCount,   setPackCount]  = useState("");
  const [reason,      setReason]     = useState("");
  const [saving,       setSaving]    = useState(false);
  const [error,        setError]     = useState("");

  async function handleAdd() {
    if (!locationId) { setError("Selecciona una ubicación."); return; }
    if (!packCount || Number(packCount) <= 0) { setError("Ingresa una cantidad de empaques válida."); return; }
    setError(""); setSaving(true);
    try {
      const loc = locations.find(l => l.id === locationId);
      await addWarehouseMovement(companyId, {
        type: "entrada",
        productId: product.id, productName: product.name, sku: product.sku || "",
        qty: Number(packCount),
        toLocationId: locationId, toLocationName: loc?.name || "",
        reason: reason || "Reposición de stock",
        userName,
        packName: product.packName, packQty: product.packQty,
      });
      onClose();
    } catch (e) { setError(e?.message || "Error al agregar stock."); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 w-full max-w-sm space-y-3 overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-white">Agregar stock — {product.name}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={15}/></button>
        </div>
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">{error}</p>}
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Ubicación *</label>
          <select value={locationId} onChange={e => setLocationId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
            <option value="">Selecciona…</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Cantidad de {product.packName} ({product.packQty} und c/u) *</label>
          <input type="number" min="1" value={packCount} onChange={e => setPackCount(e.target.value)} placeholder="Ej: 5"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
          {Number(packCount) > 0 && <p className="text-[10px] text-amber-400/80 mt-1">= {calcUnitsFromPacks(packCount, product.packQty)} und en total</p>}
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Motivo</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej: Recepción de pedido proveedor"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors"/>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs border border-slate-700 text-slate-400 rounded-lg hover:border-slate-600 transition-colors">Cancelar</button>
          <button onClick={handleAdd} disabled={saving}
            className="flex-1 py-2 text-xs bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-900 disabled:text-slate-500 font-semibold rounded-lg transition-colors flex items-center justify-center gap-1">
            {saving ? <RefreshCw size={12} className="animate-spin"/> : <CheckCircle size={12}/>}
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Pestaña: Registrar Movimiento ─────────────────────────────────────────────
// Solo quedan dos tipos: Traslado (mover entre ubicaciones del almacén) y
// Enviar a Tienda (descontar del almacén y sumar a un producto de tienda).
// El ingreso de stock nuevo al almacén ya NO se hace aquí — se hace desde
// "Mis Productos" (al crear el producto o con el botón "Agregar Stock").
const SELECTABLE_MOVEMENT_TYPES = MOVEMENT_TYPES.filter(t => t.id === "traslado" || t.id === "envio_inventario");

function MovimientoTab({ locations, warehouseProducts, storeProducts, companyId, userName, stockByProduct }) {
  const EMPTY = {
    type: "traslado", productSearch: "", product: null,
    qty: "", reason: "", fromLocationId: "", toLocationId: "",
    // Destino en "Enviar a Tienda" — producto de la TIENDA que recibe el stock
    storeProductSearch: "", storeProduct: null,
  };
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState("");

  const isEnvio = form.type === "envio_inventario";
  const packName = form.product?.packName || "empaque";
  const packQty  = Number(form.product?.packQty) || 1;

  // Buscador de producto — SIEMPRE contra el catálogo propio del almacén,
  // nunca contra el catálogo de la tienda.
  const filtered = form.productSearch && !form.product
    ? warehouseProducts.filter(p => p.name?.toLowerCase().includes(form.productSearch.toLowerCase()) || p.sku?.toLowerCase().includes(form.productSearch.toLowerCase()))
    : [];

  // Buscador del producto de TIENDA destino — solo aplica en "Enviar a Tienda"
  const storeFiltered = isEnvio && form.storeProductSearch && !form.storeProduct
    ? storeProducts.filter(p => p.name?.toLowerCase().includes(form.storeProductSearch.toLowerCase()) || p.sku?.toLowerCase().includes(form.storeProductSearch.toLowerCase()))
    : [];

  // El almacén siempre se mueve en EMPAQUES completos (cajas). "qty" es la
  // cantidad de empaques que se descuentan del origen. En "Enviar a Tienda"
  // eso se convierte a unidades reales para sumarlas al stock de la tienda,
  // ya que la tienda vende por unidad.
  const packCount = Number(form.qty) || 0;
  const unitQty   = calcUnitsFromPacks(packCount, packQty);

  const fromStock = form.product && form.fromLocationId
    ? (stockByProduct[form.product.id] || []).find(s => s.locationId === form.fromLocationId)
    : null;

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit() {
    setError("");
    if (!form.product) return setError("Selecciona un producto de almacén.");
    if (!packCount || packCount <= 0) return setError(`Ingresa la cantidad de ${packName} a mover.`);
    if (!form.fromLocationId) return setError("Selecciona la ubicación de origen.");
    if (form.type === "traslado" && !form.toLocationId) return setError("Selecciona la ubicación de destino.");
    if (form.type === "traslado" && form.fromLocationId === form.toLocationId) return setError("Origen y destino deben ser distintos.");
    if (fromStock && packCount > fromStock.qty) return setError(`Solo hay ${fromStock.qty} ${packName} disponibles en esa ubicación.`);
    if (isEnvio && !form.storeProduct) return setError("Selecciona a qué producto de la tienda se envía.");

    setSaving(true);
    try {
      const fromLoc = locations.find(l => l.id === form.fromLocationId);
      const toLoc   = locations.find(l => l.id === form.toLocationId);

      if (isEnvio) {
        await sendWarehouseToInventory(companyId, {
          warehouseProductId:   form.product.id,
          warehouseProductName: form.product.name,
          sku:                  form.product.sku || "",
          locationId:           form.fromLocationId,
          locationName:         fromLoc?.name || "",
          packCount, packName,
          unitQty,
          storeProductId:       form.storeProduct.id,
          storeProductName:     form.storeProduct.name,
          reason:               form.reason,
          userName,
        });
      } else {
        await addWarehouseMovement(companyId, {
          type:             "traslado",
          productId:        form.product.id,
          productName:      form.product.name,
          sku:              form.product.sku || "",
          qty:              packCount,
          fromLocationId:   form.fromLocationId,
          fromLocationName: fromLoc?.name || null,
          toLocationId:     form.toLocationId,
          toLocationName:   toLoc?.name   || null,
          reason:           form.reason,
          userName,
          packName: form.product.packName, packQty: form.product.packQty,
        });
      }
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setForm(EMPTY); }, 2500);
    } catch (e) {
      setError(e?.message || "Error al registrar el movimiento.");
    }
    setSaving(false);
  }

  const typeInfo = TYPE_CFG[form.type];

  return (
    <div className="max-w-lg">
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Warehouse size={15} className="text-amber-400" /> Registrar Movimiento de Almacén
        </h3>

        {success && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-400">
            <CheckCircle size={16} /> ¡Movimiento registrado!
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{error}
          </div>
        )}

        {!success && (<>
          {/* Tipo */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Tipo de movimiento</label>
            <div className="grid grid-cols-2 gap-2">
              {SELECTABLE_MOVEMENT_TYPES.map(t => (
                <button key={t.id} onClick={() => setF("type", t.id)}
                  className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl border transition-all ${form.type === t.id ? `${t.bg} ${t.color}` : "border-slate-700 text-slate-500 hover:border-slate-600"}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
            {isEnvio && (
              <p className="text-[11px] text-amber-400/80 mt-1.5">Descuenta del almacén y suma stock a un producto que ya existe en la tienda.</p>
            )}
          </div>

          {/* Producto — SIEMPRE del catálogo propio de almacén */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
            <div className="relative">
              <input value={form.productSearch}
                onChange={e => setF("productSearch", e.target.value) || setF("product", null)}
                placeholder="Buscar por nombre o SKU…"
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              {form.product && (
                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Package size={13} className="text-amber-400 flex-shrink-0" />
                    <span className="text-sm text-amber-400 font-medium truncate">{form.product.name}</span>
                    <span className="text-xs font-mono text-slate-500 ml-1">{form.product.sku}</span>
                    <button onClick={() => { setF("product", null); setF("productSearch", ""); }} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                  </div>
                  {form.product.description && <p className="text-[11px] text-slate-500 mt-1 ml-[21px]">{form.product.description}</p>}
                </div>
              )}
              {filtered.length > 0 && !form.product && (
                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                  {filtered.slice(0, 6).map(p => {
                    const totalQty = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                    return (
                      <button key={p.id} onClick={() => {
                        setF("product", p); setF("productSearch", p.name);
                        if (isEnvio) {
                          // Ayuda a que el nombre coincida con el de Inventario:
                          // precargamos la búsqueda de tienda con el mismo
                          // nombre, y si hay una coincidencia exacta la
                          // seleccionamos de una vez.
                          const exact = storeProducts.find(sp => sp.name?.trim().toLowerCase() === p.name?.trim().toLowerCase());
                          setF("storeProductSearch", p.name);
                          setF("storeProduct", exact || null);
                        }
                      }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-700 flex items-center justify-between gap-2 border-b border-slate-700/50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200">{p.name}</p>
                          <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                          {p.description && <p className="text-[11px] text-slate-500 truncate">{p.description}</p>}
                        </div>
                    <span className="text-xs font-mono text-amber-400 flex-shrink-0">Stock: {totalQty} {p.packName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {form.productSearch && !form.product && filtered.length === 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. Crea el producto primero en "Mis Productos".</p>
              )}
            </div>
          </div>

          {/* Ubicación origen — ambos tipos restantes salen de una ubicación */}
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Ubicación origen *</label>
            <select value={form.fromLocationId} onChange={e => setF("fromLocationId", e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
              <option value="">Seleccionar…</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ""}</option>)}
            </select>
            {fromStock && <p className="text-xs text-slate-500 mt-1">Disponible: <span className="font-mono text-amber-400 font-bold">{fromStock.qty} {packName}</span></p>}
          </div>

          {/* Ubicación destino — solo Traslado */}
          {form.type === "traslado" && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Ubicación destino *</label>
              <select value={form.toLocationId} onChange={e => setF("toLocationId", e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                <option value="">Seleccionar…</option>
                {locations.filter(l => l.id !== form.fromLocationId).map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ""}</option>)}
              </select>
            </div>
          )}

          {/* Producto de TIENDA destino — solo en "Enviar a Tienda" */}
          {isEnvio && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1.5">
                <Store size={11} className="text-amber-400" /> ¿A qué producto de la tienda se suma? *
              </label>
              <div className="relative">
                <input value={form.storeProductSearch}
                  onChange={e => setF("storeProductSearch", e.target.value) || setF("storeProduct", null)}
                  placeholder="Buscar producto de tienda por nombre o SKU…"
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                {form.storeProduct && (
                  <div className="mt-2 space-y-1">
                    <div className="p-2 bg-sky-500/10 border border-sky-500/30 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Store size={13} className="text-sky-400 flex-shrink-0" />
                        <span className="text-sm text-sky-300 font-medium truncate">{form.storeProduct.name}</span>
                        <span className="text-xs font-mono text-slate-500 ml-1">{form.storeProduct.sku}</span>
                        <span className="text-xs font-mono text-slate-500 ml-auto">Stock tienda: {form.storeProduct.stock ?? 0}</span>
                        <button onClick={() => { setF("storeProduct", null); setF("storeProductSearch", ""); }}><X size={13} className="text-slate-500" /></button>
                      </div>
                      {form.storeProduct.description && <p className="text-[11px] text-slate-500 mt-1 ml-[21px]">{form.storeProduct.description}</p>}
                    </div>
                    {form.storeProduct.name?.trim().toLowerCase() !== form.product?.name?.trim().toLowerCase() && (
                      <p className="text-[11px] text-amber-400 flex items-center gap-1"><AlertTriangle size={11}/> El nombre no coincide exactamente con "{form.product?.name}". Verifica que sea el producto correcto.</p>
                    )}
                  </div>
                )}
                {storeFiltered.length > 0 && !form.storeProduct && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    {storeFiltered.slice(0, 6).map(p => {
                      const isMatch = p.name?.trim().toLowerCase() === form.product?.name?.trim().toLowerCase();
                      return (
                        <button key={p.id} onClick={() => { setF("storeProduct", p); setF("storeProductSearch", p.name); }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-slate-700 flex items-center justify-between gap-2 border-b border-slate-700/50 last:border-0 ${isMatch ? "bg-emerald-500/10" : ""}`}>
                          <div className="min-w-0">
                            <p className="text-sm text-slate-200">{p.name} {isMatch && <span className="text-emerald-400 text-[10px]">✓ coincide</span>}</p>
                            <p className="text-xs font-mono text-slate-500">{p.sku}</p>
                            {p.description && <p className="text-[11px] text-slate-500 truncate">{p.description}</p>}
                          </div>
                          <span className="text-xs font-mono text-sky-400 flex-shrink-0">Stock: {p.stock ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.storeProductSearch && !form.storeProduct && storeFiltered.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir primero en Inventario.</p>
                )}
              </div>
            </div>
          )}

          {/* Cantidad — siempre en empaques (cajas), tanto para Traslado como
              para Enviar a Tienda (en este último se convierte a unidades
              reales para la tienda, ver preview abajo). */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider mb-1 block">
                Cantidad de {packName} {form.product ? `(${packQty} und c/u)` : ""} *
              </label>
              <input type="number" min="1" value={form.qty} onChange={e => setF("qty", e.target.value)} placeholder="Ej: 3"
                className="w-full px-3 py-2.5 bg-slate-900 border border-amber-500/30 rounded-lg text-sm text-amber-300 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Motivo</label>
              <input value={form.reason} onChange={e => setF("reason", e.target.value)} placeholder={isEnvio ? "Ej: Reposición semanal de tienda" : "Ej: Reordenar almacén"}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
          </div>

          {/* Preview de conversión caja → unidades en "Enviar a Tienda" */}
          {isEnvio && packCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
              <span>📦</span>
              <span><strong>{packCount}</strong> {packName} × <strong>{packQty}</strong> und = se suman <strong className="text-amber-400">{unitQty}</strong> unidades al stock de la tienda</span>
            </div>
          )}

          <button onClick={handleSubmit}
            disabled={saving || !form.product || (isEnvio && !form.storeProduct) || packCount <= 0}
            className={`w-full py-3 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 ${saving ? "bg-slate-700 text-slate-500" : `${typeInfo.bg} ${typeInfo.color} border hover:opacity-90`}`}>
            {saving ? <RefreshCw size={15} className="animate-spin" /> : typeInfo.icon}
            Registrar {typeInfo.label}
          </button>
        </>)}
      </div>
    </div>
  );
}

// ── Pestaña: Historial ────────────────────────────────────────────────────────
function HistorialTab({ movements }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => movements.filter(m => {
    const matchType = filter === "all" || m.type === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || m.productName?.toLowerCase().includes(q) || m.fromLocationName?.toLowerCase().includes(q) || m.toLocationName?.toLowerCase().includes(q) || m.storeProductName?.toLowerCase().includes(q) || m.reason?.toLowerCase().includes(q);
    return matchType && matchSearch;
  }), [movements, filter, search]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-36">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"/>
        </div>
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 overflow-x-auto max-w-full">
          {[{id:"all",label:"Todos"}, ...MOVEMENT_TYPES.map(t => ({id:t.id, label:t.label}))].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${filter === f.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<History size={28}/>} msg="Sin movimientos registrados." />
      ) : (
        <div className="space-y-2">
          {filtered.map((m, i) => {
            const cfg = TYPE_CFG[m.type] || TYPE_CFG.entrada;
            return (
              <div key={m.id || i} className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-200 truncate">{m.productName}</p>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} flex-shrink-0`}>{cfg.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
                      {m.type === "entrada" && m.toLocationName   && <span>→ {m.toLocationName}</span>}
                      {m.type === "salida"  && m.fromLocationName && <span>← {m.fromLocationName}</span>}
                      {m.type === "traslado" && <span>{m.fromLocationName} → {m.toLocationName}</span>}
                      {m.type === "envio_inventario" && <span>{m.fromLocationName} → 🏪 {m.storeProductName || "Tienda"}</span>}
                      <span className="font-mono font-bold text-amber-400">{m.qty} {m.packName || "und"}</span>
                      <span>{m.date}{m.time ? ` · ${m.time}` : ""}</span>
                      {m.reason && <span className="italic">{m.reason}</span>}
                      {m.userName && <span>por {m.userName}</span>}
                    </div>
                    {/* Equivalencia en unidades */}
                    {m.packName && m.packQty > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="text-amber-400/80">
                          = {m.qty * m.packQty} und (×{m.packQty} und/{m.packName})
                        </span>
                      </div>
                    )}
                    {/* En "Enviar a Tienda" las unidades que recibió la tienda pueden diferir si el producto de tienda usa otra unidad de conteo */}
                    {m.type === "envio_inventario" && m.unitQty > 0 && (
                      <div className="mt-1 text-[11px] text-sky-400/80">
                        🏪 Tienda recibió: {m.unitQty} unidades
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Componente vacío reutilizable ────────────────────────────────────────────
function EmptyState({ icon, msg, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-600 gap-2">
      <span className="opacity-30">{icon}</span>
      <p className="text-sm">{msg}</p>
      {sub && <p className="text-xs text-slate-700">{sub}</p>}
    </div>
  );
}
