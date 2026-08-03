// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/supplierSales.js
//
// Ventas del ALMACÉN a un proveedor (companies/{id}/supplierSales/{id}) — el
// producto sale definitivamente del negocio, a diferencia de sendWarehouseToInventory
// (warehouse.js) que lo mueve internamente a la tienda. Incluye la cancelación,
// que devuelve el stock al almacén.
// ─────────────────────────────────────────────────────────────────────────────
import { addDoc, updateDoc, serverTimestamp, colRef, docRef } from "./shared";
import { addWarehouseMovement } from "./warehouse";

export async function addSupplierSale(companyId, sale) {
  return addDoc(colRef(companyId, "supplierSales"), {
    ...sale,
    date:      new Date().toISOString().split("T")[0],
    createdAt: serverTimestamp(),
  });
}

/**
 * Vende productos del ALMACÉN a un proveedor: descuenta el stock del almacén
 * (en empaques, como una "salida" — queda en el Historial del almacén) y
 * registra la venta en "supplierSales". No suma a ningún inventario, el
 * producto sale definitivamente del negocio.
 */
export async function sellWarehouseToSupplier(companyId, {
  warehouseProductId, warehouseProductName, sku, description,
  locationId, locationName,
  packCount, packName, packQty,
  unitPricePerPack, supplierName,
  note, userName, status = "Entregado",
}) {
  const total = packCount * unitPricePerPack;

  // 1. Salida de almacén — descuenta stock y queda registrada en el Historial.
  await addWarehouseMovement(companyId, {
    type: "salida",
    productId: warehouseProductId, productName: warehouseProductName, sku,
    qty: packCount,
    fromLocationId: locationId, fromLocationName: locationName,
    reason: `Venta a proveedor: ${supplierName}`,
    userName,
    packName, packQty,
  });

  // 2. Registro de la venta al proveedor. Guardamos también el producto, su
  //    descripción (para el comprobante) y la ubicación de origen en el
  //    almacén — así, si la venta se cancela más adelante, sabemos
  //    exactamente a dónde devolver el stock.
  return addSupplierSale(companyId, {
    supplier: supplierName,
    product: warehouseProductName,
    description: description || "",
    sku: sku || "",
    qty: packCount, packName: packName || null, packQty: packQty || null,
    unitPrice: unitPricePerPack, total,
    status,
    note: note || "",
    warehouseProductId, locationId, locationName,
  });
}

export async function updateSupplierSaleStatus(companyId, saleId, status) {
  return updateDoc(docRef(companyId, "supplierSales", saleId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cancela una venta a proveedor y DEVUELVE el stock al almacén (a la misma
 * ubicación de la que salió), dejando registrada la devolución como una
 * "entrada" en el Historial del almacén.
 */
export async function cancelSupplierSale(companyId, sale, userName) {
  if (sale.status === "Cancelado") return; // ya estaba cancelada, no duplicar la devolución

  if (sale.warehouseProductId && sale.locationId) {
    await addWarehouseMovement(companyId, {
      type: "entrada",
      productId: sale.warehouseProductId, productName: sale.product, sku: sale.sku || "",
      qty: sale.qty,
      toLocationId: sale.locationId, toLocationName: sale.locationName || "",
      reason: `Devolución por venta cancelada (${sale.supplier})`,
      userName,
      packName: sale.packName, packQty: sale.packQty,
    });
  }

  return updateDoc(docRef(companyId, "supplierSales", sale.id), {
    status: "Cancelado",
    updatedAt: serverTimestamp(),
  });
}
