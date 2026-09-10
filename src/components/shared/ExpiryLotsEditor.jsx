// ─────────────────────────────────────────────────────────────────────────────
// src/components/shared/ExpiryLotsEditor.jsx
//
// Editor de "lotes de caducidad" — 0, 1 o varias filas por producto,
// ninguna obligatoria (ver 0023_product_expiry_lots.sql). Compartido entre
// Inventario (InventoryModule.jsx) y Almacén (ProductosTab.jsx) para no
// duplicar el mismo formulario repetible en los dos lados.
//
// Cada fila puede tener `id` (si ya existe en la base) o no (si el usuario
// la acaba de agregar en este formulario) — quien llama decide qué hacer
// con eso al guardar (ver syncExpiryLots en services/firestore/expiryLots.js).
// ─────────────────────────────────────────────────────────────────────────────
import { Plus, Trash2 } from "lucide-react";

let _localKeySeq = 0;

/** Fila nueva y vacía, lista para agregar al array de lotes. */
export function newEmptyLot() {
  return { _key: `new-${++_localKeySeq}`, id: null, entryDate: "", expiryDate: "", qty: "" };
}

/**
 * @param {Array} lots        Filas actuales (cada una con `id` o `_key`).
 * @param {(lots: Array) => void} onChange
 * @param {string} [qtyLabel] Etiqueta del campo de cantidad (ej. "Kg", "Unidades").
 */
export default function ExpiryLotsEditor({ lots, onChange, qtyLabel = "Cantidad" }) {
  const keyOf = (l) => l._key || l.id;

  function updateLot(key, field, value) {
    onChange(lots.map(l => (keyOf(l) === key ? { ...l, [field]: value } : l)));
  }
  function removeLot(key) {
    onChange(lots.filter(l => keyOf(l) !== key));
  }
  function addLot() {
    onChange([...lots, newEmptyLot()]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Fechas de caducidad</p>
          <p className="text-[10px] text-slate-600">Opcional — un lote por cada ingreso con su propia caducidad</p>
        </div>
        <button type="button" onClick={addLot}
          className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 whitespace-nowrap">
          <Plus size={12} /> Agregar lote
        </button>
      </div>

      {lots.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic">Sin fechas de caducidad registradas.</p>
      ) : (
        <div className="space-y-2">
          {lots.map((l) => {
            const key = keyOf(l);
            return (
              <div key={key} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-end bg-slate-900/60 border border-slate-700 rounded-lg p-2">
                <div>
                  <label className="text-[9px] text-slate-500 uppercase block mb-0.5">Entrada</label>
                  <input type="date" value={l.entryDate || ""} onChange={e => updateLot(key, "entryDate", e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-amber-500 transition-colors [color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 uppercase block mb-0.5">Caducidad *</label>
                  <input type="date" value={l.expiryDate || ""} onChange={e => updateLot(key, "expiryDate", e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-amber-500 transition-colors [color-scheme:dark]" />
                </div>
                <button type="button" onClick={() => removeLot(key)} title="Quitar este lote"
                  className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                  <Trash2 size={13} />
                </button>
                <div className="col-span-2">
                  <label className="text-[9px] text-slate-500 uppercase block mb-0.5">{qtyLabel} (opcional)</label>
                  <input type="number" min="0" step="0.001" value={l.qty ?? ""} onChange={e => updateLot(key, "qty", e.target.value)} placeholder="Ej: 10"
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
