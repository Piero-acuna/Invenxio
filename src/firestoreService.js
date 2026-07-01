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
} from "firebase/firestore";
import { db } from "../firebase/config";

// ── HELPERS ───────────────────────────────────────────────────────────────────
/** Ruta base de una empresa */
const companyRef  = (cid)       => doc(db, "companies", cid);
const colRef      = (cid, col)  => collection(db, "companies", cid, col);
const docRef      = (cid, col, id) => doc(db, "companies", cid, col, id);

// ── EMPRESA / PERFIL ──────────────────────────────────────────────────────────

/**
 * Crea el documento de la empresa y el perfil del usuario fundador.
 * Se llama una única vez al registrar el primer usuario.
 */
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
export async function createUserProfile({ uid, name, email, companyId, role = "editor" }) {
  await setDoc(doc(db, "users", uid), {
    name, email, companyId, role,
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
 */
export async function adjustProductStock(companyId, productId, { type, qty, user }) {
  const ref  = docRef(companyId, "products", productId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Producto no encontrado");

  const p        = snap.data();
  const newStock = type === "add"
    ? p.stock + qty
    : Math.max(0, p.stock - qty);
  const newStatus = newStock === 0 ? "Agotado"
    : newStock <= p.minStock ? "Stock Bajo"
    : "En Stock";

  const historyEntry = {
    date:   new Date().toISOString().split("T")[0],
    action: type === "add" ? "Ajuste +" : "Ajuste -",
    qty,
    user,
  };

  return updateDoc(ref, {
    stock:     newStock,
    status:    newStatus,
    history:   [historyEntry, ...(p.history || [])],
    updatedAt: serverTimestamp(),
  });
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
}) {
  const today = new Date().toISOString().split("T")[0];

  // 1. Transacción
  await addDoc(colRef(companyId, "transactions"), {
    type: "compra", date: today,
    product: productName, sku,
    qty, unitCost, total,
    supplier: supplierName,
    note: note || "",
    createdBy: userName,
    createdAt: serverTimestamp(),
  });

  // 2. Producto
  const pRef  = docRef(companyId, "products", productId);
  const pSnap = await getDoc(pRef);
  if (pSnap.exists()) {
    const p        = pSnap.data();
    const newStock = p.stock + qty;
    const newStatus = newStock === 0 ? "Agotado"
      : newStock <= p.minStock ? "Stock Bajo"
      : "En Stock";
    await updateDoc(pRef, {
      stock:   newStock,
      cost:    unitCost,
      status:  newStatus,
      history: [{ date: today, action: "Compra", qty, user: userName }, ...(p.history || [])],
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Proveedor
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
}

/**
 * Registra una venta de uno o varios productos (carrito).
 */
export async function recordSale(companyId, { cartItems, userName }) {
  const today = new Date().toISOString().split("T")[0];

  for (const item of cartItems) {
    // Transacción
    await addDoc(colRef(companyId, "transactions"), {
      type: "venta", date: today,
      product: item.name, sku: item.sku,
      qty: item.qty, unitPrice: item.price, total: item.price * item.qty,
      client: "Cliente",
      note:   "",
      createdBy: userName,
      createdAt: serverTimestamp(),
    });

    // Producto
    const pRef  = docRef(companyId, "products", item.id);
    const pSnap = await getDoc(pRef);
    if (pSnap.exists()) {
      const p        = pSnap.data();
      const newStock = Math.max(0, p.stock - item.qty);
      const newStatus = newStock === 0 ? "Agotado"
        : newStock <= p.minStock ? "Stock Bajo"
        : "En Stock";
      await updateDoc(pRef, {
        stock:   newStock,
        status:  newStatus,
        history: [{ date: today, action: "Venta", qty: item.qty, user: userName }, ...(p.history || [])],
        updatedAt: serverTimestamp(),
      });
    }
  }
}

// ── VENTAS A PROVEEDORES ──────────────────────────────────────────────────────

export async function addSupplierSale(companyId, sale) {
  return addDoc(colRef(companyId, "supplierSales"), {
    ...sale,
    date:      new Date().toISOString().split("T")[0],
    createdAt: serverTimestamp(),
  });
}

export async function updateSupplierSaleStatus(companyId, saleId, status) {
  return updateDoc(docRef(companyId, "supplierSales", saleId), {
    status,
    updatedAt: serverTimestamp(),
  });
}
