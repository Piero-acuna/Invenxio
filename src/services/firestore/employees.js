// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/employees.js — versión Supabase
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, rowsToCamel, assertNoError } from "./shared";

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
  const channel = supabase
    .channel(`users:${companyId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "users", filter: `company_id=eq.${companyId}` }, fetchAll)
    .subscribe();

  return () => {
    cancelled = true;
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
