// ─────────────────────────────────────────────────────────────────────────────
// src/components/shared/StatusUI.jsx
// Piezas de UI reutilizadas por varios módulos: badge de estado, calificación
// por estrellas, spinner de carga, y la lista de estados de stock posibles.
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { CheckCircle, AlertTriangle, X, Clock, Star, Loader2 } from "lucide-react";

export const STOCK_STATUS = ["En Stock", "Stock Bajo", "Agotado"];

const StatusBadge = ({ status }) => {
  const cfg = {
    "En Stock":   { bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle size={11} /> },
    "Stock Bajo": { bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <AlertTriangle size={11} /> },
    "Agotado":    { bg: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <X size={11} /> },
    "Entregado":  { bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle size={11} /> },
    "Pendiente":  { bg: "bg-amber-500/15 text-amber-400 border-amber-500/30",       icon: <Clock size={11} /> },
    "Cancelado":  { bg: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <X size={11} /> },
  }[status] || { bg: "bg-slate-500/15 text-slate-400 border-slate-500/30", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border font-medium ${cfg.bg}`}>
      {cfg.icon}{status}
    </span>
  );
};

const Stars = ({ rating, max = 5 }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: max }).map((_, i) => (
      <Star key={i} size={13} className={i < rating ? "text-amber-400 fill-amber-400" : "text-slate-600"} />
    ))}
  </div>
);

const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 size={28} className="animate-spin text-amber-400" />
  </div>
);

// Estado vacío genérico (ícono + mensaje + sub-mensaje opcional). Antes vivía
// solo dentro de WarehouseModule.jsx; se movió acá porque es igual de útil
// para cualquier otro módulo con listas que pueden estar vacías.
const EmptyState = ({ icon, msg, sub }) => (
  <div className="flex flex-col items-center justify-center py-16 text-slate-600 gap-2">
    <span className="opacity-30">{icon}</span>
    <p className="text-sm">{msg}</p>
    {sub && <p className="text-xs text-slate-700">{sub}</p>}
  </div>
);

export { StatusBadge, Stars, Spinner, EmptyState };
