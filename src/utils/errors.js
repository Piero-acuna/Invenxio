// ─────────────────────────────────────────────────────────────────────────────
// src/utils/errors.js
// Manejo de errores centralizado para todo lo que NO es autenticación
// (AuthContext.jsx ya tiene su propio friendlyError() para códigos de
// Firebase Auth — un dominio distinto, con sus propios códigos).
//
// Antes, cada módulo repetía el mismo patrón suelto:
//   catch (err) {
//     console.error("Error guardando proveedor:", err);
//     setError(err?.message || "Error al guardar. Revisa la consola.");
//   }
// El problema con `err?.message` a secas es que, cuando el error viene de
// Firestore (permisos, red, límites), ese mensaje es texto técnico en inglés
// ("Missing or insufficient permissions.") — nada útil para quien está
// vendiendo en el mostrador. Este archivo centraliza la traducción:
//   - Si el error trae un `code` de Firebase/Firestore (permission-denied,
//     unavailable, etc.), se traduce a un mensaje en español.
//   - Si es un error que TIRAMOS nosotros mismos (`throw new Error("Stock
//     insuficiente para...")`, sin `code`), su mensaje ya está en español y
//     se usa tal cual — es información específica que sí vale la pena mostrar.
// ─────────────────────────────────────────────────────────────────────────────

const FIRESTORE_ERROR_MESSAGES = {
  "permission-denied":    "No tienes permiso para hacer esto.",
  "unauthenticated":      "Tu sesión expiró. Vuelve a iniciar sesión.",
  "unavailable":          "Sin conexión con el servidor. Verifica tu internet e intenta de nuevo.",
  "not-found":            "El registro que buscas ya no existe.",
  "already-exists":       "Ya existe un registro con esos datos.",
  "resource-exhausted":   "Se alcanzó un límite del sistema. Intenta más tarde.",
  "deadline-exceeded":    "La operación tardó demasiado. Intenta de nuevo.",
  "cancelled":            "La operación fue cancelada.",
  "aborted":              "No se pudo completar por un conflicto (alguien más lo modificó al mismo tiempo). Intenta de nuevo.",
  "failed-precondition":  "No se puede completar esta acción en el estado actual.",
  "invalid-argument":     "Algunos datos ingresados no son válidos.",
  "internal":             "Ocurrió un error interno. Intenta de nuevo.",
  "data-loss":            "Ocurrió un error leyendo los datos. Intenta de nuevo.",

  // Códigos de Firebase Auth más comunes que también puede recibir la UI
  // fuera de AuthContext.jsx (ej. al registrar un empleado desde RolePanel,
  // donde el error se relanza después de que AuthContext ya seteó su propio
  // authError). AuthContext.jsx sigue teniendo su friendlyError() propio,
  // más completo, para el flujo de login/registro principal — esta lista es
  // solo un respaldo para no mostrar texto técnico en inglés en otros lados.
  "auth/email-already-in-use": "Ese correo ya está registrado.",
  "auth/weak-password":        "La contraseña debe tener al menos 6 caracteres.",
  "auth/invalid-email":        "Correo electrónico inválido.",
  "auth/network-request-failed": "Error de red. Verifica tu conexión.",
};

const DEFAULT_FALLBACK = "Ocurrió un error. Inténtalo de nuevo.";

/**
 * Traduce cualquier error (de Firestore/Firebase, o uno propio tirado con
 * `throw new Error("...")`) a un mensaje en español listo para mostrar.
 *
 * - Errores de Firebase/Firestore (traen `err.code`): se traducen con el
 *   diccionario de arriba. Un código no mapeado cae al `fallback` en vez de
 *   mostrar texto técnico en inglés.
 * - Errores propios (sin `err.code`, como los que tira recordSale cuando no
 *   alcanza el stock): se muestra `err.message` tal cual, porque ya lo
 *   escribimos nosotros en español y suele ser información específica y
 *   accionable ("Solo hay 3 Cajas disponibles en esa ubicación").
 */
export function getErrorMessage(err, fallback = DEFAULT_FALLBACK) {
  if (!err) return fallback;
  if (err.code) {
    const code = String(err.code).replace(/^firestore\//, "");
    return FIRESTORE_ERROR_MESSAGES[code] || fallback;
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
