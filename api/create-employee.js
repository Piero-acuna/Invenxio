// ─────────────────────────────────────────────────────────────────────────────
// api/create-employee.js  —  NUEVO endpoint, no existía en la versión Firebase
// POST /api/create-employee
//
// Reemplaza al truco de "app secundaria de Firebase" que registerEmployee()
// usaba en AuthContext.jsx. Supabase Auth no permite crear la cuenta de OTRO
// usuario desde el navegador — solo con la service_role key, que por
// definición solo puede vivir en el servidor. Este endpoint:
//
//   1. Verifica el JWT del que llama (debe ser el Dueño de una empresa).
//   2. Crea la cuenta de Auth del empleado (Admin API, con confirmación de
//      email automática — igual de conveniente que createUserWithEmailAndPassword
//      de Firebase, que tampoco pedía confirmar correo).
//   3. Inserta su perfil en public.users con permisos por defecto (mismo
//      candado que la regla de Firestore original: el alta SIEMPRE crea con
//      defaultPermissions(), nunca con los permisos elegidos directamente).
//   4. Aplica los permisos REALES elegidos en el formulario, con el
//      service_role (bypasea RLS igual que antes lo hacía el Dueño
//      autenticado con updateUserPermissions).
//
// Si el paso 3 o 4 falla después de creada la cuenta de Auth, se hace
// rollback borrando esa cuenta — para no dejar "usuarios fantasma" sin
// perfil, el mismo tipo de estado inconsistente que el comentario original
// de firestore.rules ya advertía que podía pasar por condiciones de carrera.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin, verifyBearerToken } from "./_supabaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido." });
  }

  try {
    const caller = await verifyBearerToken(req);
    const admin = supabaseAdmin();

    const { email, password, name, permissions, companyId } = req.body || {};
    if (!email || !password || !name || !companyId) {
      return res.status(400).json({ ok: false, error: "Faltan datos (email, password, name, companyId)." });
    }

    // El que llama debe ser el Dueño ACTIVO de esa misma empresa.
    const { data: callerProfile, error: profileErr } = await admin
      .from("users")
      .select("role, company_id, active")
      .eq("id", caller.id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!callerProfile || !callerProfile.active || callerProfile.role !== "owner" || callerProfile.company_id !== companyId) {
      return res.status(403).json({ ok: false, error: "Solo el Dueño de la empresa puede registrar empleados." });
    }

    // ── Bloqueo estricto de capa 2 (servidor) ──────────────────────────────
    // Este endpoint corre con la service_role key, que bypasea RLS por
    // completo — ninguna policy de 0002_rls.sql se evalúa acá. Por eso el
    // estado de la suscripción se valida A MANO, igual que el rol del que
    // llama, ANTES de crear cualquier cuenta de Auth o fila en public.users.
    // No importa si quien llama es el Dueño: si la empresa no tiene una
    // suscripción activa (ni trial vigente ni plan pagado vigente), se
    // rechaza con 403 sin excepciones — el frontend puede fallar o mostrar
    // un botón que no debería existir, pero el servidor es la autoridad
    // final de este control.
    const { data: subscription, error: subErr } = await admin
      .from("subscriptions")
      .select("status, trial_ends_at, paid_until")
      .eq("company_id", companyId)
      .maybeSingle();
    if (subErr) throw subErr;

    const now = Date.now();
    const trialActive = subscription?.status === "trial" && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > now;
    const planActive = subscription?.status === "active" && subscription.paid_until && new Date(subscription.paid_until).getTime() > now;
    if (!trialActive && !planActive) {
      return res.status(403).json({ ok: false, error: "No puedes registrar empleados hasta renovar tu suscripción." });
    }

    // 1. Cuenta de Auth del empleado.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no exigimos verificación de correo, como en Firebase
      user_metadata: { name },
    });
    if (createErr) {
      return res.status(400).json({ ok: false, error: createErr.message || "No se pudo crear la cuenta." });
    }
    const uid = created.user.id;

    try {
      // 2. Perfil con permisos por defecto.
      const { error: insertErr } = await admin.from("users").insert({
        id: uid,
        company_id: companyId,
        name,
        email,
        role: "empleado",
        active: true,
        permissions: {
          ver_inventario: true, crear_productos: false, editar_productos: false,
          registrar_ventas: true, registrar_compras: false,
          ver_almacen: false, gestionar_almacen: false,
          ver_proveedores: false, gestionar_proveedores: false,
          ver_metricas_financieras: false, eliminar_registros: false,
        },
      });
      if (insertErr) throw insertErr;

      // 3. Permisos reales elegidos en el formulario.
      if (permissions && Object.keys(permissions).length) {
        const { error: updateErr } = await admin.from("users").update({ permissions }).eq("id", uid);
        if (updateErr) throw updateErr;
      }
    } catch (innerErr) {
      // Rollback: no dejar una cuenta de Auth sin perfil.
      await admin.auth.admin.deleteUser(uid).catch(() => {});
      throw innerErr;
    }

    return res.status(200).json({ ok: true, uid });
  } catch (err) {
    const status = err.status || 500;
    console.error("create-employee error:", err);
    return res.status(status).json({ ok: false, error: err.message || "Error interno al registrar al empleado." });
  }
}
