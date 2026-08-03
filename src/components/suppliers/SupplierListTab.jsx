// ─────────────────────────────────────────────────────────────────────────────
// src/components/suppliers/SupplierListTab.jsx
// Pestaña "📋 Proveedores" de SuppliersModule: grilla de tarjetas de
// proveedor. Componente de presentación puro — todo el estado y los
// handlers viven en SuppliersModule, este archivo solo recibe props.
// ─────────────────────────────────────────────────────────────────────────────
import { Truck, Users, Phone, MapPin, History, Edit3, Trash2 } from "lucide-react";
import { Spinner } from "../shared/StatusUI";

export default function SupplierListTab({
  suppliers, loadingSup, supplierSales,
  canManageSuppliers, canDelete,
  onSelectSupplier, onToggleStatus, onEditSupplier, onDeleteSupplier,
}) {
  if (loadingSup) return <Spinner />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {suppliers.map(s => (
        <div key={s.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col gap-4 hover:border-amber-500/30 transition-colors group">
          <div className="flex items-start justify-between">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/20 flex items-center justify-center">
              <Truck size={20} className="text-amber-400" />
            </div>
            {canManageSuppliers ? (
              <button
                onClick={e => onToggleStatus(e, s)}
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
            <button onClick={() => onSelectSupplier(s)}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-600 text-slate-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors flex items-center justify-center gap-1">
              <History size={12} />Ver Historial
            </button>
            {canManageSuppliers && (
              <button onClick={e => { e.stopPropagation(); onEditSupplier(s); }}
                className="py-2 px-3 text-xs font-semibold rounded-lg border border-transparent text-slate-400 hover:border-amber-500/30 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                title="Editar proveedor">
                <Edit3 size={12} />
              </button>
            )}
            {canDelete && (
              <button onClick={e => { e.stopPropagation(); onDeleteSupplier(s); }}
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
  );
}
