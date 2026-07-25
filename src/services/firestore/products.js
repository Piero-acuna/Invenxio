// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/products.js
//
// Catálogo de productos de TIENDA (companies/{id}/products/{id}) y su
// historial de movimientos (subcolección history/). Los ajustes de stock que
// pasan por recordSale/recordPurchase viven en transactions.js — acá solo el
// ajuste manual (adjustProductStock) y el CRUD de catálogo.
// ─────────────────────────────────────────────────────────────────────────────
import {
  addDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot,
  query, orderBy, limit, doc, db, colRef, docRef, productHistoryCol,
} from "./shared";

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
