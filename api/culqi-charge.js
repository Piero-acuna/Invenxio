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
//  2. Usa el cliente admin de Supabase (service_role), que ignora RLS a
//     propósito — es la ÚNICA forma de escribir en public.subscriptions,
//     porque 0002_rls.sql bloquea esa escritura para cualquier usuario
//     normal (ver el comentario ahí). Si esta lógica viviera en el cliente,
//     cualquier persona con la consola del navegador podría llamarla
//     directamente y "pagarse" gratis sin cobrar nada de verdad.
//
// NOTA DE MIGRACIÓN: este endpoint usaba Firebase Admin + Firestore
// (companies/{id}/meta/subscription). Como el resto del proyecto ya migró a
// Supabase (public.subscriptions), este archivo se actualizó para usar
// api/_supabaseAdmin.js — firebase-admin ni siquiera está en package.json,
// así que la versión anterior no podía desplegarse.
//
// VARIABLES DE ENTORNO QUE NECESITA (Vercel → Settings → Environment
// Variables — NUNCA las pongas en un archivo del repo):
//   CULQI_SECRET_KEY          → la Llave Secreta de tu cuenta Culqi (sk_live_… o sk_test_…)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → las mismas que usa api/_supabaseAdmin.js
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin, verifyBearerToken } from "./_supabaseAdmin.js";

const PLAN_AMOUNT_CENTS = 5799; // S/ 57.99 — debe coincidir con PLAN_AMOUNT_CENTS de PaywallScreen.jsx
const PLAN_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    // 1. Verificar identidad: el token de sesión que manda el navegador
    //    PRUEBA quién es el usuario — nunca confiamos en "companyId" solo
    //    porque vino en el body, sin este paso cualquiera podría mandar el
    //    companyId de otra empresa y pagarle su plan.
    const caller = await verifyBearerToken(req);
    const admin = supabaseAdmin();

    const { token, companyId } = req.body || {};
    if (!token || !companyId) {
      return res.status(400).json({ ok: false, error: "Faltan datos del pago." });
    }
    // En esta app, companyId == uid del Dueño fundador (ver create_company()
    // en 0003_functions.sql) — así que solo el propio Dueño puede pagar la
    // suscripción de SU empresa, nunca la de otra.
    if (caller.id !== companyId) {
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
        email: caller.email || "sin-email@invenxio.app",
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
    //    a esta fila (ver 0002_rls.sql: el cliente nunca puede).
    const paidUntil = new Date(Date.now() + PLAN_DAYS * 24 * 60 * 60 * 1000);
    const { error: upsertErr } = await admin.from("subscriptions").upsert(
      {
        company_id: companyId,
        status: "active",
        plan: "monthly",
        paid_until: paidUntil.toISOString(),
        last_payment_at: new Date().toISOString(),
        last_charge_id: String(charge.id),
        payment_gateway: "culqi",
        currency_code: "PEN",
      },
      { onConflict: "company_id" }
    );
    if (upsertErr) throw upsertErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    console.error("culqi-charge error:", err);
    return res.status(status).json({ ok: false, error: "Error interno al procesar el pago. Si tu tarjeta fue cargada, contáctanos." });
  }
}
