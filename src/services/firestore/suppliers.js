// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/suppliers.js — versión Supabase
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, paramsToSnake, assertNoError } from "./shared";

export async function addSupplier(companyId, supplier) {
  const payload = { ...paramsToSnake(supplier), company_id: companyId, total_orders: 0, total_spent: 0, last_order: "—" };
  const { data, error } = await supabase.from("suppliers").insert(payload).select("id").single();
  assertNoError(error, "addSupplier");
  return data.id;
}

export async function updateSupplier(companyId, supplierId, data) {
  const { error } = await supabase
    .from("suppliers")
    .update(paramsToSnake(data))
    .eq("id", supplierId)
    .eq("company_id", companyId);
  assertNoError(error, "updateSupplier");
}

export async function deleteSupplier(companyId, supplierId) {
  const { error } = await supabase.from("suppliers").delete().eq("id", supplierId).eq("company_id", companyId);
  assertNoError(error, "deleteSupplier");
}
