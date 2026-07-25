// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/suppliers.js
//
// CRUD del catálogo de proveedores (companies/{id}/suppliers/{id}). Las
// métricas del proveedor (totalOrders/totalSpent/lastOrder) se actualizan
// desde transactions.js (recordPurchase) y desde suppliers.service no vive
// esa lógica — acá solo el alta/edición/baja manual del proveedor mismo.
// ─────────────────────────────────────────────────────────────────────────────
import { addDoc, updateDoc, deleteDoc, serverTimestamp, colRef, docRef } from "./shared";

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
