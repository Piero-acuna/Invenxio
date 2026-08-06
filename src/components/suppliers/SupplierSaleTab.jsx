// ─────────────────────────────────────────────────────────────────────────────
// src/components/suppliers/SupplierSaleTab.jsx
// Pestaña "📤 Venta a Proveedor": formulario de venta de almacén a un
// proveedor + estadísticas + historial de ventas. Componente de
// presentación puro — el estado del formulario y los handlers viven en
// SuppliersModule.
// ─────────────────────────────────────────────────────────────────────────────
import {
  X, Package, AlertTriangle, CheckCircle, Send, Calendar, Tag,
  Loader2, Receipt, TrendingUp, Clock, FileSpreadsheet,
} from "lucide-react";
import { StatusBadge, Spinner } from "../shared/StatusUI";
import { useAuth } from "../../contexts/AuthContext";
import { formatMoney } from "../../utils/currency";

export default function SupplierSaleTab({
  suppliers, warehouseLocations, stockByProduct,
  ssForm, setSsForm, ssSaving, ssSuccess, ssError, ssFiltered, ssFromStock,
  onSubmit, canManageSuppliers, canViewFinance,
  supplierSales, loadingSS, totalSales, pendingCnt, deliveredCnt, cancelledCnt,
  invoiceMsgSupplier, onMarkDelivered, onCancelSale, onExport,
}) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Ventas", value: supplierSales.length,          color: "text-blue-400",  icon: <Receipt size={16} /> },
          ...(canViewFinance ? [{ label: "Monto Total", value: `${formatMoney(totalSales, currencySymbol)}`, color: "text-amber-400", icon: <TrendingUp size={16} /> }] : []),
          { label: "Pendientes",   value: pendingCnt,                    color: "text-amber-400", icon: <Clock size={16} /> },
        ].map((s, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-3">
            <span className={`${s.color} bg-slate-700/50 p-2 rounded-lg`}>{s.icon}</span>
            <div>
              <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
        {canManageSuppliers && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Send size={16} className="text-amber-400" />Registrar Venta a Proveedor</h3>
          <div className="space-y-4">
            {ssError && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{ssError}
              </div>
            )}
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Proveedor *</label>
              <select value={ssForm.supplier} onChange={e => setSsForm(p => ({ ...p, supplier: e.target.value }))}
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                <option value="">Seleccionar…</option>
                {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Producto de almacén *</label>
              <div className="relative">
                <input value={ssForm.productSearch} onChange={e => setSsForm(p => ({ ...p, productSearch: e.target.value, product: null }))} placeholder="Buscar…"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
                {ssForm.product && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                    <Package size={13} className="text-amber-400" /><span className="text-sm text-amber-400 font-medium">{ssForm.product.name}</span>
                    <span className="text-xs text-slate-500 ml-1">({ssForm.product.packName} × {ssForm.product.packQty} und)</span>
                    <button onClick={() => setSsForm(p => ({ ...p, product: null, productSearch: "" }))} className="ml-auto"><X size={13} className="text-slate-500" /></button>
                  </div>
                )}
                {ssForm.product?.description && (
                  <p className="text-[11px] text-slate-500 mt-1">{ssForm.product.description}</p>
                )}
                {ssFiltered.length > 0 && !ssForm.product && (
                  <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    {ssFiltered.slice(0, 5).map(p => {
                      const totalStock = (stockByProduct[p.id] || []).reduce((s, i) => s + (i.qty || 0), 0);
                      return (
                        <button key={p.id} onClick={() => setSsForm(prev => ({ ...prev, product: p, productSearch: p.name, locationId: "" }))}
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
                {ssForm.productSearch && !ssForm.product && ssFiltered.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-1.5">Sin resultados. El producto debe existir en el catálogo de Almacén.</p>
                )}
              </div>
            </div>
            {ssForm.product && (
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Ubicación de origen *</label>
                <select value={ssForm.locationId} onChange={e => setSsForm(p => ({ ...p, locationId: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                  <option value="">Seleccionar…</option>
                  {warehouseLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {ssFromStock && <p className="text-xs text-slate-500 mt-1">Disponible: <span className="font-mono text-amber-400 font-bold">{ssFromStock.qty} {ssForm.product.packName}</span></p>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Cantidad de {ssForm.product?.packName || "empaques"} *</label>
                <input type="number" value={ssForm.qty} onChange={e => setSsForm(p => ({ ...p, qty: e.target.value }))} min="1" placeholder="0"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Precio por {ssForm.product?.packName || "empaque"} ({currencySymbol}) *</label>
                <input type="number" value={ssForm.unitPrice} onChange={e => setSsForm(p => ({ ...p, unitPrice: e.target.value }))} min="0" placeholder="0.00"
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Estado</label>
                <select value={ssForm.status} onChange={e => setSsForm(p => ({ ...p, status: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500 transition-colors">
                  {["Entregado", "Pendiente", "Cancelado"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Total</label>
                <div className="px-3 py-2.5 bg-slate-700/50 border border-amber-500/30 rounded-lg text-sm font-mono font-bold text-amber-400">
                  {formatMoney(Number(ssForm.qty || 0) * Number(ssForm.unitPrice || 0), currencySymbol)}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Nota</label>
              <input value={ssForm.note} onChange={e => setSsForm(p => ({ ...p, note: e.target.value }))} placeholder="Observaciones…"
                className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors" />
            </div>
            {ssSuccess ? (
              <div className="py-3 px-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center text-emerald-400 font-semibold flex items-center justify-center gap-2"><CheckCircle size={16} />¡Guardado!</div>
            ) : (
              <button onClick={onSubmit} disabled={!ssForm.supplier || !ssForm.product || !ssForm.locationId || !ssForm.qty || !ssForm.unitPrice || ssSaving}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                {ssSaving && <Loader2 size={16} className="animate-spin" />}<Send size={16} />Registrar Venta
              </button>
            )}
          </div>
        </div>
        )}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 flex flex-col">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <Receipt size={16} className="text-amber-400" />Ventas Registradas
            <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full font-mono">{supplierSales.length}</span>
          </h3>
          <button
            onClick={onExport}
            disabled={supplierSales.length === 0}
            title="Descargar como archivo Excel"
            className="flex items-center justify-center gap-1.5 mb-4 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition-colors"
          >
            <FileSpreadsheet size={13} /> Descargar Excel
          </button>
          {invoiceMsgSupplier && (
            <div className="mb-4 py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsgSupplier}
            </div>
          )}
          <div className="flex gap-2 mb-4">
            <div className="flex-1 bg-slate-700/40 border border-emerald-500/20 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500 mb-0.5">Entregados</p>
              <p className="text-base font-bold font-mono text-emerald-400">{deliveredCnt}</p>
            </div>
            <div className="flex-1 bg-slate-700/40 border border-amber-500/20 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500 mb-0.5">Pendientes</p>
              <p className="text-base font-bold font-mono text-amber-400">{pendingCnt}</p>
            </div>
            <div className="flex-1 bg-slate-700/40 border border-red-500/20 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500 mb-0.5">Cancelados</p>
              <p className="text-base font-bold font-mono text-red-400">{cancelledCnt}</p>
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto max-h-80">
            {loadingSS ? <Spinner /> : supplierSales.length === 0 ? (
              <div className="text-center py-10 text-slate-600 text-sm">Sin ventas registradas</div>
            ) : supplierSales.map(sale => (
              <div key={sale.id} className="p-3 bg-slate-700/40 border border-slate-700/50 rounded-xl hover:border-amber-500/20 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{sale.product}</p>
                    <p className="text-xs text-slate-400">{sale.supplier}</p>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    <StatusBadge status={sale.status} />
                    {canManageSuppliers && sale.status !== "Cancelado" && (
                      <div className="flex items-center gap-2">
                        {sale.status === "Pendiente" && (
                          <>
                            <button onClick={() => onMarkDelivered(sale)}
                              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Marcar entregado</button>
                            <span className="text-slate-600">·</span>
                          </>
                        )}
                        <button onClick={() => onCancelSale(sale)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors">Cancelar</button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 text-slate-500">
                    <span className="flex items-center gap-1"><Calendar size={10} />{sale.date}</span>
                    <span className="flex items-center gap-1"><Tag size={10} />x{sale.qty} {sale.packName || ""}{canViewFinance ? ` · ${formatMoney(sale.unitPrice, currencySymbol)}` : ""}</span>
                  </div>
                  {canViewFinance && <span className="font-bold font-mono text-emerald-400">+ {formatMoney(sale.total, currencySymbol)}</span>}
                </div>
                {sale.description && <p className="text-xs text-slate-500 mt-1">{sale.description}</p>}
                {sale.note && <p className="text-xs text-slate-500 mt-1 italic">{sale.note}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
