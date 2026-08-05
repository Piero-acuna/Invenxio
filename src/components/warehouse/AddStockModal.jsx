// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/AddStockModal.jsx
// Modal: Agregar Stock a un producto de almacén existente. Siempre se cuenta
// en empaques (cajas), igual que el resto del almacén. Extraído de
// WarehouseModule.jsx al separar el monolito por componentes.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { X, RefreshCw, CheckCircle } from "lucide-react";
import { addWarehouseMovement } from "../../services/firestoreService";
import { logAndGetErrorMessage } from "../../utils/errors";

export default function AddStockModal({ product, locations, companyId, userName, onClose }) {
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
    } catch (e) { setError(logAndGetErrorMessage(e, "Error al agregar stock:", "Error al agregar stock.")); }
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
          {Number(packCount) > 0 && <p className="text-[10px] text-amber-400/80 mt-1">= {Number(packCount) * Number(product.packQty)} und en total</p>}
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
