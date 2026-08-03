// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/MapaTab.jsx
// Pestaña "🗺 Mapa del Almacén": CRUD de ubicaciones físicas + dos vistas
// (por ubicación / por producto) del stock actual. Extraído de
// WarehouseModule.jsx al separar el monolito por componentes.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";
import {
  Plus, X, Edit3, Trash2, Package, Search, RefreshCw, CheckCircle,
  MapPin, Warehouse,
} from "lucide-react";
import { addLocation, updateLocation, deleteLocation } from "../../services/firestoreService";
import { EmptyState } from "../shared/StatusUI";
import { LOCATION_TYPES } from "./constants";

export default function MapaTab({ locations, stockByLocation, stockByProduct, warehouseProducts, canManage, companyId }) {
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
  const totalPacks = Object.values(stockByLocation).flat().reduce((s, i) => s + (i.qty || 0), 0);
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
                                  <span className="text-emerald-400/80">S/ {unitPrice.toFixed(2)} / und</span>
                                  <span className="text-slate-600">Total: S/ {(unitPrice * totalUnits).toFixed(2)}</span>
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
