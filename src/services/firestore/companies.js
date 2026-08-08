// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/companies.js
//
// Empresa, perfil de usuario (fundador), datos de facturación, y el estado de
// prueba gratis / suscripción de pago. Todo lo que vive en:
//   companies/{companyId}                        ← doc raíz de la empresa
//   companies/{companyId}/meta/subscription       ← solo lectura desde el cliente
//   companies/{companyId}/meta/invoiceCounter     ← correlativo de comprobantes
//   users/{uid}                                   ← perfil (companyId, role)
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc, setDoc, onSnapshot, updateDoc, serverTimestamp, runTransaction, db, companyRef } from "./shared";
import { getCountryConfig } from "../../config/countryConfig";

// Duración de la prueba gratis para toda empresa nueva. Un solo número acá
// controla todo el sistema — cambialo si quieres 7, 14, 30 días, etc.
export const TRIAL_DAYS = 14;

/**
 * Crea el documento de la empresa y el perfil del usuario fundador.
 * Se llama una única vez al registrar el primer usuario.
 *
 * `country` (código ISO, ej. "PE", "MX", o "OTHER" si no se especificó —
 * como en el registro con Google, que no pide país) determina de una vez
 * por todas la moneda y la pasarela de pago de la empresa: Perú usa
 * Culqi + soles (PEN), cualquier otro país usa Mercado Pago + dólares
 * (USD). Ver src/config/countryConfig.js.
 */
export async function createCompany({ companyName, ownerUid, ownerName, ownerEmail, country = "PE" }) {
  const { paymentGateway, currencyCode, currencySymbol } = getCountryConfig(country);

  // 1. Crear documento de la empresa
  const cRef = companyRef(ownerUid); // usamos uid como companyId para simplicidad
  await setDoc(cRef, {
    name:      companyName,
    createdAt: serverTimestamp(),
    ownerId:   ownerUid,
    plan:      "free",
    country,
    paymentGateway,
    currencyCode,
    currencySymbol,
  });

  // 2. Perfil del usuario → referencia a la empresa
  await setDoc(doc(db, "users", ownerUid), {
    name:      ownerName,
    email:     ownerEmail,
    companyId: ownerUid,          // companyId = uid del fundador
    role:      "owner",
    active:    true,
    createdAt: serverTimestamp(),
  });

  // 3. Estado inicial de suscripción: prueba gratis de TRIAL_DAYS días.
  //    Después de esto, este documento SOLO lo puede volver a tocar el
  //    backend de pagos (api/culqi-charge.js) — las reglas de Firestore
  //    bloquean cualquier update desde el cliente, incluso del propio Dueño.
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await setDoc(doc(db, "companies", ownerUid, "meta", "subscription"), {
    status: "trial",
    plan:   "trial",
    trialEndsAt: trialEndsAt.toISOString(),
    createdAt: serverTimestamp(),
    // Copiados acá también (además de en el doc raíz de la empresa) para que
    // el backend de cobro (api/culqi-charge.js o api/mercadopago-*.js) sepa
    // qué pasarela/moneda usar sin tener que leer otro documento aparte.
    paymentGateway,
    currencyCode,
  });

  return ownerUid; // retorna el companyId
}

/**
 * Obtiene el perfil del usuario (incluye companyId y role).
 */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Crea el perfil de un usuario que es invitado a una empresa existente.
 */
export async function createUserProfile({ uid, name, email, companyId, role = "empleado", permissions = {} }) {
  await setDoc(doc(db, "users", uid), {
    name, email, companyId, role, permissions,
    active:    true,
    createdAt: serverTimestamp(),
  });
}

/**
 * Obtiene el perfil de la empresa.
 */
export async function getCompanyProfile(companyId) {
  const snap = await getDoc(companyRef(companyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Escucha en tiempo real el documento de la empresa completo (nombre,
 * y datos de facturación dentro del campo `billing`). Se usa para mostrar
 * los Datos de Facturación en el Panel y para emitir comprobantes al vuelo.
 */
export function subscribeToCompany(companyId, onData) {
  return onSnapshot(companyRef(companyId), (snap) => {
    onData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Guarda/actualiza los Datos de Facturación del Dueño (Razón Social, RUC/DNI,
 * dirección, teléfono, email, serie del comprobante). Solo Dueño/Admin puede
 * escribir aquí — lo exigen las reglas de Firestore sobre companies/{id}.
 */
export async function updateCompanyBilling(companyId, billing) {
  return updateDoc(companyRef(companyId), {
    billing,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cambia el país (y por lo tanto la moneda + pasarela de pago) de una
 * empresa YA REGISTRADA. Ver src/config/countryConfig.js para la regla
 * país → moneda/pasarela.
 *
 * IMPORTANTE — esto NO convierte montos ya guardados: un producto que
 * costaba "20" en soles va a costar "20" en dólares después del cambio,
 * porque este sistema no hace conversión de tipo de cambio. Solo cambia
 * el símbolo con el que se muestra todo de ahora en adelante y a qué
 * pasarela se le cobra la próxima suscripción. Por eso el selector en la
 * UI (ver RolePanel.jsx) muestra siempre esta advertencia antes de guardar.
 */
export async function updateCompanyCountry(companyId, country) {
  const { paymentGateway, currencyCode, currencySymbol } = getCountryConfig(country);
  return updateDoc(companyRef(companyId), {
    country,
    paymentGateway,
    currencyCode,
    currencySymbol,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Suscripción en tiempo real al estado de prueba gratis / pago de la
 * empresa (companies/{id}/meta/subscription). Es de SOLO LECTURA desde el
 * cliente — ver firestore.rules — así que este archivo no tiene ninguna
 * función para escribirlo; eso solo lo hace api/culqi-charge.js con el
 * Admin SDK, después de confirmar un cobro real con Culqi.
 */
export function subscribeToSubscription(companyId, onData) {
  return onSnapshot(doc(db, "companies", companyId, "meta", "subscription"), (snap) => {
    onData(snap.exists() ? snap.data() : null);
  });
}

/**
 * Obtiene el estado de suscripción una sola vez (no en tiempo real) — lo
 * usa el botón de pago para mandarle a Culqi el plan/monto correcto.
 */
export async function getSubscription(companyId) {
  const snap = await getDoc(doc(db, "companies", companyId, "meta", "subscription"));
  return snap.exists() ? snap.data() : null;
}

/**
 * Devuelve el siguiente número correlativo de comprobante, incrementándolo
 * de forma atómica (a salvo de condiciones de carrera si dos ventas se
 * registran casi al mismo tiempo).
 *
 * Vive en una SUBCOLECCIÓN (companies/{id}/meta/invoiceCounter) y no en el
 * documento raíz de la empresa, a propósito: las reglas de Firestore solo
 * dejan escribir el documento raíz companies/{id} a un Dueño/Admin, pero
 * cualquier empleado con permiso de ventas o proveedores necesita poder
 * emitir un comprobante. Las subcolecciones sí están abiertas a cualquier
 * miembro de la misma empresa.
 */
export async function getNextInvoiceNumber(companyId) {
  const counterRef = doc(db, "companies", companyId, "meta", "invoiceCounter");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
}
