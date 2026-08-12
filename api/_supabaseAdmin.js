// ─────────────────────────────────────────────────────────────────────────────
// api/_supabaseAdmin.js
// Cliente de Supabase con la SERVICE ROLE KEY — el equivalente exacto del
// Admin SDK de Firebase (admin.initializeApp con cuenta de servicio):
// bypasea RLS por completo, así que SOLO se usa en funciones serverless
// (Vercel), nunca en código que corra en el navegador.
//
// VARIABLES DE ENTORNO QUE NECESITA (Vercel → Settings → Environment
// Variables — nunca en un archivo del repo):
//   SUPABASE_URL              → Project Settings → API → Project URL
//                                (mismo valor que VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY → Project Settings → API → service_role key
//                                (⚠️ secreta — jamás con prefijo VITE_)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

let cached;

export function supabaseAdmin() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.");
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

/**
 * Verifica el token de sesión (JWT) que manda el navegador y devuelve el
 * usuario autenticado — equivalente a admin.auth().verifyIdToken(idToken)
 * de Firebase. Lanza si el token es inválido o falta.
 */
export async function verifyBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    const err = new Error("Falta autenticación.");
    err.status = 401;
    throw err;
  }
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error("Token inválido o expirado.");
    err.status = 401;
    throw err;
  }
  return data.user; // { id, email, ... }
}
