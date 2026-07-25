// ─────────────────────────────────────────────────────────────────────────────
// api/grant-access.js
// Endpoint de Vercel para dar acceso de cortesía (sin cobrar) a una empresa,
// protegido con una clave secreta tuya — no la de Firebase Auth del usuario,
// porque esto es una herramienta TUYA de administrador, no algo que el
// Dueño de una empresa deba poder llamar por sí mismo.
//
// Copia este archivo a la carpeta /api de tu proyecto (junto a
// culqi-charge.js) → Vercel lo publica solo como POST /api/grant-access.
//
// VARIABLE DE ENTORNO NUEVA QUE NECESITAS (Vercel → Settings → Environment
// Variables, igual que las de Firebase/Culqi):
//   ADMIN_SECRET  → invéntate una clave larga y random, ej. genera una con
//                   `openssl rand -hex 32` en tu terminal. NUNCA la pongas
//                   en el código ni la compartas — es lo único que protege
//                   este endpoint.
//
// Reutiliza las mismas 3 variables de Firebase Admin que ya tienes para
// culqi-charge.js: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY.
//
// CÓMO LLAMARLO (desde tu terminal, nunca desde el navegador del cliente ni
// desde ningún botón de la app — este endpoint no debe tener UI):
//
//   curl -X POST https://tu-dominio.vercel.app/api/grant-access \
//     -H "Authorization: Bearer TU_ADMIN_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"companyId": "abc123", "dias": 30}'
//
// Respuesta: { ok: true, paidUntil: "2026-08-25T..." }
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  // 1. Verificar la clave secreta ANTES de tocar cualquier otra cosa. Si
  //    ADMIN_SECRET no está configurada en Vercel, bloqueamos por defecto
  //    en vez de dejar el endpoint abierto por accidente.
  const authHeader = req.headers.authorization || "";
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!process.env.ADMIN_SECRET || providedSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ ok: false, error: "No autorizado." });
  }

  try {
    // La inicialización vive ACÁ ADENTRO (y no arriba, a nivel de módulo)
    // a propósito: si falta o está mal alguna variable de entorno de
    // Firebase, admin.credential.cert() truena — y si eso pasa fuera de
    // este try/catch, Vercel lo muestra como un FUNCTION_INVOCATION_FAILED
    // genérico, sin decirte el motivo real. Aquí adentro, en cambio, el
    // catch de más abajo atrapa el error y te lo devuelve legible.
    if (!admin.apps.length) {
      const missing = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]
        .filter((k) => !process.env[k]);
      if (missing.length) {
        return res.status(500).json({
          ok: false,
          error: `Faltan variables de entorno en Vercel: ${missing.join(", ")}`,
        });
      }
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

      // Chequeo de formato: si FIREBASE_PRIVATE_KEY se pegó mal en Vercel
      // (sin las cabeceras PEM, con \n a medio convertir, etc.), es mejor
      // avisar esto claramente en vez de dejar que google-auth-library
      // truene más adelante con un "Cannot read properties of undefined
      // (reading 'length')" que no dice nada útil.
      if (!privateKey.includes("BEGIN PRIVATE KEY")) {
        return res.status(500).json({
          ok: false,
          error:
            "FIREBASE_PRIVATE_KEY no tiene el formato PEM esperado (falta '-----BEGIN PRIVATE KEY-----'). " +
            "Vuelve a copiar el valor completo del JSON de la cuenta de servicio, con comillas incluidas.",
        });
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
    }

    const { companyId, dias } = req.body || {};

    if (!companyId || !Number.isFinite(dias) || dias <= 0) {
      return res.status(400).json({ ok: false, error: "Faltan companyId o dias (numero positivo)." });
    }

    const subRef = admin.firestore().doc(`companies/${companyId}/meta/subscription`);
    const snap = await subRef.get();

    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: `No existe companies/${companyId}/meta/subscription.` });
    }

    const paidUntil = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    await subRef.set(
      {
        status: "active",
        plan: "cortesia",
        paidUntil: paidUntil.toISOString(),
        grantedManuallyAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, paidUntil: paidUntil.toISOString() });
  } catch (err) {
    console.error("grant-access error:", err);
    // Este endpoint solo lo usas tú (protegido por ADMIN_SECRET), así que sí
    // es seguro devolver err.message aquí — a diferencia de culqi-charge.js,
    // que da un mensaje genérico porque lo llama cualquier cliente final.
    return res.status(500).json({ ok: false, error: err.message || "Error interno al otorgar el acceso." });
  }
}