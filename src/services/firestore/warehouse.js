// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/warehouse.js — versión Supabase
// adjustWarehouseStock / addWarehouseMovement / sendWarehouseToInventory ahora
// son RPC atómicas (ver 0003_functions.sql) en vez de runTransaction +
// Promise.all — de hecho, más atómicas que el original: antes
// addWarehouseMovement hacía el ajuste de stock y el insert del movimiento
// como dos pasos sueltos (Promise.all no es una transacción); acá ambos
// pasos ocurren dentro de la MISMA transacción de Postgres.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, paramsToSnake, assertNoError, subscribeToCollection } from "./shared";

export function subscribeToLocations(companyId, onData) {
  return subscribeToCollection(companyId, "warehouse_locations", onData, "name");
}

export async function addLocation(companyId, data) {
  const payload = { ...paramsToSnake(data), company_id: companyId };
  const { data: row, error } = await supabase.from("warehouse_locations").insert(payload).select("id").single();
  assertNoError(error, "addLocation");
  return row.id;
}

export async function updateLocation(companyId, locationId, data) {
  const { error } = await supabase
    .from("warehouse_locations")
    .update(paramsToSnake(data))
    .eq("id", locationId)
    .eq("company_id", companyId);
  assertNoError(error, "updateLocation");
}

export async function deleteLocation(companyId, locationId) {
  const { error } = await supabase.from("warehouse_locations").delete().eq("id", locationId).eq("company_id", companyId);
  assertNoError(error, "deleteLocation");
}

export function subscribeToWarehouseStock(companyId, onData) {
  return subscribeToCollection(companyId, "warehouse_stock", onData, "updatedAt");
}

/** Ajuste directo de stock de almacén — RPC atómica con row-lock. */
export async function adjustWarehouseStock(companyId, { productId, productName, sku, locationId, locationName, delta }) {
  const { data, error } = await supabase.rpc("adjust_warehouse_stock", {
    p_company: companyId,
    p_product_id: productId,
    p_product_name: productName,
    p_sku: sku,
    p_location_id: locationId,
    p_location_name: locationName,
    p_delta: delta,
  });
  assertNoError(error, "adjustWarehouseStock");
  return data; // nuevo qty
}

export function subscribeToWarehouseMovements(companyId, onData, limit = 500) {
  // limit=500: es un historial que solo crece — HistorialTab.jsx únicamente
  // filtra/muestra una lista, no calcula ningún total histórico completo,
  // así que traer solo los 500 movimientos más recientes no cambia nada que
  // se vea, y evita descargar años de movimientos en cada carga.
  return subscribeToCollection(companyId, "warehouse_movements", onData, "createdAt", limit);
}

export function subscribeToWarehouseProducts(companyId, onData) {
  return subscribeToCollection(companyId, "warehouse_products", onData, "name");
}

export async function addWarehouseProduct(companyId, data) {
  const payload = { ...paramsToSnake(data), company_id: companyId };
  const { data: row, error } = await supabase.from("warehouse_products").insert(payload).select("id").single();
  assertNoError(error, "addWarehouseProduct");
  return row.id;
}

export async function updateWarehouseProduct(companyId, productId, data) {
  const { error } = await supabase
    .from("warehouse_products")
    .update(paramsToSnake(data))
    .eq("id", productId)
    .eq("company_id", companyId);
  assertNoError(error, "updateWarehouseProduct");
}

export async function deleteWarehouseProduct(companyId, productId) {
  const { error } = await supabase.from("warehouse_products").delete().eq("id", productId).eq("company_id", companyId);
  assertNoError(error, "deleteWarehouseProduct");
}

/** Registra un movimiento y ajusta stock — todo en una sola RPC atómica. */
export async function addWarehouseMovement(companyId, {
  type, productId, productName, sku, qty,
  fromLocationId, fromLocationName,
  toLocationId, toLocationName,
  reason, userName,
  packName, packQty, packPrice,
}) {
  const { data, error } = await supabase.rpc("add_warehouse_movement", {
    p_company: companyId,
    p_type: type,
    p_product_id: productId,
    p_product_name: productName,
    p_sku: sku,
    p_qty: qty,
    p_from_location_id: fromLocationId || null,
    p_from_location_name: fromLocationName || null,
    p_to_location_id: toLocationId || null,
    p_to_location_name: toLocationName || null,
    p_reason: reason || "",
    p_user_name: userName,
    p_pack_name: packName || null,
    p_pack_qty: packQty || null,
    p_pack_price: packPrice || null,
  });
  assertNoError(error, "addWarehouseMovement");
  return data; // id del movimiento
}

export async function sendWarehouseToInventory(companyId, {
  warehouseProductId, warehouseProductName, sku,
  locationId, locationName,
  packCount, packName,
  unitQty,
  storeProductId, storeProductName,
  reason, userName,
}) {
  const { data, error } = await supabase.rpc("send_warehouse_to_inventory", {
    p_company: companyId,
    p_warehouse_product_id: warehouseProductId,
    p_warehouse_product_name: warehouseProductName,
    p_sku: sku,
    p_location_id: locationId,
    p_location_name: locationName,
    p_pack_count: packCount,
    p_pack_name: packName,
    p_unit_qty: unitQty,
    p_store_product_id: storeProductId,
    p_store_product_name: storeProductName,
    p_reason: reason || "",
    p_user_name: userName,
  });
  assertNoError(error, "sendWarehouseToInventory");
  return data; // id del movimiento
}
