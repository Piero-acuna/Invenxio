// ─────────────────────────────────────────────────────────────────────────────
// src/utils/finance.js
//
// Único lugar del proyecto donde viven las fórmulas de GANANCIA, MARGEN y
// TOTALES. Antes cada pantalla (Inventario, Historial, Dashboard) tenía su
// propia copia de la misma cuenta, escrita un poco distinto cada vez — eso
// es peligroso porque si un día cambia la fórmula en un lugar y no en otro,
// dos pantallas del sistema muestran números distintos para lo mismo.
// Ahora todas importan de acá.
//
// ── GLOSARIO (para que no haya ambigüedad sobre qué significa cada palabra) ──
//
//   Ganancia (o "utilidad")
//     = Precio de venta − Costo
//     Es un MONTO en la moneda de la empresa (S/, $), no un porcentaje.
//
//   Margen
//     = (Ganancia ÷ Precio de venta) × 100
//     Es un PORCENTAJE. Ojo: se calcula sobre el PRECIO DE VENTA, no sobre
//     el costo — dividir sobre el costo da otra métrica distinta llamada
//     "markup", que este sistema no usa.
//
//   Ganancia bruta (de un periodo: hoy, la semana, el mes, todo)
//     = Total vendido en el periodo − Total comprado en el periodo
//
//   Margen global (de un periodo)
//     = (Ganancia bruta ÷ Total vendido) × 100
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ganancia de UN producto: precio de venta − costo.
 * Devuelve un MONTO (ej. 4.50), no un porcentaje.
 */
export function calcProfit(price, cost) {
  return (Number(price) || 0) - (Number(cost) || 0);
}

/**
 * Margen de UN producto, en %, calculado sobre el precio de venta.
 * Si el precio es 0 (no se puede dividir entre cero), devuelve 0 en vez de
 * NaN o Infinity — así la interfaz nunca muestra algo roto.
 */
export function calcMarginPercent(price, cost) {
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  return (calcProfit(p, cost) / p) * 100;
}

/** Suma el campo `total` de una lista de transacciones/movimientos. */
export function sumTotals(list) {
  return (list || []).reduce((sum, item) => sum + (Number(item.total) || 0), 0);
}

/**
 * Suma el campo `total` de una lista de transacciones, filtrando primero
 * por tipo ("venta" o "compra"). Es la operación que se repite en Historial,
 * Dashboard y Movimientos para sacar "total vendido" / "total comprado".
 */
export function sumTransactionsByType(transactions, type) {
  return sumTotals((transactions || []).filter(t => t.type === type));
}

/**
 * Ganancia bruta de un periodo (hoy, la semana, el mes, todo el histórico):
 * total vendido − total comprado en ese periodo. Es un MONTO.
 */
export function calcGrossProfit(totalSales, totalPurchases) {
  return (Number(totalSales) || 0) - (Number(totalPurchases) || 0);
}

/**
 * Margen global de un periodo, en %, sobre el total vendido en ese periodo.
 * Si no hubo ventas (totalSales = 0), devuelve 0 en vez de dividir entre cero.
 */
export function calcGlobalMarginPercent(totalSales, grossProfit) {
  const sales = Number(totalSales) || 0;
  if (sales <= 0) return 0;
  return (grossProfit / sales) * 100;
}

/**
 * Valor del inventario de la TIENDA: Σ (costo × stock) de cada producto.
 * Se calcula con el COSTO (lo que costó comprar/producir lo que hay en
 * estante), no con el precio de venta — por eso no es lo mismo que "cuánto
 * ganaría el Dueño si vendiera todo hoy".
 */
export function calcInventoryValue(products) {
  return (products || []).reduce(
    (sum, p) => sum + (Number(p.cost) || 0) * (Number(p.stock) || 0),
    0
  );
}
