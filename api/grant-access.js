// ─────────────────────────────────────────────────────────────────────────────
// api/grant-access.js
// Endpoint administrativo para conceder días de cortesía a una empresa.
// ─────────────────────────────────────────────────────────────────────────────

import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  // 1. Validar secreto administrativo
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

  if (providedSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado.",
    });
  }

  try {
    // 2. Verificar variables de Firebase
    const requiredVariables = [
      "FIREBASE_PROJECT_ID",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
    ];

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

    // 3. Preparar clave privada
    let privateKey = process.env.FIREBASE_PRIVATE_KEY.trim();

    // Eliminar comillas que pudieron copiarse desde el JSON
    if (
      (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
      privateKey = privateKey.slice(1, -1);
    }

    // Convertir los caracteres literales \n en saltos de línea reales
    privateKey = privateKey
      .replace(/\\n/g, "\n")
      .trim();

    if (
      !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
      !privateKey.includes("-----END PRIVATE KEY-----")
    ) {
      return res.status(500).json({
        ok: false,
        error:
          "FIREBASE_PRIVATE_KEY no tiene el formato PEM correcto. " +
          "Debe contener BEGIN PRIVATE KEY y END PRIVATE KEY.",
      });
    }

    // 4. Inicializar Firebase Admin una sola vez
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID.trim(),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
          privateKey,
        }),
      });
    }

    // 5. Leer y validar body
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
      typeof body?.companyId === "string"
        ? body.companyId.trim()
        : "";

    const dias = Number(body?.dias);

    if (!companyId) {
      return res.status(400).json({
        ok: false,
        error: "companyId es obligatorio.",
      });
    }

    if (companyId.includes("/")) {
      return res.status(400).json({
        ok: false,
        error: "companyId contiene caracteres no permitidos.",
      });
    }

    if (!Number.isInteger(dias) || dias <= 0) {
      return res.status(400).json({
        ok: false,
        error: "dias debe ser un número entero positivo.",
      });
    }

    // 6. Buscar suscripción
    const db = getFirestore();

    const subscriptionPath =
      `companies/${companyId}/meta/subscription`;

    const subscriptionRef = db.doc(subscriptionPath);
    const subscriptionSnapshot = await subscriptionRef.get();

    if (!subscriptionSnapshot.exists) {
      return res.status(404).json({
        ok: false,
        error: `No existe ${subscriptionPath}.`,
      });
    }

    // 7. Calcular nueva fecha
    const paidUntil = new Date(
      Date.now() + dias * 24 * 60 * 60 * 1000
    );

    // 8. Actualizar Firestore
    await subscriptionRef.set(
      {
        status: "active",
        plan: "cortesia",
        paidUntil: paidUntil.toISOString(),
        grantedManuallyAt: FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );

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