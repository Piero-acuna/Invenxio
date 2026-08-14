// ─────────────────────────────────────────────────────────────────────────────
// api/grant-access.js
// Endpoint administrativo para conceder días de cortesía a una empresa.
//
// NOTA DE MIGRACIÓN: usaba firebase-admin/Firestore (paquete que ni siquiera
// está en package.json, así que no podía desplegarse). Se migró a
// api/_supabaseAdmin.js, escribiendo en public.subscriptions con el cliente
// service_role (bypasea RLS, igual que hacían los otros backends de pago).
// ─────────────────────────────────────────────────────────────────────────────
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "./_supabaseAdmin.js";

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Buffers de distinto largo no se pueden comparar con timingSafeEqual
  // directamente — igual retornamos false, pero sin filtrar el largo real
  // comparando contra sí mismo primero (evita "early return" visible).
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  // 1. Validar secreto administrativo (comparación en tiempo constante para
  //    no filtrar información por timing).
  const authHeader = req.headers.authorization || "";

  const providedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!process.env.ADMIN_SECRET) {
    console.error("ADMIN_SECRET no está configurada.");

    return res.status(500).json({
      ok: false,
      error: "ADMIN_SECRET no está configurada en Vercel.",
    });
  }

  if (!providedSecret || !safeEqual(providedSecret, process.env.ADMIN_SECRET)) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado.",
    });
  }

  try {
    // 2. Verificar variables de Supabase
    const requiredVariables = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

    const missingVariables = requiredVariables.filter(
      (variable) => !process.env[variable]
    );

    if (missingVariables.length > 0) {
      return res.status(500).json({
        ok: false,
        error: `Faltan variables de entorno en Vercel: ${missingVariables.join(
          ", "
        )}`,
      });
    }

    // 3. Leer y validar body
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "El cuerpo enviado no contiene un JSON válido.",
        });
      }
    }

    const companyId =
      typeof body?.companyId === "string" ? body.companyId.trim() : "";

    const dias = Number(body?.dias);

    if (!companyId) {
      return res.status(400).json({
        ok: false,
        error: "companyId es obligatorio.",
      });
    }

    if (!Number.isInteger(dias) || dias <= 0) {
      return res.status(400).json({
        ok: false,
        error: "dias debe ser un número entero positivo.",
      });
    }

    // 4. Buscar suscripción existente
    const admin = supabaseAdmin();

    const { data: subscription, error: fetchErr } = await admin
      .from("subscriptions")
      .select("company_id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (!subscription) {
      return res.status(404).json({
        ok: false,
        error: `No existe una suscripción para la empresa ${companyId}.`,
      });
    }

    // 5. Calcular nueva fecha y actualizar
    const paidUntil = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    const { error: updateErr } = await admin
      .from("subscriptions")
      .update({
        status: "active",
        plan: "cortesia",
        paid_until: paidUntil.toISOString(),
        granted_manually_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);

    if (updateErr) throw updateErr;

    return res.status(200).json({
      ok: true,
      companyId,
      dias,
      paidUntil: paidUntil.toISOString(),
    });
  } catch (error) {
    console.error("grant-access error:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno al otorgar el acceso.",
    });
  }
}
