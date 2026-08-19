// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/products.js — versión Supabase
// El ajuste de stock (adjustProductStock) ahora es una función RPC atómica
// (ver supabase/migrations/0003_functions.sql) en vez de un runTransaction.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, paramsToSnake, assertNoError, rowsToCamel, uniqueChannelName } from "./shared";

export async function addProduct(companyId, product) {
  const payload = { ...paramsToSnake(product), company_id: companyId };
  const { data, error } = await supabase.from("products").insert(payload).select("id").single();
  assertNoError(error, "addProduct");
  return data.id;
}

export async function updateProduct(companyId, productId, data) {
  const { error } = await supabase
    .from("products")
    .update(paramsToSnake(data))
    .eq("id", productId)
    .eq("company_id", companyId);
  assertNoError(error, "updateProduct");
}

export async function deleteProduct(companyId, productId) {
  const { error } = await supabase.from("products").delete().eq("id", productId).eq("company_id", companyId);
  assertNoError(error, "deleteProduct");
}

/**
 * Suscripción al historial de UN producto (equivalente a la subcolección
 * history/ de Firestore, ahora filtrada por product_id).
 */
export function subscribeToProductHistory(companyId, productId, onData, maxEntries = 50) {
  let cancelled = false;

  async function fetchAll() {
    const { data, error } = await supabase
      .from("product_history")
      .select("*")
      .eq("company_id", companyId)
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(maxEntries);
    if (error) {
      console.error("[supabase] subscribeToProductHistory:", error);
      return;
    }
    if (!cancelled) onData(rowsToCamel(data));
  }

  fetchAll();
  const channel = supabase
    .channel(uniqueChannelName(`product_history:${productId}`))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "product_history", filter: `product_id=eq.${productId}` },
      fetchAll
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

/**
 * Borra permanentemente las variantes de `baseName` (producto duplicado por
 * un costo de compra distinto — ver utils/productDuplicates.js) que se
 * quedaron en 0 stock, siempre que alguna otra variante hermana siga
 * teniendo stock. RPC con SECURITY DEFINER (ver
 * 0012_cleanup_zero_stock_duplicates.sql) porque quien registra la compra
 * no necesariamente tiene el permiso 'eliminar_registros' que exige el
 * borrado manual normal. Devuelve cuántos productos se borraron.
 */
export async function cleanupZeroStockProductDuplicates(companyId, baseName) {
  const { data, error } = await supabase.rpc("cleanup_zero_stock_products", {
    p_company: companyId,
    p_base_name: baseName,
  });
  assertNoError(error, "cleanupZeroStockProductDuplicates");
  return data || 0;
}

/** Ajuste manual de stock — RPC atómica con row-lock (ver 0003_functions.sql). */
export async function adjustProductStock(companyId, productId, { type, qty, user }) {
  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_company: companyId,
    p_product_id: productId,
    p_type: type,
    p_qty: qty,
    p_user_name: user,
  });
  assertNoError(error, "adjustProductStock");
  return data; // nuevo stock
}
