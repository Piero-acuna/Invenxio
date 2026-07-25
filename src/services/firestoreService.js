// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestoreService.js
//
// ARQUITECTURA MULTI-EMPRESA:
//   companies/{companyId}/products/{productId}
//   companies/{companyId}/suppliers/{supplierId}
//   companies/{companyId}/transactions/{txId}
//   companies/{companyId}/supplierSales/{saleId}
//   companies/{companyId}/profile          ← datos de la empresa
//   users/{uid}                            ← perfil del usuario (companyId, role)
// ─────────────────────────────────────────────────────────────────────────────
import {
  doc, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, where, limit,
  runTransaction,
} from "firebase/firestore";
import { db } from "../firebase/config";

// ── HELPERS ───────────────────────────────────────────────────────────────────
/** Ruta base de una empresa */
const companyRef  = (cid)       => doc(db, "companies", cid);
const colRef      = (cid, col)  => collection(db, "companies", cid, col);
const docRef      = (cid, col, id) => doc(db, "companies", cid, col, id);

/**
 * Subcolección de historial de un producto: companies/{cid}/products/{pid}/history/{entryId}
 *
 * Antes el historial vivía como un array (`history: [...]`) DENTRO del propio
 * documento del producto, creciendo sin límite con cada venta/compra/ajuste.
 * Firestore limita cada documento a 1 MiB, así que un producto con mucho
 * movimiento (años de ventas) podía terminar acercándose a ese límite, y
 * además cada escritura reenviaba el array completo ya acumulado. Ahora cada
 * entrada es su propio documento en una subcolección: no hay límite práctico
 * de tamaño y cada escritura es liviana (solo la entrada nueva), a costa de
 * un listener aparte para mostrarlo (ver subscribeToProductHistory).
 */
const productHistoryCol = (cid, productId) =>
  collection(db, "companies", cid, "products", productId, "history");

// ── EMPRESA / PERFIL ──────────────────────────────────────────────────────────

/**
 * Crea el documento de la empresa y el perfil del usuario fundador.
 * Se llama una única vez al registrar el primer usuario.
 */
// Duración de la prueba gratis para toda empresa nueva. Un solo número acá
// controla todo el sistema — cambialo si quieres 7, 14, 30 días, etc.
export const TRIAL_DAYS = 14;

export async function createCompany({ companyName, ownerUid, ownerName, ownerEmail }) {
  // 1. Crear documento de la empresa
  const cRef = companyRef(ownerUid); // usamos uid como companyId para simplicidad
  await setDoc(cRef, {
    name:      companyName,
    createdAt: serverTimestamp(),
    ownerId:   ownerUid,
    plan:      "free",
  });

  // 2. Perfil del usuario → referencia a la empresa
  await setDoc(doc(db, "users", ownerUid), {
    name:      ownerName,
    email:     ownerEmail,
    companyId: ownerUid,          // companyId = uid del fundador
    role:      "owner",
    active:    true,
    createdAt: serverTimestamp(),
  });

  // 3. Estado inicial de suscripción: prueba gratis de TRIAL_DAYS días.
  //    Después de esto, este documento SOLO lo puede volver a tocar el
  //    backend de pagos (api/culqi-charge.js) — las reglas de Firestore
  //    bloquean cualquier update desde el cliente, incluso del propio Dueño.
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await setDoc(doc(db, "companies", ownerUid, "meta", "subscription"), {
    status: "trial",
    plan:   "trial",
    trialEndsAt: trialEndsAt.toISOString(),
    createdAt: serverTimestamp(),
  });

  return ownerUid; // retorna el companyId
}

/**
 * Obtiene el perfil del usuario (incluye companyId y role).
 */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Crea el perfil de un usuario que es invitado a una empresa existente.
 */
export async function createUserProfile({ uid, name, email, companyId, role = "empleado", permissions = {} }) {
  await setDoc(doc(db, "users", uid), {
    name, email, companyId, role, permissions,
    active:    true,
    createdAt: serverTimestamp(),
  });
}

/**
 * Obtiene el perfil de la empresa.
 */
export async function getCompanyProfile(companyId) {
  const snap = await getDoc(companyRef(companyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Escucha en tiempo real el documento de la empresa completo (nombre,
 * y datos de facturación dentro del campo `billing`). Se usa para mostrar
 * los Datos de Facturación en el Panel y para emitir comprobantes al vuelo.
 */
export function subscribeToCompany(companyId, onData) {
  return onSnapshot(companyRef(companyId), (snap) => {
    onData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Guarda/actualiza los Datos de Facturación del Dueño (Razón Social, RUC/DNI,
 * dirección, teléfono, email, serie del comprobante). Solo Dueño/Admin puede
 * escribir aquí — lo exigen las reglas de Firestore sobre companies/{id}.
 */
export async function updateCompanyBilling(companyId, billing) {
  return updateDoc(companyRef(companyId), {
    billing,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Suscripción en tiempo real al estado de prueba gratis / pago de la
 * empresa (companies/{id}/meta/subscription). Es de SOLO LECTURA desde el
 * cliente — ver firestore.rules — así que este archivo no tiene ninguna
 * función para escribirlo; eso solo lo hace api/culqi-charge.js con el
 * Admin SDK, después de confirmar un cobro real con Culqi.
 */
export function subscribeToSubscription(companyId, onData) {
  return onSnapshot(doc(db, "companies", companyId, "meta", "subscription"), (snap) => {
    onData(snap.exists() ? snap.data() : null);
  });
}

/**
 * Obtiene el estado de suscripción una sola vez (no en tiempo real) — lo
 * usa el botón de pago para mandarle a Culqi el plan/monto correcto.
 */
export async function getSubscription(companyId) {
  const snap = await getDoc(doc(db, "companies", companyId, "meta", "subscription"));
  return snap.exists() ? snap.data() : null;
}

/**
 * Devuelve el siguiente número correlativo de comprobante, incrementándolo
 * de forma atómica (a salvo de condiciones de carrera si dos ventas se
 * registran casi al mismo tiempo).
 *
 * Vive en una SUBCOLECCIÓN (companies/{id}/meta/invoiceCounter) y no en el
 * documento raíz de la empresa, a propósito: las reglas de Firestore solo
 * dejan escribir el documento raíz companies/{id} a un Dueño/Admin, pero
 * cualquier empleado con permiso de ventas o proveedores necesita poder
 * emitir un comprobante. Las subcolecciones sí están abiertas a cualquier
 * miembro de la misma empresa.
 */
export async function getNextInvoiceNumber(companyId) {
  const counterRef = doc(db, "companies", companyId, "meta", "invoiceCounter");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
}

// ── LISTENERS EN TIEMPO REAL ──────────────────────────────────────────────────

/**
 * Suscripción en tiempo real a una colección.
 * Devuelve una función `unsubscribe` para limpiar el listener.
 *
 * @param {string}   companyId
 * @param {string}   colName       "products" | "suppliers" | "transactions" | "supplierSales"
 * @param {Function} onData        callback(items[])
 * @param {string}   [orderField]  campo para ordenar (default: "createdAt")
 */
export function subscribeToCollection(companyId, colName, onData, orderField = "createdAt") {
  const q = query(colRef(companyId, colName), orderBy(orderField, "desc"));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    onData(items);
  });
}

/**
 * Suscripción en tiempo real al historial de UN producto (subcolección).
 * Se pide bajo demanda (solo cuando el usuario abre el detalle de ese
 * producto), a diferencia del resto de colecciones que se cargan enteras
 * de una — así evitamos traer el historial de todos los productos a la vez.
 *
 * @param {number} maxEntries límite de entradas recientes a traer (default 50)
 */
export function subscribeToProductHistory(companyId, productId, onData, maxEntries = 50) {
  const q = query(productHistoryCol(companyId, productId), orderBy("createdAt", "desc"), limit(maxEntries));
  return onSnapshot(q, (snapshot) => {
    onData(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── PRODUCTOS ─────────────────────────────────────────────────────────────────

export async function addProduct(companyId, product) {
  return addDoc(colRef(companyId, "products"), {
    ...product,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateProduct(companyId, productId, data) {
  return updateDoc(docRef(companyId, "products", productId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProduct(companyId, productId) {
  return deleteDoc(docRef(companyId, "products", productId));
}

/**
 * Ajusta el stock de un producto y registra el movimiento en su historial.
 *
 * Envuelto en runTransaction: si dos ajustes (o un ajuste y una venta) del
 * mismo producto llegan casi al mismo tiempo, Firestore reintenta la
 * transacción que pierde la carrera en vez de dejar que una sobrescriba
 * ciegamente el stock leído por la otra. Antes esto era getDoc → calcular →
 * updateDoc en pasos sueltos, exactamente la misma clase de condición de
 * carrera que loadProfile() tuvo que resolver en AuthContext.
 */
export async function adjustProductStock(companyId, productId, { type, qty, user }) {
  const ref = docRef(companyId, "products", productId);
  // doc() sin id: generamos la ref de la entrada de historial ANTES de la
  // transacción, igual que se hace con las transacciones de venta/compra.
  const historyRef = doc(productHistoryCol(companyId, productId));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Producto no encontrado");

    const p = snap.data();
    // Nota: un ajuste "quitar" nunca deja el stock negativo (se recorta en
    // 0), igual que antes — esto se usa también para corregir mermas o
    // errores de conteo, así que no bloqueamos si qty > stock actual.
    const newStock = type === "add"
      ? p.stock + qty
      : Math.max(0, p.stock - qty);

    const newStatus = newStock === 0 ? "Agotado"
      : newStock <= p.minStock ? "Stock Bajo"
      : "En Stock";

    tx.update(ref, {
      stock:     newStock,
      status:    newStatus,
      updatedAt: serverTimestamp(),
    });

    // Entrada de historial: documento propio en la subcolección, no un
    // array embebido en el producto (ver nota en productHistoryCol).
    tx.set(historyRef, {
      date:   new Date().toISOString().split("T")[0],
      action: type === "add" ? "Ajuste +" : "Ajuste -",
      qty,
      user,
      createdAt: serverTimestamp(),
    });

    return newStock;
  });
}

// ── EMPLEADOS (gestión de equipo del Dueño) ──────────────────────────────────

/**
 * Escucha en tiempo real a todos los usuarios (dueño + empleados) de una empresa.
 * onData recibe la lista completa, incluyendo al dueño.
 */
export function subscribeToEmployees(companyId, onData) {
  const q = query(collection(db, "users"), where("companyId", "==", companyId));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map(d => ({ uid: d.id, id: d.id, ...d.data() }));
    onData(items);
  });
}

/**
 * Reemplaza por completo el objeto de permisos de un empleado.
 */
export async function updateUserPermissions(uid, permissions) {
  return updateDoc(doc(db, "users", uid), { permissions, updatedAt: serverTimestamp() });
}

/**
 * Activa o desactiva el acceso de un empleado sin eliminar su cuenta de
 * Firebase Auth. Un empleado con active=false es expulsado automáticamente
 * la próxima vez que intente iniciar sesión (ver AuthContext).
 */
export async function setEmployeeActive(uid, active) {
  return updateDoc(doc(db, "users", uid), { active, updatedAt: serverTimestamp() });
}

// ── PROVEEDORES ───────────────────────────────────────────────────────────────

export async function addSupplier(companyId, supplier) {
  return addDoc(colRef(companyId, "suppliers"), {
    ...supplier,
    totalOrders: 0,
    totalSpent:  0,
    lastOrder:   "—",
    createdAt:   serverTimestamp(),
  });
}

export async function updateSupplier(companyId, supplierId, data) {
  return updateDoc(docRef(companyId, "suppliers", supplierId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSupplier(companyId, supplierId) {
  return deleteDoc(docRef(companyId, "suppliers", supplierId));
}

// ── TRANSACCIONES (COMPRAS Y VENTAS) ─────────────────────────────────────────

/**
 * Registra una compra:
 *  1. Guarda la transacción
 *  2. Actualiza stock y costo del producto
 *  3. Actualiza métricas del proveedor
 */
export async function recordPurchase(companyId, {
  supplierId, supplierName, productId, productName, sku,
  qty, unitCost, total, note, userName,
  // Equivalencias: si la compra fue en empaques
  packMode = false, packQty = 0, packName = "", baseUnitName = "",
}) {
  const today = new Date().toISOString().split("T")[0];
  const pRef  = docRef(companyId, "products", productId);
  const sRef  = supplierId ? docRef(companyId, "suppliers", supplierId) : null;
  // doc() sin 3er argumento genera un ID nuevo para la transacción, igual
  // que hacía addDoc — pero necesitamos la ref DE ANTEMANO para poder
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
      product: productName, sku,
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
  warehouseProductId, warehouseProductName, sku,
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
    product: warehouseProductName, sku,
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
        product: item.name, sku: item.sku,
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

// ── VENTAS A PROVEEDORES ──────────────────────────────────────────────────────

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
  warehouseProductId, warehouseProductName, sku,
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

  // 2. Registro de la venta al proveedor. Guardamos también el producto y
  //    la ubicación de origen en el almacén — así, si la venta se cancela
  //    más adelante, sabemos exactamente a dónde devolver el stock.
  return addSupplierSale(companyId, {
    supplier: supplierName,
    product: warehouseProductName,
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

// ── ALMACÉN ───────────────────────────────────────────────────────────────────
// Tres subcolecciones:
//   warehouseLocations  → zonas/estantes/pasillos físicos
//   warehouseStock      → qty de cada producto en cada ubicación
//                         ID = `${productId}__${locationId}` para hacer upsert fácil
//   warehouseMovements  → historial de entradas y salidas

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
  return onSnapshot(collection(db, "companies", companyId, "warehouseStock"), snap =>
    onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

/**
 * Ajusta el stock de un producto en una ubicación (delta puede ser positivo
 * o negativo). Si no existe el documento, lo crea en 0 antes de ajustar.
 */
export async function adjustWarehouseStock(companyId, { productId, productName, sku, locationId, locationName, delta }) {
  const stockId  = `${productId}__${locationId}`;
  const stockRef = doc(db, "companies", companyId, "warehouseStock", stockId);
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

// ── PRODUCTOS DE ALMACÉN ──────────────────────────────────────────────────────
// Catálogo PROPIO del almacén (companies/{id}/warehouseProducts/{id}).
// A propósito es una colección separada de "products" (el catálogo de la
// tienda): el almacén maneja sus propios artículos empacados/a granel y NO
// puede seleccionar productos del inventario de la tienda. La única manera
// de que la mercancía del almacén llegue a la tienda es a través de
// `sendWarehouseToInventory`, que suma stock a un producto de tienda elegido
// manualmente por el usuario.

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

// ── ENVÍO A INVENTARIO (Almacén → Tienda) ────────────────────────────────────
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
