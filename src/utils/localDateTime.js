// ─────────────────────────────────────────────────────────────────────────────
// src/utils/localDateTime.js
//
// BUG QUE ESTO CORRIGE: varias RPC de Postgres (record_purchase, record_sale,
// add_warehouse_movement, etc.) fechaban cada fila con `current_date` /
// `now()` — que Postgres evalúa en el timezone de LA BASE DE DATOS (UTC por
// defecto en Supabase), no en el del país de la empresa. Como esta app tiene
// empresas en Perú y el resto de Latinoamérica (todos UTC-3 a UTC-6), CUALQUIER
// venta o compra registrada después de aprox. las 7pm hora local quedaba
// fechada al día SIGUIENTE (porque para esa hora ya es "mañana" en UTC) —
// rompía el historial, el gráfico diario/semanal y los comprobantes.
//
// La corrección: el navegador del usuario SÍ conoce su hora local real (el
// dispositivo está configurado en el timezone de quien lo usa), así que en
// vez de confiar en el reloj del servidor, el cliente le manda su fecha/hora
// local a las RPC — que las usan si vienen, y si no (llamadas antiguas o de
// otro origen) siguen cayendo en el comportamiento anterior (current_date/
// now()) como respaldo, sin romper nada.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fecha y hora LOCAL del navegador, listas para mandar como p_client_date /
 * p_client_time a las RPC que registran ventas, compras y movimientos.
 * @returns {{ clientDate: string, clientTime: string }} clientDate en
 *   "YYYY-MM-DD" (para columnas `date`), clientTime en "HH:MM" 24h.
 */
export function getLocalDateTimeParams() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    clientDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    clientTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
