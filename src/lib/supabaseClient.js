// ─────────────────────────────────────────────────────────────────────────────
// src/lib/supabaseClient.js
// Reemplaza a src/firebase/config.js.
//
// Variables de entorno (.env.local), prefijo VITE_ para que Vite las exponga
// al navegador — igual que antes, estas SON seguras de tener en el cliente
// (la anon key solo puede hacer lo que las políticas RLS le dejen):
//   VITE_SUPABASE_URL       → Project Settings → API → Project URL
//   VITE_SUPABASE_ANON_KEY  → Project Settings → API → anon / public key
//
// La SERVICE ROLE KEY nunca va acá — solo en las funciones serverless de
// /api (ver api/_supabaseAdmin.js), igual que CULQI_SECRET_KEY antes.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
