// ─────────────────────────────────────────────────────────────────────────────
// src/utils/errors.js
// Manejo de errores centralizado para todo lo que NO es autenticación
// (AuthContext.jsx ya tiene su propio friendlyError() para códigos de
// Supabase Auth — un dominio distinto, con sus propios códigos).
//
// Antes, cada módulo repetía el mismo patrón suelto:
//   catch (err) {
//     console.error("Error guardando proveedor:", err);
//     setError(err?.message || "Error al guardar. Revisa la consola.");
//   }
// El problema con `err?.message` a secas es que, cuando el error viene de
// Postgres/PostgREST (permisos vía RLS, llaves duplicadas, columnas
// obligatorias faltantes, etc.), ese mensaje es texto técnico en inglés
// ("new row violates row-level security policy for table \"products\"") —
// nada útil para quien está vendiendo en el mostrador. Este archivo
// centraliza la traducción:
//   - Si el error trae un `code` de Postgres/PostgREST (ver tabla abajo), se
//     traduce a un mensaje en español.
//   - Si es un error que TIRAMOS nosotros mismos dentro de una función RPC
//     (`raise exception 'Stock insuficiente para...'` en 0003_functions.sql,
//     que Postgres reporta con code 'P0001'), su mensaje ya está en español
//     y se usa tal cual — es información específica que sí vale la pena
//     mostrar.
//
// NOTA DE MIGRACIÓN: este archivo antes traducía códigos de Firebase/
// Firestore ("permission-denied", "unavailable", ...). Como el proyecto ya
// migró por completo a Supabase (ver src/services/firestore/*.js), esos
// códigos nunca llegan a producirse — todo error de datos ahora es un
// PostgrestError con un `code` de Postgres/PostgREST, así que el mapa de
// abajo se actualizó para reflejar eso.
// ─────────────────────────────────────────────────────────────────────────────

const POSTGRES_ERROR_MESSAGES = {
  // ── Errores propios, lanzados a mano dentro de las funciones RPC
  //    (`raise exception '...'` en supabase/migrations/0003_functions.sql) —
  //    Postgres siempre los reporta con este código genérico. El mensaje ya
  //    viene en español y es específico, así que NO se traduce acá: se
  //    resuelve más abajo, antes de mirar la tabla, mostrando err.message
  //    tal cual (ver getErrorMessage()).
  // "P0001": (manejado aparte)

  // ── Restricciones de la base de datos ────────────────────────────────
  "23505": "Ya existe un registro con esos datos.",                       // unique_violation
  "23503": "No se puede completar: hay datos relacionados que lo impiden.", // foreign_key_violation
  "23502": "Faltan datos obligatorios.",                                  // not_null_violation
  "23514": "Algunos datos ingresados no son válidos.",                    // check_violation
  "22P02": "Algunos datos ingresados tienen un formato inválido.",        // invalid_text_representation (ej. UUID mal formado)

  // ── Row Level Security / permisos ────────────────────────────────────
  "42501": "No tienes permiso para hacer esto.",                          // insufficient_privilege (RLS deniega insert/update/delete)

  // ── PostgREST (la capa HTTP que usa el cliente de Supabase) ──────────
  "PGRST116": "El registro que buscas ya no existe.",                     // 0 filas para .single()/.maybeSingle() con esperado 1
  "PGRST301": "Tu sesión expiró. Vuelve a iniciar sesión.",                // JWT expirado/inválido
  "PGRST302": "Tu sesión expiró. Vuelve a iniciar sesión.",                // JWT ausente

  // ── Conexión / infraestructura ───────────────────────────────────────
  "57014": "La operación tardó demasiado. Intenta de nuevo.",             // query_canceled (timeout)
  "53300": "Se alcanzó un límite del sistema. Intenta más tarde.",        // too_many_connections

  // ── Códigos de Supabase Auth más comunes que también puede recibir la
  //    UI fuera de AuthContext.jsx (ej. al registrar un empleado desde
  //    RolePanel, donde el error se relanza después de que AuthContext ya
  //    seteó su propio authError). AuthContext.jsx sigue teniendo su
  //    friendlyError() propio, más completo, para el flujo de login/
  //    registro principal — esta lista es solo un respaldo para no mostrar
  //    texto técnico en inglés en otros lados.
  "user_already_exists":      "Ese correo ya está registrado.",
  "weak_password":            "La contraseña debe tener al menos 6 caracteres.",
  "invalid_credentials":      "Correo o contraseña incorrectos.",
  "email_not_confirmed":      "Confirma tu correo antes de iniciar sesión.",
  "over_request_rate_limit":  "Demasiados intentos. Intenta más tarde.",
};

const DEFAULT_FALLBACK = "Ocurrió un error. Inténtalo de nuevo.";

/**
 * Traduce cualquier error (de Postgres/PostgREST/Supabase Auth, o uno propio
 * lanzado con `raise exception '...'` dentro de una función RPC) a un
 * mensaje en español listo para mostrar.
 *
 * - Errores lanzados a mano en las funciones RPC (code === "P0001", ver
 *   0003_functions.sql): se muestra `err.message` tal cual, porque ya lo
 *   escribimos nosotros en español y suele ser información específica y
 *   accionable ("Stock insuficiente para \"Coca-Cola 500ml\": quedan 3, se
 *   intentó vender 5.").
 * - Errores de Postgres/PostgREST/Supabase Auth (traen `err.code`): se
 *   traducen con el diccionario de arriba. Un código no mapeado cae al
 *   `fallback` en vez de mostrar texto técnico en inglés.
 * - Errores de red (sin code, mensaje tipo "Failed to fetch"): mensaje de
 *   conexión genérico.
 * - Cualquier otro error sin `code` reconocible: se muestra `err.message`
 *   tal cual (mismo comportamiento que antes).
 */
export function getErrorMessage(err, fallback = DEFAULT_FALLBACK) {
  if (!err) return fallback;

  if (err.code === "P0001") {
    // Excepción propia lanzada con raise exception '...' en una función RPC
    // — ya está en español, se muestra directo.
    return err.message || fallback;
  }

  if (err.code && POSTGRES_ERROR_MESSAGES[err.code]) {
    return POSTGRES_ERROR_MESSAGES[err.code];
  }

  if (/failed to fetch|networkerror|network request failed/i.test(err.message || "")) {
    return "Error de red. Verifica tu conexión.";
  }

  if (err.code) {
    // Código reconocible pero no mapeado arriba: mejor un mensaje genérico
    // que texto técnico en inglés.
    return fallback;
  }

  return err.message || fallback;
}

/**
 * Azúcar sintáctico para el patrón más común: loguear el error completo a la
 * consola (para depurar) y devolver el mensaje amigable (para mostrar en la
 * UI), en una sola línea.
 *
 * @param {string} context  Prefijo descriptivo para la consola, ej. "Error guardando proveedor"
 */
export function logAndGetErrorMessage(err, context, fallback = DEFAULT_FALLBACK) {
  console.error(context, err);
  return getErrorMessage(err, fallback);
}
