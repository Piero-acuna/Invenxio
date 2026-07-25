// ─────────────────────────────────────────────────────────────────────────────
// api/culqi-charge.js
// Función serverless de Vercel (se despliega sola, no requiere configuración
// extra — cualquier archivo dentro de /api se convierte en un endpoint,
// aquí queda como POST /api/culqi-charge).
//
// ESTE ES EL ÚNICO LUGAR DE TODO EL PROYECTO QUE PUEDE MARCAR UNA EMPRESA
// COMO "PAGADA". Corre en el servidor de Vercel, nunca en el navegador del
// usuario, por dos razones de seguridad:
//
//  1. Necesita la CULQI_SECRET_KEY para cobrar de verdad — esa llave nunca
//     debe existir en código que corra en el navegador (cualquiera podría
//     leerla y cobrar/reembolsar con tu cuenta de Culqi).
//  2. Usa Firebase Admin SDK, que ignora las reglas de Firestore a propósito
//     — es la ÚNICA forma de escribir companies/{id}/meta/subscription,
//     porque firestore.rules bloquea esa escritura para cualquier usuario
//     normal (ver el comentario ahí). Si esta lógica viviera en el cliente,
//     cualquier persona con la consola del navegador podría llamarla
//     directamente y "pagarse" gratis sin cobrar nada de verdad.
//
// VARIABLES DE ENTORNO QUE NECESITA (configúralas en Vercel → Settings →
// Environment Variables — NUNCA las pongas en un archivo del repo):
//   CULQI_SECRET_KEY        → la Llave Secreta de tu cuenta Culqi (sk_live_… o sk_test_…)
//   FIREBASE_PROJECT_ID     → el project_id del archivo JSON de tu cuenta de servicio
//   FIREBASE_CLIENT_EMAIL   → el client_email de ese mismo archivo
//   FIREBASE_PRIVATE_KEY    → el private_key de ese mismo archivo (con los \n literales)
//
// Cómo conseguir el archivo de cuenta de servicio de Firebase:
//   Consola de Firebase → ⚙️ Configuración del proyecto → Cuentas de
//   servicio → "Generar nueva clave privada". Copia project_id, client_email
//   y private_key a esas 3 variables en Vercel (el private_key trae saltos
//   de línea "\n" dentro del texto — Vercel los soporta si los pegas tal
//   cual, entre comillas).
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";

// La app de Admin SDK se inicializa UNA sola vez por instancia "caliente" de
// la función — Vercel puede reusar el mismo proceso entre invocaciones.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:  process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel guarda los saltos de línea como el texto literal "\n" — hay
      // que devolverlos a saltos de línea reales antes de usarlos.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const PLAN_AMOUNT_CENTS = 5499; // S/ 54.99 — debe coincidir con PLAN_AMOUNT_CENTS de PaywallScreen.jsx
const PLAN_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    // 1. Verificar identidad: el token de Firebase Auth que manda el
    //    navegador PRUEBA quién es el usuario — nunca confiamos en
    //    "companyId" solo porque vino en el body, sin este paso cualquiera
    //    podría mandar el companyId de otra empresa y pagarle su plan.
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ ok: false, error: "Falta autenticación." });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { token, companyId } = req.body || {};

    if (!token || !companyId) {
      return res.status(400).json({ ok: false, error: "Faltan datos del pago." });
    }
    // En esta app, companyId == uid del Dueño fundador (ver createCompany
    // en firestoreService.js) — así que solo el propio Dueño puede pagar la
    // suscripción de SU empresa, nunca la de otra.
    if (decoded.uid !== companyId) {
      return res.status(403).json({ ok: false, error: "No puedes pagar la suscripción de otra empresa." });
    }

    // 2. Cobrar de verdad con Culqi, usando la llave SECRETA (server-side).
    const culqiRes = await fetch("https://api.culqi.com/v2/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
      },
      body: JSON.stringify({
        amount: PLAN_AMOUNT_CENTS,
        currency_code: "PEN",
        email: decoded.email || "sin-email@invenxio.app",
        source_id: token,
        description: "Suscripción mensual Invenxio",
        metadata: { companyId },
      }),
    });
    const charge = await culqiRes.json();

    if (!culqiRes.ok) {
      // Culqi devuelve el motivo del rechazo en `user_message` (ya en
      // español, seguro de mostrar tal cual al usuario).
      return res.status(402).json({ ok: false, error: charge.user_message || charge.merchant_message || "El cobro fue rechazado." });
    }

    // 3. Cobro confirmado → recién ACÁ se marca la empresa como pagada,
    //    30 días desde ahora. Esta es la única escritura de todo el sistema
    //    a este documento (ver firestore.rules: el cliente nunca puede).
    const paidUntil = new Date(Date.now() + PLAN_DAYS * 24 * 60 * 60 * 1000);
    await admin.firestore()
      .doc(`companies/${companyId}/meta/subscription`)
      .set({
        status: "active",
        plan: "monthly",
        paidUntil: paidUntil.toISOString(),
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastChargeId: charge.id,
      }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("culqi-charge error:", err);
    return res.status(500).json({ ok: false, error: "Error interno al procesar el pago. Si tu tarjeta fue cargada, contáctanos." });
  }
}
