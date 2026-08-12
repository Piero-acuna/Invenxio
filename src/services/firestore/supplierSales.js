// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/supplierSales.js — versión Supabase
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, assertNoError, paramsToSnake } from "./shared";

export async function sellWarehouseToSupplier(companyId, {
  warehouseProductId, warehouseProductName, sku, description,
  locationId, locationName,
  packCount, packName, packQty,
  unitPricePerPack, supplierName,
  note, userName, status = "Entregado",
}) {
  const { data, error } = await supabase.rpc("sell_warehouse_to_supplier", {
    p_company: companyId,
    p_warehouse_product_id: warehouseProductId,
    p_warehouse_product_name: warehouseProductName,
    p_sku: sku,
    p_description: description || "",
    p_location_id: locationId,
    p_location_name: locationName,
    p_pack_count: packCount,
    p_pack_name: packName,
    p_pack_qty: packQty,
    p_unit_price_per_pack: unitPricePerPack,
    p_supplier_name: supplierName,
    p_note: note || "",
    p_user_name: userName,
    p_status: status,
  });
  assertNoError(error, "sellWarehouseToSupplier");
  return data; // id de la venta
}

export async function updateSupplierSaleStatus(companyId, saleId, status) {
  const { error } = await supabase
    .from("supplier_sales")
    .update({ status })
    .eq("id", saleId)
    .eq("company_id", companyId);
  assertNoError(error, "updateSupplierSaleStatus");
}

export async function cancelSupplierSale(companyId, sale, userName) {
  const { error } = await supabase.rpc("cancel_supplier_sale", {
    p_company: companyId,
    p_sale_id: sale.id,
    p_user_name: userName,
  });
  assertNoError(error, "cancelSupplierSale");
}

/**
 * Alta directa de una venta a proveedor sin tocar almacén (no se usa desde
 * la UI actual — sellWarehouseToSupplier es el flujo real — se deja por
 * paridad con la función original addSupplierSale de Firestore).
 */
export async function addSupplierSale(companyId, sale) {
  const payload = { ...paramsToSnake(sale), company_id: companyId };
  const { data, error } = await supabase.from("supplier_sales").insert(payload).select("id").single();
  assertNoError(error, "addSupplierSale");
  return data.id;
}
