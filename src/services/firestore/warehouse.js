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
import { getLocalDateTimeParams } from "../../utils/localDateTime";

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

/**
 * Borra un producto de almacén Y su stock en todas las ubicaciones, en un
 * solo paso atómico — ver 0017_delete_warehouse_product_rpc.sql. Antes esto
 * era un DELETE directo del cliente solo contra `warehouse_products`, que
 * dejaba filas huérfanas en `warehouse_stock` (esa tabla exige el permiso
 * 'eliminar_registros' para borrarse, distinto al 'gestionar_almacen' que
 * ya alcanza para ver/editar el resto de "Mis Productos").
 */
export async function deleteWarehouseProduct(companyId, productId) {
  const { error } = await supabase.rpc("delete_warehouse_product", {
    p_company: companyId,
    p_product_id: productId,
  });
  assertNoError(error, "deleteWarehouseProduct");
}

/**
 * Igual que cleanupZeroStockProductDuplicates() pero para productos de
 * almacén (ver 0012_cleanup_zero_stock_duplicates.sql) — el stock de un
 * producto de almacén es la suma de warehouse_stock en todas sus
 * ubicaciones, así que esta limpieza vive en su propia función de Postgres.
 */
export async function cleanupZeroStockWarehouseDuplicates(companyId, baseName) {
  const { data, error } = await supabase.rpc("cleanup_zero_stock_warehouse_products", {
    p_company: companyId,
    p_base_name: baseName,
  });
  assertNoError(error, "cleanupZeroStockWarehouseDuplicates");
  return data || 0;
}

/** Registra un movimiento y ajusta stock — todo en una sola RPC atómica. */
export async function addWarehouseMovement(companyId, {
  type, productId, productName, sku, qty,
  fromLocationId, fromLocationName,
  toLocationId, toLocationName,
  reason, userName,
  packName, packQty, packPrice,
}) {
  const { clientDate, clientTime } = getLocalDateTimeParams();
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
    p_client_date: clientDate,
    p_client_time: clientTime,
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
  const { clientDate, clientTime } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("send_warehouse_to_inventory", {
    p_company: companyId,
    p_warehouse_product_id: warehouseProductId,
    p_warehouse_product_name: warehouseProductName,
    p_sku: sku,
    p_location_id: locationId,
    p_location_name: locationName,
    p_pack_count: packCount,
    p_pack_name: packName,
    // p_unit_qty ya no se usa server-side (se recalcula ahí con el pack_qty
    // real del producto — ver 0013_fix_dates_and_server_side_totals.sql) —
    // se sigue mandando solo para no romper la firma de la RPC.
    p_unit_qty: unitQty,
    p_store_product_id: storeProductId,
    p_store_product_name: storeProductName,
    p_reason: reason || "",
    p_user_name: userName,
    p_client_date: clientDate,
    p_client_time: clientTime,
  });
  assertNoError(error, "sendWarehouseToInventory");
  return data; // id del movimiento
}
