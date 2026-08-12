#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/migrate-auth-users.js
//
// Migra las CUENTAS (no los datos — eso lo hace migrate-data.js) de Firebase
// Auth a Supabase Auth, CONSERVANDO la contraseña de cada usuario gracias a
// que Supabase soporta importar el hash scrypt exacto que usa Firebase Auth
// (parámetro password_hash con hash_algorithm: 'firebase-scrypt'). Así nadie
// tiene que resetear su contraseña después de la migración.
//
// Corre esto ANTES de migrate-data.js (los uid deben existir en auth.users
// antes de insertar filas en public.users, por el FK).
//
// CÓMO CONSEGUIR LOS PARÁMETROS SCRYPT DE TU PROYECTO FIREBASE:
//   Firebase Console → Authentication → Users → ⋮ (arriba a la derecha)
//   → "Password hash parameters" — copia base64_signer_key, base64_salt_separator,
//   rounds y mem_cost.
//
// VARIABLES DE ENTORNO:
//   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FB_SCRYPT_SIGNER_KEY, FB_SCRYPT_SALT_SEPARATOR, FB_SCRYPT_ROUNDS, FB_SCRYPT_MEM_COST
// ─────────────────────────────────────────────────────────────────────────────
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function migrateBatch(users) {
  for (const u of users) {
    // Usuarios de Google (sin password hash) se migran distinto: se crean
    // sin contraseña y quedan a la espera de "Continuar con Google" — su
    // primer login en el nuevo sistema los reconoce por email si activas
    // el provider de Google en Supabase (mismo email = misma cuenta).
    const isGoogleOnly = u.providerData?.some((p) => p.providerId === "google.com") && !u.passwordHash;

    const payload = {
      // Truco importante: forzamos el MISMO uid que tenía en Firebase, para
      // que company_id/owner_id/users.id sigan calzando sin tener que
      // reescribir ninguna fila de datos.
      id: u.uid,
      email: u.email,
      email_confirm: true,
      user_metadata: { name: u.displayName || "" },
    };

    if (!isGoogleOnly && u.passwordHash) {
      payload.password_hash = u.passwordHash;
      payload.password_hash_algorithm = "firebase-scrypt";
      payload.password_hash_options = {
        signer_key: process.env.FB_SCRYPT_SIGNER_KEY,
        salt_separator: process.env.FB_SCRYPT_SALT_SEPARATOR,
        rounds: Number(process.env.FB_SCRYPT_ROUNDS),
        mem_cost: Number(process.env.FB_SCRYPT_MEM_COST),
      };
      // Nota: el nombre exacto de estos campos puede variar según la versión
      // del SDK — revisa la guía oficial "Bulk user import" de Supabase
      // (Authentication → Users → Import users) antes de correr esto en
      // producción; el soporte de scrypt-firebase se agrega vía la Admin API
      // de importación masiva (supabase.auth.admin.createUser con
      // password_hash), no siempre con los mismos nombres de parámetro en
      // todas las versiones del SDK.
    }

    const { error } = await supabase.auth.admin.createUser(payload);
    if (error) {
      console.error(`✖ ${u.email}:`, error.message);
    } else {
      console.log(`✔ ${u.email} (${u.uid})`);
    }
  }
}

async function main() {
  let nextPageToken;
  let total = 0;
  do {
    const result = await admin.auth().listUsers(1000, nextPageToken);
    await migrateBatch(result.users);
    total += result.users.length;
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  console.log(`\n✔ ${total} cuentas procesadas.`);
}

main().catch((err) => {
  console.error("✖ Migración de cuentas fallida:", err);
  process.exit(1);
});
