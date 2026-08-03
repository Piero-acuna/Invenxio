// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/HistorialTab.jsx
// Pestaña "📋 Historial": lista filtrable de todos los movimientos de
// almacén. Extraído de WarehouseModule.jsx al separar el monolito.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";
import { Search, History } from "lucide-react";
import { EmptyState } from "../shared/StatusUI";
import { MOVEMENT_TYPES, TYPE_CFG } from "./constants";

export default function HistorialTab({ movements }) {
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
