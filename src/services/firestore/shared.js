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

// ═══════════════════════════════════════════════════════════════════════════
// Resiliencia ante bfcache (Back/Forward Cache)
//
// PROBLEMA: cuando el usuario navega hacia atrás/adelante, el navegador
// puede congelar la página entera en memoria (bfcache) en vez de destruirla
// — y para poder hacerlo, CIERRA el WebSocket de Supabase Realtime por su
// cuenta (es una restricción del propio bfcache, no un bug nuestro: una
// página con un socket abierto puede quedar excluida del bfcache a menos
// que el socket se cierre al congelarla). El componente de React NO se
// desmonta en este proceso — la página completa queda pausada tal cual
// estaba — así que el cleanup normal de useEffect (el `return () => ...`
// de cada subscribeTo*) NUNCA se dispara. El canal queda "vivo" en el
// estado de JS pero con el socket ya muerto: el cliente deja de recibir
// actualizaciones en tiempo real sin ningún aviso, y si el navegador lo
// mata de forma abrupta en vez de un cierre limpio, Supabase puede tardar
// en notar la desconexión del lado del servidor (la "conexión fantasma"
// que se ve en el dashboard de Supabase).
//
// SOLUCIÓN: los eventos `pagehide`/`pageshow` del navegador SÍ se disparan
// en el ciclo de vida del bfcache (a diferencia del unmount de React), y
// `event.persisted === true` distingue "la página va/viene del bfcache" de
// un cierre de pestaña real:
//   • pagehide (persisted): se cierra el canal A PROPÓSITO, antes de que
//     el navegador lo mate solo — así el servidor recibe un cierre limpio
//     en vez de dejar una conexión fantasma.
//   • pageshow (persisted): la página se restauró desde el bfcache con el
//     canal ya cerrado — se crea uno NUEVO. Nunca hay duplicados porque
//     (a) el viejo ya se removió explícitamente en pagehide, y (b)
//     uniqueChannelName() igual garantiza un topic distinto por canal. Se
//     dispara además un refetch inmediato, porque cualquier cambio
//     ocurrido mientras la página estuvo congelada se perdió por completo
//     (no había conexión para recibirlo).
//
// subscribeToChannel() envuelve ese ciclo para que cada suscripción del
// proyecto lo tenga gratis, sin repetir esta lógica en cada archivo.
// `buildChannel` crea y suscribe un canal nuevo (debe devolverlo ya
// `.subscribe()`ado); `refetch` es la función que vuelve a pedir los datos
// actuales cuando se restaura desde bfcache.
export function subscribeToChannel({ buildChannel, refetch }) {
  let channel = buildChannel();

  function handlePageHide(event) {
    if (event.persisted && channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  function handlePageShow(event) {
    if (event.persisted) {
      if (!channel) channel = buildChannel();
      refetch();
    }
  }

  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);

  // Limpieza real: se llama tanto en un unmount normal de React como desde
  // pagehide cuando la página NO va al bfcache (persisted === false, ej.
  // cierre de pestaña) — en ese caso el propio removeChannel de más abajo
  // en cada subscribeTo*() ya se encarga; acá solo se retiran los
  // listeners y se cierra el canal si seguía abierto.
  return function cleanup() {
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

// ── Timestamps: Postgres pone `now()` solo. Para nuevos inserts, dejamos que
//    la columna default/trigger lo genere; NO mandamos created_at/updated_at
//    en los payloads de insert/update (a diferencia de Firestore, donde
//    serverTimestamp() se pasaba explícito en cada escritura).

/**
 * Suscripción en tiempo real a una colección de la empresa — mismo contrato
 * que el subscribeToCollection original de Firestore: (companyId, colName,
 * onData, orderField) → unsubscribe().
 */
export function subscribeToCollection(companyId, table, onData, orderField = "createdAt", limit = null) {
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
    let query = supabase
      .from(tableName)
      .select("*")
      .eq("company_id", companyId)
      .order(orderCol, { ascending: false });
    // `limit`: sin esto, cada carga (y cada evento de realtime — una fila
    // nueva dispara una re-consulta de TODA la tabla) descarga la tabla
    // completa de la empresa entera, sin importar cuánto haya crecido. Para
    // catálogos (products, suppliers, ubicaciones) eso es correcto — se
    // necesitan todos. Para tablas tipo "historial" (transactions,
    // warehouse_movements) que solo crecen con el tiempo, quien llama puede
    // pasar un límite razonable (ver MovementsModule.jsx / SuppliersModule.jsx)
    // para traer solo lo reciente en vez de años de historial cada vez.
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) {
      console.error(`[supabase] subscribeToCollection(${tableName}):`, error);
      return;
    }
    if (!cancelled) onData(rowsToCamel(data));
  }

  fetchAll();

  // BUG DE RENDIMIENTO QUE ESTO EVITA: `event: "*"` dispara un evento de
  // Realtime POR CADA FILA que cambia — no uno por operación. Una venta con
  // 5 productos en el carrito (record_sale) hace 5 INSERT en `transactions`
  // en una sola llamada RPC, pero eso genera 5 eventos de Realtime casi
  // simultáneos, y sin este debounce cada uno disparaba su PROPIA
  // re-consulta completa de la tabla — 5 lecturas idénticas donde bastaba
  // con 1. El debounce junta cualquier ráfaga de eventos que llegue dentro
  // de esta ventana en una sola re-consulta al final.
  const DEBOUNCE_MS = 300;
  let debounceTimer = null;
  const scheduleFetch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchAll, DEBOUNCE_MS);
  };

  function buildChannel() {
    return supabase
      .channel(uniqueChannelName(`${tableName}:${companyId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableName, filter: `company_id=eq.${companyId}` },
        scheduleFetch
      )
      .subscribe();
  }
  const unsubscribeChannel = subscribeToChannel({ buildChannel, refetch: fetchAll });

  return () => {
    cancelled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribeChannel();
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

  let debounceTimer = null;
  const scheduleFetch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchOne, 300);
  };

  function buildChannel() {
    return supabase
      .channel(uniqueChannelName(`${table}:${matchColumn}:${matchValue}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `${matchColumn}=eq.${matchValue}` },
        scheduleFetch
      )
      .subscribe();
  }
  const unsubscribeChannel = subscribeToChannel({ buildChannel, refetch: fetchOne });

  return () => {
    cancelled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribeChannel();
  };
}
