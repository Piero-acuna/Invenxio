// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/transactions.js
//
// Registro de COMPRAS y VENTAS (companies/{id}/transactions/{id}) — el log
// inmutable de movimientos de dinero/stock de la tienda. recordWarehousePurchase
// además toca el almacén (ver warehouse.js) porque una compra a proveedor
// puede entrar directo a una ubicación física en vez de al catálogo de tienda.
// ─────────────────────────────────────────────────────────────────────────────
import {
  doc, addDoc, getDoc, updateDoc, serverTimestamp, runTransaction,
  colRef, docRef, productHistoryCol, db,
} from "./shared";
import { addWarehouseMovement } from "./warehouse";

/**
 * Registra una compra:
 *  1. Guarda la transacción
 *  2. Actualiza stock y costo del producto
 *  3. Actualiza métricas del proveedor
 */
export async function recordPurchase(companyId, {
  supplierId, supplierName, productId, productName, sku, description,
  qty, unitCost, total, note, userName,
  // Equivalencias: si la compra fue en empaques
  packMode = false, packQty = 0, packName = "", baseUnitName = "",
}) {
  const today = new Date().toISOString().split("T")[0];
  const pRef  = docRef(companyId, "products", productId);
  const sRef  = supplierId ? docRef(companyId, "suppliers", supplierId) : null;
  // doc() sin 3er argumento genera un ID nuevo para la transacción, igual
  // que hacía addDoc antes — pero necesitamos la ref DE ANTEMANO para poder
  // escribirla dentro de la transacción con tx.set().
  const txRef = doc(colRef(companyId, "transactions"));
  const historyRef = doc(productHistoryCol(companyId, productId));

  // runTransaction agrupa las 3 escrituras (transacción, producto,
  // proveedor) en una sola operación atómica: o se aplican las tres o
  // ninguna, y el stock leído siempre es el más reciente en el servidor
  // en el momento del commit (Firestore reintenta solo si otro cliente
  // escribió el mismo documento entre medio).
  return runTransaction(db, async (tx) => {
    // 1. TODAS las lecturas primero (regla de runTransaction en Firestore).
    const pSnap = await tx.get(pRef);
    const sSnap = sRef ? await tx.get(sRef) : null;

    // 2. Transacción — guarda tanto la qty base como la info del empaque
    tx.set(txRef, {
      type: "compra", date: today,
      product: productName, sku, description: description || "",
      qty,          // siempre en unidades base
      unitCost, total,
      supplier: supplierName,
      note: note || "",
      createdBy: userName,
      // Info de empaque (si aplica)
      packMode,
      packQty:      packMode ? packQty   : 0,
      packName:     packMode ? packName  : "",
      baseUnitName: packMode ? baseUnitName : "",
      createdAt: serverTimestamp(),
    });

    // 3. Producto
    if (pSnap.exists()) {
      const p        = pSnap.data();
      const newStock = p.stock + qty;
      const newStatus = newStock === 0 ? "Agotado"
        : newStock <= p.minStock ? "Stock Bajo"
        : "En Stock";
      tx.update(pRef, {
        stock:   newStock,
        cost:    unitCost,
        status:  newStatus,
        updatedAt: serverTimestamp(),
      });
      tx.set(historyRef, { date: today, action: "Compra", qty, user: userName, createdAt: serverTimestamp() });
    }

    // 4. Proveedor
    if (sRef && sSnap?.exists()) {
      const s = sSnap.data();
      tx.update(sRef, {
        totalOrders: (s.totalOrders || 0) + 1,
        totalSpent:  (s.totalSpent  || 0) + total,
        lastOrder:   today,
        updatedAt:   serverTimestamp(),
      });
    }
  });
}

/**
 * Registra una COMPRA A PROVEEDOR con destino al ALMACÉN (en empaques):
 *  1. Guarda la transacción (con costo, cantidad de empaques y proveedor)
 *  2. Aumenta el stock del producto de almacén en la ubicación elegida
 *  3. Actualiza métricas del proveedor (para las stats de "Órdenes")
 */
export async function recordWarehousePurchase(companyId, {
  supplierId, supplierName,
  warehouseProductId, warehouseProductName, sku, description,
  locationId, locationName,
  packCount, packName, packQty,
  unitCost, note, userName,
}) {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const time  = now.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  const total = packCount * unitCost;

  // 1. Transacción — queda en el historial general de compras (con costo).
  await addDoc(colRef(companyId, "transactions"), {
    type: "compra", target: "almacen", date: today, time,
    product: warehouseProductName, sku, description: description || "",
    qty: packCount, packName: packName || null, packQty: packQty || null,
    unitCost, total,
    supplier: supplierName,
    locationId, locationName,
    note: note || "",
    createdBy: userName,
    createdAt: serverTimestamp(),
  });

  // 2. Entra al almacén — aumenta stock (en empaques) en esa ubicación y
  //    queda también en el Historial del almacén.
  await addWarehouseMovement(companyId, {
    type: "entrada",
    productId: warehouseProductId, productName: warehouseProductName, sku,
    qty: packCount,
    toLocationId: locationId, toLocationName: locationName,
    reason: `Compra a proveedor: ${supplierName}`,
    userName,
    packName, packQty,
  });

  // 3. Proveedor — mismas métricas que las compras normales.
  if (supplierId) {
    const sRef  = docRef(companyId, "suppliers", supplierId);
    const sSnap = await getDoc(sRef);
    if (sSnap.exists()) {
      const s = sSnap.data();
      await updateDoc(sRef, {
        totalOrders: (s.totalOrders || 0) + 1,
        totalSpent:  (s.totalSpent  || 0) + total,
        lastOrder:   today,
        updatedAt:   serverTimestamp(),
      });
    }
  }

  return total;
}

/**
 * Registra una venta completa (uno o más ítems del carrito) como UNA sola
 * transacción atómica: o se descuenta el stock y se guardan todas las
 * transacciones, o no se guarda nada.
 *
 * Antes esto era un for-loop con getDoc→updateDoc por ítem, sin validar el
 * stock del servidor (solo el `product.stock` que traía el carrito, que
 * puede estar desactualizado) y sin atomicidad entre ítems: si el segundo
 * ítem fallaba, el primero ya había descontado stock y quedaba huérfano.
 * Ahora, si dos cajeros venden el mismo producto casi al mismo tiempo,
 * Firestore reintenta la transacción que pierde la carrera con el stock ya
 * actualizado, y si de verdad no alcanza el stock, se lanza un error y NO
 * se aplica ningún cambio (ni transacciones ni descuentos parciales).
 */
export async function recordSale(companyId, { cartItems, userName, clientName = "Cliente" }) {
  const today = new Date().toISOString().split("T")[0];

  const productRefs = cartItems.map(item => docRef(companyId, "products", item.id));
  // doc() sin id genera una referencia con ID nuevo que podemos escribir
  // dentro de la transacción (equivalente a lo que hacía addDoc antes).
  const txRefs = cartItems.map(() => doc(colRef(companyId, "transactions")));
  const historyRefs = cartItems.map(item => doc(productHistoryCol(companyId, item.id)));

  await runTransaction(db, async (tx) => {
    // 1. TODAS las lecturas primero (regla de runTransaction en Firestore):
    //    traemos el stock real y actual de cada producto involucrado.
    const snaps = await Promise.all(productRefs.map(ref => tx.get(ref)));

    // 2. Validar ANTES de escribir nada — si algo falla, ninguna escritura
    //    se aplica, así el cajero ve un error claro en vez de una venta a
    //    medias.
    snaps.forEach((snap, i) => {
      const item = cartItems[i];
      if (!snap.exists()) {
        throw new Error(`El producto "${item.name}" ya no existe.`);
      }
      const stockActual = snap.data().stock ?? 0;
      if (stockActual < item.qty) {
        throw new Error(
          `Stock insuficiente para "${item.name}": quedan ${stockActual}, se intentó vender ${item.qty}.`
        );
      }
    });

    // 3. Escrituras: la transacción de venta + el descuento de stock, por
    //    cada ítem del carrito.
    cartItems.forEach((item, i) => {
      const p        = snaps[i].data();
      const newStock = p.stock - item.qty; // ya validado arriba, nunca negativo
      const newStatus = newStock === 0 ? "Agotado"
        : newStock <= p.minStock ? "Stock Bajo"
        : "En Stock";

      tx.set(txRefs[i], {
        type: "venta", date: today,
        product: item.name, sku: item.sku, description: p.description || "",
        qty: item.qty,                  // unidades base descontadas del stock
        // Precio: SIEMPRE el que se acaba de leer del documento real del
        // producto (p.price) dentro de esta transacción, NUNCA item.price
        // (el valor que llega del carrito en el navegador). item.qty sí se
        // confía porque ya se validó arriba contra el stock real — pero el
        // precio es dinero, y cualquiera con la consola del navegador podría
        // llamar a esta función con un item.price manipulado si lo
        // usáramos directo. Así, el monto de la venta queda anclado a lo
        // que de verdad dice el catálogo, pase lo que pase en el cliente.
        unitPrice: p.price, total: p.price * item.qty,
        client: clientName || "Cliente",
        note: "",
        createdBy: userName,
        // Info de empaque (si se vendió en empaques)
        packMode:     item.packMode     || false,
        packQty:      item.packQty      || 0,
        packName:     item.packName     || "",
        baseUnitName: item.baseUnitName || "",
        createdAt: serverTimestamp(),
      });

      tx.update(productRefs[i], {
        stock:   newStock,
        status:  newStatus,
        updatedAt: serverTimestamp(),
      });
      tx.set(historyRefs[i], { date: today, action: "Venta", qty: item.qty, user: userName, createdAt: serverTimestamp() });
    });
  });
}
