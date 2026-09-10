// ─────────────────────────────────────────────────────────────────────────────
// src/utils/expiry.js
//
// Lógica compartida para LOTES de caducidad — un producto (de Inventario o
// de Almacén) puede tener 0, 1 o varios lotes con su propia fecha de
// caducidad (ver 0023_product_expiry_lots.sql / ExpiryLotsEditor.jsx).
// Usada por InventoryModule.jsx, ProductosTab.jsx e InventorySystem.jsx
// (para la campanita de alertas) — así el cálculo de "vencido/vence
// pronto" vive en un solo lugar.
// ─────────────────────────────────────────────────────────────────────────────

// A partir de cuántos días restantes se considera "vence pronto" (amber).
// Por debajo de 0 es "vencido" (rojo). Por encima de este umbral no se
// muestra badge — no hace falta alarmar por algo que vence en 4 meses.
export const EXPIRY_SOON_DAYS = 30;

/**
 * @param {string|null|undefined} expiryDate  "YYYY-MM-DD"
 * @returns {{ status: "none"|"expired"|"soon"|"ok", days: number|null }}
 */
export function getExpiryStatus(expiryDate) {
  if (!expiryDate) return { status: "none", days: null };
  // Mediodía: evita que un huso horario negativo corra la fecha un día
  // atrás y la haga aparecer vencida de más (mismo criterio que se usa en
  // generateInvoicePDF.js / printThermalReceipt.js para fechas de operación).
  const target = new Date(`${expiryDate}T12:00:00`);
  if (Number.isNaN(target.getTime())) return { status: "none", days: null };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (days < 0) return { status: "expired", days };
  if (days <= EXPIRY_SOON_DAYS) return { status: "soon", days };
  return { status: "ok", days };
}

/**
 * Reduce una lista de lotes (de UN producto) al lote más urgente — el que
 * vence primero, incluso si ya venció — para poder mostrar un solo badge
 * en la lista/tarjeta sin tener que abrir el detalle del producto.
 *
 * @param {Array<{expiryDate: string}>} lots
 * @returns {{ count: number, nearest: Object|null, status: "none"|"expired"|"soon"|"ok" }}
 */
export function getExpirySummary(lots) {
  const valid = (lots || []).filter(l => l?.expiryDate);
  if (valid.length === 0) return { count: 0, nearest: null, status: "none" };
  const sorted = [...valid].sort(
    (a, b) => new Date(`${a.expiryDate}T12:00:00`) - new Date(`${b.expiryDate}T12:00:00`)
  );
  const nearest = sorted[0];
  return { count: valid.length, nearest, status: getExpiryStatus(nearest.expiryDate).status };
}

/** Texto corto para un badge, a partir de un resumen de getExpirySummary(). */
export function getExpiryLabel(summary) {
  if (!summary || summary.status === "none") return null;
  const { days } = getExpiryStatus(summary.nearest.expiryDate);
  let base;
  if (summary.status === "expired") base = days === 0 ? "Vence hoy" : `Vencido hace ${Math.abs(days)}d`;
  else if (days === 0) base = "Vence hoy";
  else if (days === 1) base = "Vence mañana";
  else base = `Vence en ${days}d`;
  return summary.count > 1 ? `${base} (+${summary.count - 1} lote${summary.count - 1 === 1 ? "" : "s"})` : base;
}

/** Clases Tailwind para el badge, según status. */
export function getExpiryBadgeClass(status) {
  if (status === "expired") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (status === "soon")    return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-slate-700/40 text-slate-400 border-slate-600/40";
}

/** Agrupa una lista plana de lotes (de TODOS los productos) por producto,
 *  filtrando por catálogo — para armar mapas productId → lotes[] una sola
 *  vez por render en vez de filtrar adentro de cada fila de la tabla. */
export function groupLotsByProduct(expiryLots, catalog) {
  const map = {};
  (expiryLots || []).forEach(l => {
    if (l.catalog !== catalog) return;
    (map[l.productId] ||= []).push(l);
  });
  return map;
}
