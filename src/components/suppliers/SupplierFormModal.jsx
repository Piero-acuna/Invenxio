// ─────────────────────────────────────────────────────────────────────────────
// src/components/suppliers/SupplierFormModal.jsx
// Modal de "Nuevo Proveedor" / "Editar Proveedor". Componente de
// presentación puro — el estado del formulario vive en SuppliersModule.
// ─────────────────────────────────────────────────────────────────────────────
import { X, Plus, Edit3, AlertTriangle, Loader2 } from "lucide-react";

const FIELDS = [
  { label: "Nombre empresa *", key: "name",    placeholder: "TechPro SA",         full: true },
  { label: "RUC / DNI",        key: "ruc",     placeholder: "20123456789"                     },
  { label: "Contacto *",        key: "contact", placeholder: "Juan García"                    },
  { label: "Teléfono",          key: "phone",   placeholder: "+51 999 000 111"                },
  { label: "Dirección",         key: "address", placeholder: "Av. Lima 123",       full: true },
];

export default function SupplierFormModal({
  show, onClose, editSupplier,
  form, setForm, saveError,
  warehouseProducts, saving, onSave,
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h3 className="font-bold text-white flex items-center gap-2">
            {editSupplier ? <Edit3 size={16} className="text-amber-400" /> : <Plus size={16} className="text-amber-400" />}
            {editSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><X size={18} /></button>
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
            {FIELDS.map(f => (
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
            <button onClick={onClose} className="flex-1 py-2.5 border border-slate-600 text-slate-400 rounded-xl text-sm hover:border-slate-500 transition-colors">Cancelar</button>
            <button onClick={onSave} disabled={!form.name || !form.contact || saving}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}{editSupplier ? "Guardar cambios" : "Registrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
