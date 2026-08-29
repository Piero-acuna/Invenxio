// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/presentations.js
//
// CRUD de product_presentations (Caso 1/2/3 del esquema de kits/granel — ver
// 0019_kits_bulk_presentations.sql). No tiene su propia función de
// suscripción: se lee con el mismo subscribeToCollection() genérico que ya
// usan products/suppliers/etc. — ver useCollection(companyId,
// "productPresentations") en InventorySystem.jsx. Mantiene el mismo patrón
// que products.js (filtro explícito .eq("company_id", ...) en update/delete,
// además de RLS — ver el comentario de esa decisión en employees.js).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, paramsToSnake, assertNoError } from "./shared";

export async function addPresentation(companyId, productId, data) {
  const payload = { ...paramsToSnake(data), company_id: companyId, product_id: productId };
  const { data: row, error } = await supabase.from("product_presentations").insert(payload).select("id").single();
  assertNoError(error, "addPresentation");
  return row.id;
}

export async function updatePresentation(companyId, presentationId, data) {
  const { error } = await supabase
    .from("product_presentations")
    .update(paramsToSnake(data))
    .eq("id", presentationId)
    .eq("company_id", companyId);
  assertNoError(error, "updatePresentation");
}

export async function deletePresentation(companyId, presentationId) {
  const { error } = await supabase.from("product_presentations").delete().eq("id", presentationId).eq("company_id", companyId);
  assertNoError(error, "deletePresentation");
}
