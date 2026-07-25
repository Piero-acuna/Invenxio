// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/shared.js
//
// Helpers de ruta y utilidades genéricas compartidas por todos los módulos de
// src/services/firestore/*. Nada de acá es API pública de la app — cada
// módulo de dominio (companies.js, products.js, etc.) importa lo que
// necesita desde aquí; el barrel firestoreService.js NO re-exporta este
// archivo completo, solo lo que cada dominio decide exponer.
// ─────────────────────────────────────────────────────────────────────────────
import {
  doc, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, where, limit,
  runTransaction,
} from "firebase/firestore";
import { db } from "../../firebase/config";

// Re-exportamos el SDK de Firestore que ya vienen usando los módulos de
// dominio, para que todos importen desde un solo lugar en vez de repetir el
// mismo import largo de "firebase/firestore" en cada archivo.
export {
  doc, collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, where, limit,
  runTransaction, db,
};

/** Ruta base de una empresa: companies/{cid} */
export const companyRef = (cid) => doc(db, "companies", cid);

/** Ruta de una colección dentro de una empresa: companies/{cid}/{col} */
export const colRef = (cid, col) => collection(db, "companies", cid, col);

/** Ruta de un documento dentro de una colección de una empresa. */
export const docRef = (cid, col, id) => doc(db, "companies", cid, col, id);

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
 * un listener aparte para mostrarlo (ver subscribeToProductHistory en products.js).
 */
export const productHistoryCol = (cid, productId) =>
  collection(db, "companies", cid, "products", productId, "history");

/**
 * Suscripción en tiempo real a una colección de una empresa.
 * Devuelve una función `unsubscribe` para limpiar el listener.
 *
 * Genérico a propósito (no pertenece a ningún dominio en particular): lo usa
 * el hook useCollection para products/suppliers/transactions/supplierSales.
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
