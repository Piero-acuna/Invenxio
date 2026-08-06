// ─────────────────────────────────────────────────────────────────────────────
// src/utils/currency.js
// Helper único para mostrar montos de dinero. Reemplaza los antiguos
// `S/ ${n.toFixed(2)}` repetidos por toda la app — ahora el símbolo viene de
// la moneda configurada para el país de la empresa (ver countryConfig.js).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Da formato a un monto con el símbolo de moneda de la empresa.
 * @param {number} amount
 * @param {string} symbol - "S/" (soles) o "$" (dólares), según el país.
 */
export function formatMoney(amount, symbol = "S/") {
  const n = Number(amount) || 0;
  return `${symbol} ${n.toFixed(2)}`;
}
