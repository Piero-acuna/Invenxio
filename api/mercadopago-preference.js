// ─────────────────────────────────────────────────────────────────────────────
// api/mercadopago-preference.js
// Función serverless de Vercel: POST /api/mercadopago-preference
//
// Crea una "preferencia" de pago de Mercado Pago Checkout Pro y devuelve la
// URL (`init_point`) a la que el navegador debe redirigir al Dueño para que
// pague. Se usa para las empresas registradas fuera de Perú (ver
// src/config/countryConfig.js) — el equivalente de api/culqi-charge.js pero
// para Mercado Pago.
//
// IMPORTANTE: este endpoint NO marca ninguna empresa como pagada. Solo abre
// el checkout. La confirmación real del pago (y la única escritura a
// companies/{id}/meta/subscription) ocurre en api/mercadopago-webhook.js,
// cuando Mercado Pago avisa que el pago fue aprobado — nunca antes, y nunca
// confiando en lo que vuelva del navegador del usuario.
//
// VARIABLES DE ENTORNO QUE NECESITA (Vercel → Settings → Environment
// Variables — nunca en un archivo del repo):
//   MP_ACCESS_TOKEN         → Access Token de producción de tu cuenta
//                             Mercado Pago (Tus integraciones → Credenciales)
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//                             → mismas 3 variables que usa api/culqi-charge.js,
//                               solo para verificar el token de sesión del
//                               usuario (no se escribe nada en Firestore acá).
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:  process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const PLAN_AMOUNT_USD = 14.99; // $ 14.99 — debe coincidir con PLAN_AMOUNT_USD de PaywallScreen.jsx

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    // 1. Verificar identidad, igual que en culqi-charge.js: nunca confiamos
    //    en companyId solo porque vino en el body.
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ ok: false, error: "Falta autenticación." });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { companyId, returnUrl } = req.body || {};

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "Falta companyId." });
    }
    if (decoded.uid !== companyId) {
      return res.status(403).json({ ok: false, error: "No puedes pagar la suscripción de otra empresa." });
    }
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: "MP_ACCESS_TOKEN no está configurada en el servidor." });
    }

    // La URL de vuelta la manda el navegador (la propia pantalla de pago);
    // solo la usamos si es una URL http(s) válida, para no reenviar a nada
    // raro si llegara algo mal formado.
    let backUrl;
    try {
      backUrl = new URL(returnUrl).toString();
    } catch {
      backUrl = `${req.headers.origin || ""}/`;
    }

    // 2. Crear la preferencia con la llave SECRETA (server-side). El monto
    //    y la moneda los define el servidor, nunca el cliente.
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{
          title: "Suscripción mensual Invenxio",
          quantity: 1,
          currency_id: "USD",
          unit_price: PLAN_AMOUNT_USD,
        }],
        payer: { email: decoded.email || undefined },
        external_reference: companyId,
        back_urls: {
          success: backUrl,
          failure: backUrl,
          pending: backUrl,
        },
        auto_return: "approved",
        notification_url: `${req.headers.origin || ""}/api/mercadopago-webhook`,
        metadata: { companyId },
      }),
    });
    const preference = await mpRes.json();

    if (!mpRes.ok) {
      return res.status(502).json({ ok: false, error: preference.message || "No se pudo crear la preferencia de pago." });
    }

    return res.status(200).json({ ok: true, initPoint: preference.init_point });
  } catch (err) {
    console.error("mercadopago-preference error:", err);
    return res.status(500).json({ ok: false, error: "Error interno al iniciar el pago." });
  }
}
