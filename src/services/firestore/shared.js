// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/shared.js
//
// Adaptador Supabase que reemplaza al de Firestore. Se mantiene el nombre de
// carpeta "firestore" y las mismas funciones exportadas a propósito: así
// NINGÚN componente de la UI (que importa desde "../services/firestoreService")
// tiene que cambiar una sola línea.
//
// Piezas clave de este adaptador:
//   1. rowToCamel / paramsToSnake — Postgres devuelve snake_case
//      (company_id, min_stock, ...) y toda la UI espera camelCase
//      (companyId, minStock, ...), igual que los devolvía Firestore. Este
//      archivo hace esa conversión automáticamente en cada lectura/escritura
//      para que el resto del código no note la diferencia.
//   2. subscribeToCollection — mismo contrato que el onSnapshot de Firestore:
//      recibe (companyId, tabla, onData, orderField) y devuelve una función
//      `unsubscribe`. Internamente hace un SELECT inicial + un canal de
//      Realtime (postgres_changes) que vuelve a pedir los datos ante
//      cualquier INSERT/UPDATE/DELETE de esa tabla para esa empresa.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../../lib/supabaseClient";

export { supabase };

// ── camelCase ⇄ snake_case (solo llaves de primer nivel — los campos jsonb
//    como `billing` o `permissions` se guardan y devuelven TAL CUAL, sin
//    tocar sus llaves internas, porque son objetos opacos para la capa de
//    datos, no columnas). ─────────────────────────────────────────────────
const snakeToCamelStr = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const camelToSnakeStr = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function rowToCamel(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const k of Object.keys(row)) out[snakeToCamelStr(k)] = row[k];
  // Compatibilidad con el shape que usaba Firestore: { id, ...datos }.
  // Postgres ya devuelve "id" tal cual, así que no hace falta nada extra.
  return out;
}

export function rowsToCamel(rows) {
  return (rows || []).map(rowToCamel);
}

export function paramsToSnake(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of Object.keys(obj)) out[camelToSnakeStr(k)] = obj[k];
  return out;
}

/** Lanza si Supabase devolvió error — mismo patrón que un throw de Firestore. */
export function assertNoError(error, context) {
  if (error) {
    console.error(`[supabase] ${context}:`, error);
    throw new Error(error.message || `Error en ${context}`);
  }
}

// ── Nombres de canal ÚNICOS por suscripción ─────────────────────────────
// BUG QUE ESTO EVITA: si dos canales se crean con el MISMO nombre de topic
// mientras el anterior todavía no terminó de cerrarse (ej. React StrictMode
// desmonta y remonta un componente muy rápido, o dos componentes distintos
// se suscriben a la misma tabla a la vez), el cliente de Supabase Realtime
// detecta el topic repetido y devuelve el canal VIEJO ya suscrito en vez de
// crear uno nuevo. Llamar `.on()` sobre un canal ya suscrito lanza:
// "cannot add `postgres_changes` callbacks ... after `subscribe()`" — un
// error no capturado que tira abajo el render de React (pantalla blanca).
// La solución recomendada por Supabase es simple: que el nombre del topic
// sea único por cada suscripción activa, no solo por tabla+empresa.
let channelSeq = 0;
export const uniqueChannelName = (base) => `${base}:${Date.now()}:${channelSeq++}`;

// ── Timestamps: Postgres pone `now()` solo. Para nuevos inserts, dejamos que
//    la columna default/trigger lo genere; NO mandamos created_at/updated_at
//    en los payloads de insert/update (a diferencia de Firestore, donde
//    serverTimestamp() se pasaba explícito en cada escritura).

/**
 * Suscripción en tiempo real a una colección de la empresa — mismo contrato
 * que el subscribeToCollection original de Firestore: (companyId, colName,
 * onData, orderField) → unsubscribe().
 */
export function subscribeToCollection(companyId, table, onData, orderField = "createdAt") {
  // BUG QUE ESTO EVITA: los módulos llaman a este hook con el mismo nombre
  // "camelCase" que usaba la colección de Firestore (ej. "supplierSales",
  // "warehouseMovements"), pero las tablas reales en Postgres están en
  // snake_case ("supplier_sales", "warehouse_movements") — nombres de tabla
  // distintos no son lo mismo que nombres de COLUMNA distintos: Postgres no
  // hace ningún tipo de match insensible a mayúsculas/guiones bajos para
  // relaciones. Sin esta conversión, `.from("supplierSales")` fallaba con
  // "relation does not exist", el catch silencioso de abajo solo hacía
  // console.error sin llamar a onData(), y el `loading` del hook useCollection
  // se quedaba en `true` para siempre — eso es lo que colgaba el Dashboard
  // (ver loadingSS en DashboardModule.jsx).
  const tableName = camelToSnakeStr(table);
  const orderCol = camelToSnakeStr(orderField);
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .eq("company_id", companyId)
      .order(orderCol, { ascending: false });
    if (error) {
      console.error(`[supabase] subscribeToCollection(${tableName}):`, error);
      return;
    }
    if (!cancelled) onData(rowsToCamel(data));
  }

  fetchAll();

  const channel = supabase
    .channel(uniqueChannelName(`${tableName}:${companyId}`))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: tableName, filter: `company_id=eq.${companyId}` },
      () => fetchAll()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

/**
 * Suscripción en tiempo real a UNA fila (equivalente a onSnapshot de un
 * doc() de Firestore) — usada para companies/{id} y meta/subscription.
 */
export function subscribeToRow(table, matchColumn, matchValue, onData) {
  let cancelled = false;

  async function fetchOne() {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(matchColumn, matchValue)
      .maybeSingle();
    if (error) {
      console.error(`[supabase] subscribeToRow(${table}):`, error);
      return;
    }
    if (!cancelled) onData(data ? rowToCamel(data) : null);
  }

  fetchOne();

  const channel = supabase
    .channel(uniqueChannelName(`${table}:${matchColumn}:${matchValue}`))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `${matchColumn}=eq.${matchValue}` },
      () => fetchOne()
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}
