// ─────────────────────────────────────────────────────────────────────────────
// src/components/warehouse/constants.js
// Constantes compartidas entre las pestañas del módulo de Almacén.
// ─────────────────────────────────────────────────────────────────────────────
import { ArrowUpCircle, ArrowDownCircle, MoveRight, Send } from "lucide-react";

export const LOCATION_TYPES = ["Zona", "Estante", "Pasillo", "Refrigerador", "Bodega", "Otro"];

export const MOVEMENT_TYPES = [
  { id: "entrada",  label: "Entrada",  icon: <ArrowUpCircle size={14} />,   color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  { id: "salida",   label: "Salida",   icon: <ArrowDownCircle size={14} />, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30"       },
  { id: "traslado", label: "Traslado", icon: <MoveRight size={14} />,       color: "text-sky-400",     bg: "bg-sky-500/10 border-sky-500/30"       },
  { id: "envio_inventario", label: "Enviar a Tienda", icon: <Send size={14} />, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
];

export const TYPE_CFG = Object.fromEntries(MOVEMENT_TYPES.map(t => [t.id, t]));

// En "Registrar Movimiento" ya no se ingresa stock nuevo (eso vive en "Mis
// Productos"), así que solo Traslado y Enviar a Tienda son seleccionables ahí.
export const SELECTABLE_MOVEMENT_TYPES = MOVEMENT_TYPES.filter(t => t.id === "traslado" || t.id === "envio_inventario");
