// ─────────────────────────────────────────────────────────────────────────────
// src/components/suppliers/SupplierDetailModal.jsx
// Modal de detalle al hacer clic en "Ver Historial" de un proveedor: sus
// ventas de almacén, sus órdenes de compra, e info de contacto. Componente
// de presentación puro — SuppliersModule calcula supplierOrders/
// supplierSalesHistory/totales y se los pasa ya listos.
// ─────────────────────────────────────────────────────────────────────────────
import {
  X, Users, Phone, MapPin, FileText, Send, Truck, Calendar, AlertTriangle,
} from "lucide-react";
import { StatusBadge } from "../shared/StatusUI";
import { useAuth } from "../../contexts/AuthContext";
import { formatMoney } from "../../utils/currency";

export default function SupplierDetailModal({
  supplier, onClose,
  detailTab, setDetailTab,
  supplierOrders, supplierSalesHistory, totalVendido,
  canViewFinance, canManageSuppliers,
  invoiceMsgSupplier, onMarkDelivered, onCancelSale, onGoToPurchaseTab,
}) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
  if (!supplier) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-700 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-white truncate">{supplier.name}</h3>
            {supplier.ruc && <p className="text-xs text-slate-400">RUC/DNI: {supplier.ruc}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 flex-shrink-0 ml-3"><X size={18} /></button>
        </div>

        {/* Stats rápidas */}
        <div className="grid grid-cols-3 gap-2 px-4 sm:px-5 pt-4 flex-shrink-0">
          {[
            { label: "Ventas", value: supplierSalesHistory.length },
            ...(canViewFinance ? [{ label: "Total Vendido", value: `${formatMoney(totalVendido, currencySymbol)}` }] : []),
            { label: "Órdenes", value: supplierOrders.length },
          ].map((s, i) => (
            <div key={i} className="bg-slate-800 rounded-xl p-2.5 text-center border border-slate-700/50">
              <p className="text-[10px] text-slate-400 mb-0.5 uppercase tracking-wider">{s.label}</p>
              <p className="text-sm font-bold font-mono text-amber-400 truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Pestañas internas */}
        <div className="flex border-b border-slate-800 px-4 sm:px-5 mt-4 flex-shrink-0 overflow-x-auto">
          {[
            { id: "ventas",  label: `Ventas (${supplierSalesHistory.length})` },
            { id: "ordenes", label: `Órdenes (${supplierOrders.length})` },
            { id: "info", label: "Info" },
          ].map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              className={`px-3 py-2 text-xs font-semibold transition-colors mr-1 whitespace-nowrap ${detailTab === t.id ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {invoiceMsgSupplier && (
            <div className="mb-4 py-2 px-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{invoiceMsgSupplier}
            </div>
          )}

          {/* ── Historial de ventas (productos de almacén vendidos a este proveedor) ── */}
          {detailTab === "ventas" && (
            <div className="space-y-2">
              {supplierSalesHistory.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <Send size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin ventas registradas a este proveedor.</p>
                </div>
              ) : supplierSalesHistory.map(sale => (
                <div key={sale.id} className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-slate-200 truncate">{sale.product}</p>
                    <StatusBadge status={sale.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Calendar size={10}/>{sale.date}{sale.time ? ` · ${sale.time}` : ""}</span>
                    <span>x{sale.qty} {sale.packName || ""}</span>
                    {canViewFinance && <span className="font-bold font-mono text-emerald-400">+ {formatMoney(sale.total, currencySymbol)}</span>}
                  </div>
                  {sale.description && <p className="text-xs text-slate-500 mt-1">{sale.description}</p>}
                  {sale.note && <p className="text-xs text-slate-500 mt-1 italic">{sale.note}</p>}
                  {canManageSuppliers && sale.status !== "Cancelado" && (
                    <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-700/50">
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
              ))}
            </div>
          )}

          {/* ── Órdenes de Compra ── */}
          {detailTab === "ordenes" && (
            <div className="space-y-2">
              {supplierOrders.length === 0 ? (
                <div className="text-center py-10 text-slate-500">
                  <Truck size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin órdenes de compra registradas.</p>
                  {canManageSuppliers && (
                    <button onClick={onGoToPurchaseTab}
                      className="mt-3 text-xs text-amber-400 hover:text-amber-300">
                      + Registrar primera compra
                    </button>
                  )}
                </div>
              ) : (
                supplierOrders.map((order, i) => (
                  <div key={order.id || i} className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{order.product}</p>
                        <p className="text-xs text-slate-500 font-mono">{order.sku}</p>
                      </div>
                      <p className="text-xs text-slate-500 whitespace-nowrap flex-shrink-0">{order.date}</p>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-slate-400">
                        {order.qty} und
                        {canViewFinance && ` × ${formatMoney(order.unitCost, currencySymbol)}`}
                      </span>
                      {canViewFinance && (
                        <span className="font-bold font-mono text-amber-400">{formatMoney(order.total, currencySymbol)}</span>
                      )}
                    </div>
                    {order.description && <p className="text-xs text-slate-500 mt-1">{order.description}</p>}
                    {order.note && <p className="text-xs text-slate-600 mt-1 italic">{order.note}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Info del proveedor ── */}
          {detailTab === "info" && (
            <div className="space-y-3">
              <div className="space-y-2">
                {[
                  { icon: <Users size={13} />,   value: supplier.contact },
                  { icon: <Phone size={13} />,   value: supplier.phone },
                  { icon: <MapPin size={13} />,  value: supplier.address },
                  ...(supplier.ruc ? [{ icon: <FileText size={13} />, value: `RUC/DNI: ${supplier.ruc}` }] : []),
                ].filter(r => r.value).map((row, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-300 p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/40">
                    <span className="text-amber-400 mt-0.5 flex-shrink-0">{row.icon}</span>
                    <span className="break-all">{row.value}</span>
                  </div>
                ))}
              </div>
              <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/50 space-y-2">
                <span className="text-xs text-slate-400">Productos que vende</span>
                {supplier.products?.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {supplier.products.map(p => (
                      <span key={p.id} className="text-xs px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400">{p.name}</span>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-600 italic">Sin productos asignados</p>}
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-800/60 rounded-xl border border-slate-700/50">
                <span className="text-xs text-slate-400">Estado</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${supplier.status === "Activo" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-slate-400 border-slate-600 bg-slate-700/40"}`}>
                  {supplier.status || "Activo"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
