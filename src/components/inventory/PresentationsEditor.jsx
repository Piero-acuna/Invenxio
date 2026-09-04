// ─────────────────────────────────────────────────────────────────────────────
// src/components/inventory/PresentationsEditor.jsx
// Editor dinámico de presentaciones de venta (Unidad / Pack / Caja...) de un
// producto de Inventario — usado tanto por "Nuevo Producto" como por "Editar
// Producto" en InventoryModule.jsx, para no duplicar esta UI dos veces.
// Cada presentación descuenta `multiplier` unidades del mismo stock base; la
// fila con multiplier=1 ("Unidad") es la base y no se puede borrar ni
// reconfigurar su multiplicador (ver isBase/locked en src/utils/packaging.js).
// ─────────────────────────────────────────────────────────────────────────────
import { Plus, X, ScanBarcode, AlertTriangle } from "lucide-react";
import { buildEmptyPresentation } from "../../utils/packaging";
import { calcProfit, calcMarginPercent } from "../../utils/finance";
import { formatMoney } from "../../utils/currency";

const PresentationsEditor = ({ presentations, onChange, currencySymbol, onScanRequest, cost }) => {
  const updateRow = (i, patch) => onChange(presentations.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
  const removeRow = (i) => onChange(presentations.filter((_, xi) => xi !== i));
  const addRow = () => onChange([...presentations, buildEmptyPresentation()]);

  return (
    <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Presentaciones de venta</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Cada una con su propio precio y código de barras — todas descuentan del mismo stock en unidades.</p>
        </div>
        <button type="button" onClick={addRow}
          className="shrink-0 text-[11px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 whitespace-nowrap">
          <Plus size={12} /> Agregar
        </button>
      </div>

      <div className="space-y-2.5">
        {presentations.map((pres, i) => (
          <div key={pres.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <input type="text" value={pres.name} onChange={e => updateRow(i, { name: e.target.value })}
                placeholder="Ej: Unidad, Pack, Caja"
                className="flex-1 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm font-semibold text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
              {!pres.locked && (
                <button type="button" onClick={() => removeRow(i)} title="Quitar presentación"
                  className="shrink-0 p-1.5 text-slate-500 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">{pres.isBase ? "Multiplicador (fijo)" : "Multiplicador de stock"}</label>
                <input type="number" min="1" step="1" value={pres.multiplier} disabled={pres.isBase}
                  onChange={e => updateRow(i, { multiplier: e.target.value })}
                  placeholder="Ej: 6"
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">Precio ({currencySymbol})</label>
                <input type="number" min="0" step="0.01" value={pres.price} onChange={e => updateRow(i, { price: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-0.5 block">Código de barras</label>
                <div className="flex gap-1">
                  <input value={pres.barcode} onChange={e => updateRow(i, { barcode: e.target.value })}
                    placeholder="Auto"
                    className="w-full min-w-0 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                  <button type="button" onClick={() => onScanRequest(i)} title="Escanear"
                    className="shrink-0 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 rounded-lg transition-colors">
                    <ScanBarcode size={13} />
                  </button>
                </div>
              </div>
            </div>
            {!pres.isBase && Number(pres.multiplier) > 0 && (
              <p className="text-[10px] text-slate-500">📦 Vender 1 "{pres.name || "presentación"}" descuenta {pres.multiplier} unidades del stock.</p>
            )}
            {/* Margen por presentación — un descuento por volumen mal
                calculado (ej. Pack más barato que 6 × costo unitario) es
                el error de precio más fácil de cometer y el más caro:
                pasa desapercibido porque el precio "suena bien" al ojo,
                pero se pierde plata en cada Pack vendido. Solo se muestra
                si el llamador pasó `cost` (ya filtrado por canViewFinance
                en el formulario padre — acá no se decide esa visibilidad). */}
            {!pres.isBase && cost > 0 && Number(pres.price) > 0 && Number(pres.multiplier) > 0 && (() => {
              const impliedCost = cost * Number(pres.multiplier);
              const profit = calcProfit(pres.price, impliedCost);
              const margin = calcMarginPercent(pres.price, impliedCost);
              if (profit < 0) {
                return (
                  <p className="text-[10px] text-red-400 flex items-center gap-1 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                    <AlertTriangle size={11} className="flex-shrink-0" />
                    Vendiendo a pérdida: cuesta {formatMoney(impliedCost, currencySymbol)} y se cobra {formatMoney(Number(pres.price), currencySymbol)} — {formatMoney(Math.abs(profit), currencySymbol)} menos por "{pres.name}" vendido.
                  </p>
                );
              }
              return <p className="text-[10px] text-slate-500">Ganancia: {formatMoney(profit, currencySymbol)} ({margin.toFixed(1)}% margen) por "{pres.name}".</p>;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PresentationsEditor;
