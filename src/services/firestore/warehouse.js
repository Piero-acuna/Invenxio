// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/warehouse.js
//
// Módulo de Almacén. Cuatro subcolecciones propias:
//   warehouseLocations  → zonas/estantes/pasillos físicos
//   warehouseStock      → qty de cada producto en cada ubicación
//                         ID = `${productId}__${locationId}` para hacer upsert fácil
//   warehouseMovements  → historial de entradas y salidas
//   warehouseProducts   → catálogo PROPIO del almacén (empaques/a granel),
//                         separado a propósito del catálogo de tienda
//                         (products.js) — ver sendWarehouseToInventory más
//                         abajo para la única forma en que se conectan.
// ─────────────────────────────────────────────────────────────────────────────
import {
  doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  runTransaction, serverTimestamp, colRef, docRef, productHistoryCol, db,
} from "./shared";

export function subscribeToLocations(companyId, onData) {
  const q = query(colRef(companyId, "warehouseLocations"), orderBy("name", "asc"));
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function addLocation(companyId, data) {
  return addDoc(colRef(companyId, "warehouseLocations"), { ...data, createdAt: serverTimestamp() });
}

export async function updateLocation(companyId, locationId, data) {
  return updateDoc(docRef(companyId, "warehouseLocations", locationId), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteLocation(companyId, locationId) {
  return deleteDoc(docRef(companyId, "warehouseLocations", locationId));
}

export function subscribeToWarehouseStock(companyId, onData) {
  return onSnapshot(colRef(companyId, "warehouseStock"), snap =>
    onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

/**
 * Ajusta el stock de un producto en una ubicación (delta puede ser positivo
 * o negativo). Si no existe el documento, lo crea en 0 antes de ajustar.
 */
export async function adjustWarehouseStock(companyId, { productId, productName, sku, locationId, locationName, delta }) {
  const stockId  = `${productId}__${locationId}`;
  const stockRef = docRef(companyId, "warehouseStock", stockId);
  return runTransaction(db, async (tx) => {
    const snap    = await tx.get(stockRef);
    const current = snap.exists() ? (snap.data().qty || 0) : 0;
    const next    = Math.max(0, current + delta);
    tx.set(stockRef, { productId, productName, sku, locationId, locationName, qty: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
}

export function subscribeToWarehouseMovements(companyId, onData) {
  const q = query(colRef(companyId, "warehouseMovements"), orderBy("createdAt", "desc"));
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export function subscribeToWarehouseProducts(companyId, onData) {
  const q = query(colRef(companyId, "warehouseProducts"), orderBy("name", "asc"));
  return onSnapshot(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function addWarehouseProduct(companyId, data) {
  return addDoc(colRef(companyId, "warehouseProducts"), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateWarehouseProduct(companyId, productId, data) {
  return updateDoc(docRef(companyId, "warehouseProducts", productId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWarehouseProduct(companyId, productId) {
  return deleteDoc(docRef(companyId, "warehouseProducts", productId));
}

/**
 * Registra un movimiento de almacén (entrada/salida/traslado) y ajusta el
 * stock en la(s) ubicación(es) afectadas en una sola transacción.
 */
export async function addWarehouseMovement(companyId, {
  type, productId, productName, sku, qty,
  fromLocationId, fromLocationName,
  toLocationId,   toLocationName,
  reason, userName,
  packName, packQty, packPrice,
}) {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const time  = now.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  const ops = [];

  if (type === "entrada" || type === "traslado") {
    ops.push(adjustWarehouseStock(companyId, { productId, productName, sku, locationId: toLocationId, locationName: toLocationName, delta: +qty }));
  }
  if (type === "salida" || type === "traslado") {
    ops.push(adjustWarehouseStock(companyId, { productId, productName, sku, locationId: fromLocationId, locationName: fromLocationName, delta: -qty }));
  }

  await Promise.all(ops);
  return addDoc(colRef(companyId, "warehouseMovements"), {
    type, productId, productName, sku, qty,
    fromLocationId: fromLocationId || null,
    fromLocationName: fromLocationName || null,
    toLocationId:   toLocationId   || null,
    toLocationName: toLocationName || null,
    reason: reason || "", userName, date: today, time,
    packName:  packName  || null,
    packQty:   packQty   || null,
    packPrice: packPrice || null,
    createdAt: serverTimestamp(),
  });
}

/**
 * Toma stock de un producto de ALMACÉN en una ubicación (contado en EMPAQUES,
 * ej. cajas) y lo descuenta de ahí; suma al producto de TIENDA elegido
 * manualmente la cantidad equivalente en UNIDADES (packCount × unidades por
 * empaque), porque la tienda vende por unidad, no por caja. Registra un
 * movimiento de almacén (type: "envio_inventario") para dejar rastro y
 * también una entrada en el historial del producto de tienda receptor.
 *
 * No fusiona catálogos: el producto de almacén y el de tienda siguen siendo
 * entidades distintas, solo se transfiere la cantidad indicada.
 */
export async function sendWarehouseToInventory(companyId, {
  warehouseProductId, warehouseProductName, sku,
  locationId, locationName,
  packCount, packName,   // lo que se descuenta del almacén (en empaques/cajas)
  unitQty,                // lo que se suma al stock de la tienda (en unidades)
  storeProductId, storeProductName,
  reason, userName,
}) {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const time  = now.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });

  // 1. Descuenta del almacén EN EMPAQUES (transacción atómica). IMPORTANTE:
  //    quien llama debe validar ANTES que hay empaques suficientes en esa
  //    ubicación, ya que adjustWarehouseStock nunca baja de 0 (así que un
  //    exceso simplemente se recorta en vez de fallar).
  await adjustWarehouseStock(companyId, {
    productId: warehouseProductId, productName: warehouseProductName, sku,
    locationId, locationName, delta: -packCount,
  });

  // 2. Suma al stock del producto de tienda EN UNIDADES (transacción atómica).
  const pRef = docRef(companyId, "products", storeProductId);
  const historyRef = doc(productHistoryCol(companyId, storeProductId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(pRef);
    if (!snap.exists()) throw new Error("El producto de tienda seleccionado ya no existe.");
    const p = snap.data();
    const newStock  = (p.stock || 0) + unitQty;
    const newStatus = newStock === 0 ? "Agotado"
      : newStock <= (p.minStock || 0) ? "Stock Bajo"
      : "En Stock";
    tx.update(pRef, {
      stock:   newStock,
      status:  newStatus,
      updatedAt: serverTimestamp(),
    });
    tx.set(historyRef, {
      date: today, time, action: "Recibido de Almacén", qty: unitQty, user: userName,
      note: `Desde: ${packCount} ${packName || "empaque(s)"} de ${warehouseProductName}`,
      createdAt: serverTimestamp(),
    });
  });

  // 3. Deja registro del movimiento en el historial de almacén.
  return addDoc(colRef(companyId, "warehouseMovements"), {
    type: "envio_inventario",
    productId: warehouseProductId, productName: warehouseProductName, sku,
    qty: packCount, packName: packName || null, unitQty,
    fromLocationId: locationId, fromLocationName: locationName,
    toLocationId: null, toLocationName: null,
    storeProductId, storeProductName,
    reason: reason || "", userName, date: today, time,
    createdAt: serverTimestamp(),
  });
}
