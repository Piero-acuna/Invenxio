// ─────────────────────────────────────────────────────────────────────────────
// src/components/pos/PresentationPicker.jsx
//
// Se abre desde MovementsModule.jsx cuando el producto tocado/escaneado en el
// POS tiene más de una presentación de venta, o es un producto a granel
// (unit_type='peso' — SIEMPRE se pide cantidad/monto a mano, nunca se asume
// "1"). Devuelve { presentation, mode, value } vía onConfirm — el resto
// (cálculo real, descuento de stock, precio congelado) lo hace
// record_sale_v2 en el servidor; esto solo arma lo que va en el carrito.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { X, ShoppingCart } from "lucide-react";
import { formatMoney } from "../../utils/currency";

function PresentationPicker({ product, presentations, currencySymbol, onConfirm, onClose }) {
  const isPeso = product.unitType === "peso";
  const defaultPres = presentations.find((p) => p.isDefaultSale) || presentations[0];
  const [selectedId, setSelectedId] = useState(defaultPres?.id);
  const [mode, setMode] = useState("qty");
  const [value, setValue] = useState("1");

  const selected = presentations.find((p) => p.id === selectedId) || defaultPres;
  if (!selected) return null;

  const numValue = Number(value) || 0;
  const estimatedQty = mode === "amount" && selected.price > 0 ? numValue / selected.price : numValue;
  const estimatedTotal = mode === "amount" ? numValue : numValue * selected.price;

  function handleSelectPresentation(p) {
    setSelectedId(p.id);
    setMode("qty");
  }

  function handleConfirm() {
    if (numValue <= 0) return;
    onConfirm(selected, mode, numValue);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-slate-800 border border-slate-700 rounded-xl p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white truncate pr-2">{product.name}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white flex-shrink-0"><X size={16} /></button>
        </div>

        {presentations.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-400 uppercase tracking-wider">Presentación</label>
            <div className="grid grid-cols-2 gap-1.5">
              {presentations.map((p) => (
                <button key={p.id} onClick={() => handleSelectPresentation(p)}
                  className={`px-2 py-2 rounded-lg text-xs border transition-colors text-left ${selectedId === p.id ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-slate-600 text-slate-300 hover:border-slate-500"}`}>
                  <p className="font-semibold truncate">{p.name}</p>
                  <p className="font-mono text-[10px] opacity-80">{formatMoney(p.price, currencySymbol)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {isPeso && (
          <div className="flex gap-1.5">
            {[{ v: "qty", l: "Por kilo" }, { v: "amount", l: `Por monto (${currencySymbol})` }].map((o) => (
              <button key={o.v} onClick={() => setMode(o.v)}
                className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${mode === o.v ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-slate-600 text-slate-400 hover:border-slate-500"}`}>
                {o.l}
              </button>
            ))}
          </div>
        )}

        <div>
          <label className="text-[11px] text-slate-400 uppercase tracking-wider mb-1 block">
            {mode === "amount" ? `Monto a cobrar (${currencySymbol})` : isPeso ? "Cantidad (kg)" : "Cantidad"}
          </label>
          <input type="number" min="0" step={isPeso || mode === "amount" ? "0.01" : "1"} autoFocus
            value={value} onChange={(e) => setValue(e.target.value)}
            className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-lg font-mono text-white text-center focus:outline-none focus:border-amber-500" />
          {mode === "amount" && selected.price > 0 && (
            <p className="text-[11px] text-slate-500 mt-1 text-center">≈ {estimatedQty.toFixed(3)} kg (se recalcula exacto al confirmar la venta)</p>
          )}
        </div>

        <div className="flex justify-between items-center py-2 border-t border-slate-700">
          <span className="text-xs text-slate-400">Subtotal estimado</span>
          <span className="text-lg font-bold font-mono text-amber-400">{formatMoney(estimatedTotal, currencySymbol)}</span>
        </div>

        <button onClick={handleConfirm} disabled={numValue <= 0}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
          <ShoppingCart size={15} />Agregar al carrito
        </button>
      </div>
    </div>
  );
}

export default PresentationPicker;
