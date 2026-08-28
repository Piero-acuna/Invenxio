// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/employees.js — versión Supabase
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, rowsToCamel, assertNoError, uniqueChannelName, subscribeToChannel } from "./shared";

export function subscribeToEmployees(companyId, onData) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase.from("users").select("*").eq("company_id", companyId);
    if (error) {
      console.error("[supabase] subscribeToEmployees:", error);
      return;
    }
    if (!cancelled) {
      const items = rowsToCamel(data).map((u) => ({ ...u, uid: u.id }));
      onData(items);
    }
  }

  fetchAll();
  let debounceTimer = null;
  const scheduleFetch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchAll, 300);
  };
  function buildChannel() {
    return supabase
      .channel(uniqueChannelName(`users:${companyId}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "users", filter: `company_id=eq.${companyId}` }, scheduleFetch)
      .subscribe();
  }
  // subscribeToChannel se encarga de cerrar el canal al entrar a bfcache
  // (pagehide) y de recrearlo + refrescar los datos al volver (pageshow) —
  // ver el comentario largo en shared.js para el porqué.
  const unsubscribeChannel = subscribeToChannel({ buildChannel, refetch: fetchAll });

  return () => {
    cancelled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribeChannel();
  };
}

export async function updateUserPermissions(companyId, uid, permissions) {
  // Defensa en profundidad: aunque RLS (users_update → is_owner(company_id)
  // de la FILA real) ya impide que un Dueño de la Empresa A toque el perfil
  // de un empleado de la Empresa B, se agrega el mismo filtro explícito que
  // ya usan products.js/suppliers.js/warehouse.js, por consistencia y para
  // que un intento así falle con 0 filas afectadas de forma clara, en vez
  // de depender únicamente de la policy.
  const { error } = await supabase.from("users").update({ permissions }).eq("id", uid).eq("company_id", companyId);
  assertNoError(error, "updateUserPermissions");
}

export async function setEmployeeActive(companyId, uid, active) {
  const { error } = await supabase.from("users").update({ active }).eq("id", uid).eq("company_id", companyId);
  assertNoError(error, "setEmployeeActive");
}
