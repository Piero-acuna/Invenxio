// ─────────────────────────────────────────────────────────────────────────────
// src/components/suppliers/SupplierPurchaseTab.jsx
// Pestaña "📥 Registrar Compra de Proveedor": formulario de compra con
// destino a almacén + historial de compras registradas. Componente de
// presentación puro — el estado del formulario y los handlers viven en
// SuppliersModule.
// ─────────────────────────────────────────────────────────────────────────────
import {
  X, Package, AlertTriangle, CheckCircle, ArrowUpCircle, Calendar,
  Loader2, Truck, History,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { formatMoney } from "../../utils/currency";

export default function SupplierPurchaseTab({
  suppliers, warehouseLocations, stockByProduct,
  pForm, setPForm, pSaving, pSuccess, pError, pMsg, pFiltered,
  onSubmit, canManageSuppliers, canViewFinance, warehousePurchases,
}) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
        {canManageSuppliers && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Truck size={16} className="text-amber-400" />Registrar Compra de Proveedor</h3>
          <div className="space-y-4">
            {pError && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{pError}
              </div>
            )}
            {pMsg && (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${pMsg.startsWith("⚠️") ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"}`}>
                {pMsg.startsWith("⚠️") ? <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> : <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />}
                {pMsg}
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
              <select value={pForm.supplier} onChange={e => setPForm(p => ({ ...p, supplier: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                <option value="">Seleccionar…</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
              <div className="relative">
                <input value={pForm.productSearch} onChange={e => setPForm(p => ({ ...p, productSearch: e.target.value, product: null }))} placeholder="Buscar…"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                {pForm.product && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                    <Package size={13} className="text-amber-400" /><span className="text-sm text-amber-400 font-medium">{pForm.product.name}</span>
                    <span className="text-xs text-slate-500 ml-1">({pForm.product.packName} × {pForm.product.packQty} und)</span>
                    <button onClick={() => setPForm(p => ({ ...p, product: null, productSearch: "" }))} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                  </div>
                )}
                {pForm.product?.description && (
                  <p className="text-[11px] text-slate-500 mt-1">{pForm.product.description}</p>
                )}
                {pForm.product && (
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {pForm.product.cost != null
                      ? <>Costo registrado: <span className="text-amber-400 font-mono">{formatMoney(pForm.product.cost, currencySymbol)}</span> por {pForm.product.packName}. Si ingresas un costo distinto, se creará un producto nuevo.</>
                      : "Sin costo registrado todavía — el que ingreses ahora quedará como referencia."}
                  </p>
                )}
                {pFiltered.length > 0 && !pForm.product && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    {pFiltered.slice(0, 5).map(p => {
                      const totalStock = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                      return (
                        <button key={p.id} onClick={() => setPForm(prev => ({ ...prev, product: p, productSearch: p.name, locationId: "" }))}
                          className="w-full text-left px-3 py-2 hover:bg-slate-700 flex flex-col gap-0.5">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-200">{p.name}</span>
                            <span className="text-xs font-mono text-amber-400">Stock: {totalStock} {p.packName}</span>
                          </div>
                          {p.description && <span className="text-[11px] text-slate-500 truncate">{p.description}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {pForm.productSearch && !pForm.product && pFiltered.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir en el catálogo de Almacén.</p>
                )}
              </div>
            </div>
            {pForm.product && (
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Ubicación destino *</label>
                <select value={pForm.locationId} onChange={e => setPForm(p => ({ ...p, locationId: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                  <option value="">Seleccionar…</option>
                  {warehouseLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad de {pForm.product?.packName || "empaques"} *</label>
                <input type="number" value={pForm.packCount} onChange={e => setPForm(p => ({ ...p, packCount: e.target.value }))} min="1" placeholder="0"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Costo por {pForm.product?.packName || "empaque"} ({currencySymbol}) *</label>
                <input type="number" value={pForm.unitCost} onChange={e => setPForm(p => ({ ...p, unitCost: e.target.value }))} min="0" placeholder="0.00"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
              <input value={pForm.note} onChange={e => setPForm(p => ({ ...p, note: e.target.value }))} placeholder="Observaciones…"
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            {pForm.packCount && pForm.unitCost && (
              <div className="flex justify-between items-center p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <span className="text-sm text-amber-400 font-semibold">Total (costo registrado)</span>
                <span className="text-lg font-bold font-mono text-amber-400">{formatMoney(Number(pForm.packCount || 0) * Number(pForm.unitCost || 0), currencySymbol)}</span>
              </div>
            )}
            {pSuccess ? (
              <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado!</div>
            ) : (
              <button onClick={onSubmit} disabled={!pForm.supplier || !pForm.product || !pForm.locationId || !pForm.packCount || !pForm.unitCost || pSaving}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                {pSaving && <Loader2 size={16} className="animate-spin" />}<ArrowUpCircle size={16} />Registrar Compra (emite comprobante)
              </button>
            )}
          </div>
        </div>
        )}

        {/* Compras registradas al almacén */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><History size={16} className="text-amber-400" />Compras Registradas</h3>
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[480px]">
            {warehousePurchases.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <Truck size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin compras registradas todavía.</p>
              </div>
            ) : warehousePurchases.map(t => (
              <div key={t.id} className="p-3 bg-slate-900/40 border border-slate-700/40 rounded-xl">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-slate-200 truncate">{t.product}</p>
                  {canViewFinance && <span className="font-bold font-mono text-red-400 flex-shrink-0">- {formatMoney(t.total, currencySymbol)}</span>}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Calendar size={10} />{t.date}{t.time ? ` · ${t.time}` : ""}</span>
                  <span>x{t.qty} {t.packName || ""} · {t.supplier}</span>
                </div>
                {t.description && <p className="text-xs text-slate-500 mt-1">{t.description}</p>}
                {t.note && <p className="text-xs text-slate-500 mt-1 italic">{t.note}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
