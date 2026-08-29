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

/**
 * Venta v2 — carrito armado con PRESENTACIONES (kits/packs/granel), en vez
 * del carrito "plano" de recordSale(). Cada ítem manda `presentationId` +
 * `mode` ('qty' | 'amount') + `value` — nunca un precio ni una cantidad-
 * base ya calculada: el servidor (record_sale_v2, ver
 * 0019_kits_bulk_presentations.sql) SIEMPRE lee el precio/factor reales de
 * product_presentations dentro de la misma transacción que descuenta
 * stock, exactamente igual que ya hacía recordSale() con products.price.
 *
 * Devuelve { saleId, total, items: [...] } — `items` trae los valores
 * REALES que quedaron guardados (qtyBase, unitPrice, lineTotal ya
 * redondeados server-side), así que el recibo/PDF se arma con ESO, no con
 * la estimación que mostraba el carrito en pantalla.
 */
export async function recordSaleV2(companyId, { cartItems, userName, clientName = "Cliente", paymentMethod = "Efectivo" }) {
  const cart = cartItems.map((item) => ({
    presentation_id: item.presentationId,
    mode: item.mode || "qty",
    value: item.value,
  }));

  const { clientDate } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("record_sale_v2", {
    p_company: companyId,
    p_cart: cart,
    p_user_name: userName,
    p_client_name: clientName || "Cliente",
    p_payment_method: paymentMethod || "Efectivo",
    p_client_date: clientDate,
  });
  assertNoError(error, "recordSaleV2");
  return data; // { saleId, total, items }
}

/** Anula una venta v2 y devuelve el stock — nunca toca los precios ya cobrados (ver cancel_sale() SQL). */
export async function cancelSale(companyId, saleId, userName) {
  const { clientDate } = getLocalDateTimeParams();
  const { error } = await supabase.rpc("cancel_sale", {
    p_company: companyId,
    p_sale_id: saleId,
    p_user_name: userName,
    p_client_date: clientDate,
  });
  assertNoError(error, "cancelSale");
}

/**
 * Ingreso de stock por presentación (Caso 1: "1 caja con 10 packs", Caso 3:
 * "1 Saco de 35kg"). El factor se resuelve SERVIDOR-SIDE desde
 * product_presentations — nunca se manda un pack_qty ya multiplicado.
 */
export async function recordPurchaseByPresentation(companyId, {
  presentationId, qtyPresentation, unitCost, supplierId, supplierName, note, userName,
}) {
  const { clientDate } = getLocalDateTimeParams();
  const { data, error } = await supabase.rpc("record_purchase_by_presentation", {
    p_company: companyId,
    p_presentation_id: presentationId,
    p_qty_presentation: qtyPresentation,
    p_unit_cost: unitCost,
    p_supplier_id: supplierId || null,
    p_supplier_name: supplierName || null,
    p_note: note || "",
    p_user_name: userName,
    p_client_date: clientDate,
  });
  assertNoError(error, "recordPurchaseByPresentation");
  return data; // id de la transacción
}
