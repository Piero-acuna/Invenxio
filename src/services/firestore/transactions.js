// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/transactions.js — versión Supabase
//
// Las 3 operaciones acá abajo eran runTransaction() en Firestore; ahora son
// llamadas a funciones RPC de Postgres (SECURITY DEFINER + row locks), que
// dan la misma garantía de atomicidad — ver supabase/migrations/0003_functions.sql.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, assertNoError } from "./shared";
import { getLocalDateTimeParams } from "../../utils/localDateTime";

export async function recordPurchase(companyId, {
  supplierId, supplierName, productId, productName, sku, description,
  qty, unitCost, total, note, userName,
  packMode = false, packQty = 0, packName = "", baseUnitName = "",
}) {
  const { clientDate } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("record_purchase", {
    p_company: companyId,
    p_supplier_id: supplierId || null,
    p_supplier_name: supplierName,
    p_product_id: productId,
    p_product_name: productName,
    p_sku: sku,
    p_description: description || "",
    p_qty: qty,
    p_unit_cost: unitCost,
    p_total: total,
    p_note: note || "",
    p_user_name: userName,
    p_pack_mode: packMode,
    p_pack_qty: packQty,
    p_pack_name: packName,
    p_base_unit_name: baseUnitName,
    p_client_date: clientDate,
  });
  assertNoError(error, "recordPurchase");
  return data; // id de la transacción
}

export async function recordWarehousePurchase(companyId, {
  supplierId, supplierName,
  warehouseProductId, warehouseProductName, sku, description,
  locationId, locationName,
  packCount, packName, packQty,
  unitCost, note, userName,
}) {
  const { clientDate, clientTime } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("record_warehouse_purchase", {
    p_company: companyId,
    p_supplier_id: supplierId || null,
    p_supplier_name: supplierName,
    p_warehouse_product_id: warehouseProductId,
    p_warehouse_product_name: warehouseProductName,
    p_sku: sku,
    p_description: description || "",
    p_location_id: locationId,
    p_location_name: locationName,
    p_pack_count: packCount,
    p_pack_name: packName,
    p_pack_qty: packQty,
    p_unit_cost: unitCost,
    p_note: note || "",
    p_user_name: userName,
    p_client_date: clientDate,
    p_client_time: clientTime,
  });
  assertNoError(error, "recordWarehousePurchase");
  return data; // total
}

/**
 * Resumen agregado (ventas/compras de hoy, últimos movimientos, ranking de
 * productos) calculado EN la base de datos — ver
 * 0014_dashboard_summary_and_indexes.sql y useDashboardTransactionsSummary().
 * Reemplaza, solo para el Dashboard, la descarga de la tabla `transactions`
 * completa que antes hacía falta para lo mismo.
 */
export async function getDashboardTransactionsSummary(companyId) {
  const { clientDate } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("dashboard_transactions_summary", {
    p_company: companyId,
    p_client_date: clientDate,
  });
  assertNoError(error, "getDashboardTransactionsSummary");
  return data; // { salesToday, purchasesToday, recent, topProductsAgg }
}

/**
 * Venta completa (carrito) como una sola llamada RPC atómica. El precio de
 * cada ítem lo recalcula el servidor a partir del producto real — nunca
 * confía en item.price del carrito (ver comentario en record_sale() SQL).
 */
export async function recordSale(companyId, { cartItems, userName, clientName = "Cliente", paymentMethod = "Efectivo" }) {
  const cart = cartItems.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    qty: item.qty,
    packMode: item.packMode || false,
    packQty: item.packQty || 0,
    packName: item.packName || "",
    baseUnitName: item.baseUnitName || "",
  }));

  const { clientDate } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("record_sale", {
    p_company: companyId,
    p_cart: cart,
    p_user_name: userName,
    p_client_name: clientName || "Cliente",
    p_payment_method: paymentMethod || "Efectivo",
    p_client_date: clientDate,
  });
  assertNoError(error, "recordSale");
  return data; // array de ids de transacción creadas
}
