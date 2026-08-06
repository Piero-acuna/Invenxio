// ─────────────────────────────────────────────────────────────────────────────
// api/mercadopago-webhook.js
// Función serverless de Vercel: POST /api/mercadopago-webhook
//
// ESTE es el único lugar que marca como "pagada" a una empresa que paga con
// Mercado Pago (el equivalente exacto de api/culqi-charge.js, pero para
// pagos que se confirman por webhook en vez de en la misma llamada).
//
// Mercado Pago llama a esta URL solo (nunca el navegador del usuario), pero
// AUN ASÍ no confiamos en el contenido de la notificación tal cual llega:
// cualquiera podría mandar un POST falso a esta URL fingiendo que un pago
// fue aprobado. Por eso, apenas llega la notificación, usamos el ID de pago
// que trae para volver a preguntarle a la propia API de Mercado Pago (con
// nuestra llave secreta) cuál es el estado REAL de ese pago — solo si esa
// respuesta dice "approved" se marca la empresa como pagada.
//
// VARIABLES DE ENTORNO QUE NECESITA (Vercel → Settings → Environment
// Variables — nunca en un archivo del repo):
//   MP_ACCESS_TOKEN         → mismo Access Token que mercadopago-preference.js
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//                             → mismas 3 variables que usa api/culqi-charge.js
//
// Configuración en Mercado Pago: Tus integraciones → tu app → Webhooks →
// URL de producción → https://TU-DOMINIO.vercel.app/api/mercadopago-webhook
// → eventos "Pagos".
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

const PLAN_DAYS = 30;

export default async function handler(req, res) {
  // Mercado Pago también manda pings GET al configurar el webhook —
  // respondemos 200 sin hacer nada para que la validación de la URL pase.
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    // Mercado Pago manda el ID del pago de varias formas según el tipo de
    // notificación (IPN clásico vs. Webhooks nuevos) — cubrimos ambas.
    const body = req.body || {};
    const query = req.query || {};
    const topic = query.topic || query.type || body.type;
    const paymentId =
      query["data.id"] ||
      body?.data?.id ||
      (topic === "payment" ? query.id : null);

    if (topic !== "payment" || !paymentId) {
      // No es una notificación de pago (puede ser de otro tipo de evento
      // que no usamos, ej. "merchant_order") — la reconocemos igual con 200
      // para que Mercado Pago no la siga reintentando, pero no hacemos nada.
      return res.status(200).json({ ok: true });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      console.error("MP_ACCESS_TOKEN no está configurada.");
      return res.status(500).json({ ok: false });
    }

    // 1. Volver a preguntarle a Mercado Pago el estado REAL de este pago
    //    (nunca confiamos en el body de la notificación).
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();

    if (!mpRes.ok) {
      console.error("mercadopago-webhook: no se pudo leer el pago", payment);
      return res.status(200).json({ ok: false }); // 200 igual, para no generar reintentos infinitos de un pago inválido
    }

    if (payment.status !== "approved") {
      // Pago pendiente/rechazado/en revisión — no hacemos nada todavía. Si
      // luego se aprueba, Mercado Pago vuelve a notificar.
      return res.status(200).json({ ok: true });
    }

    const companyId = payment.external_reference || payment.metadata?.company_id || payment.metadata?.companyId;
    if (!companyId) {
      console.error("mercadopago-webhook: pago aprobado sin companyId en external_reference", paymentId);
      return res.status(200).json({ ok: false });
    }

    // 2. Pago confirmado de verdad → recién ACÁ se marca la empresa como
    //    pagada, 30 días desde ahora. Igual que en culqi-charge.js.
    const paidUntil = new Date(Date.now() + PLAN_DAYS * 24 * 60 * 60 * 1000);
    await admin.firestore()
      .doc(`companies/${companyId}/meta/subscription`)
      .set({
        status: "active",
        plan: "monthly",
        paidUntil: paidUntil.toISOString(),
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastChargeId: String(payment.id),
        paymentGateway: "mercadopago",
      }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("mercadopago-webhook error:", err);
    // 200 igual: si devolvemos error, Mercado Pago reintenta indefinidamente
    // notificaciones que probablemente van a seguir fallando por lo mismo.
    return res.status(200).json({ ok: false });
  }
}
