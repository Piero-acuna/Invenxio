// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/employees.js — versión Supabase
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, rowsToCamel, assertNoError, uniqueChannelName } from "./shared";

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
  const channel = supabase
    .channel(uniqueChannelName(`users:${companyId}`))
    .on("postgres_changes", { event: "*", schema: "public", table: "users", filter: `company_id=eq.${companyId}` }, scheduleFetch)
    .subscribe();

  return () => {
    cancelled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    supabase.removeChannel(channel);
  };
}

export async function updateUserPermissions(uid, permissions) {
  const { error } = await supabase.from("users").update({ permissions }).eq("id", uid);
  assertNoError(error, "updateUserPermissions");
}

export async function setEmployeeActive(uid, active) {
  const { error } = await supabase.from("users").update({ active }).eq("id", uid);
  assertNoError(error, "setEmployeeActive");
}
