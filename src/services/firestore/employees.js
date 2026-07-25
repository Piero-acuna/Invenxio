// ─────────────────────────────────────────────────────────────────────────────
// src/services/firestore/employees.js
//
// Gestión de equipo del Dueño: listar empleados, cambiar sus permisos
// granulares y activar/desactivar su acceso. Opera sobre users/{uid}
// filtrando por companyId (users es una colección de nivel raíz, no una
// subcolección de companies/{id} — ver companies.js para el porqué).
// ─────────────────────────────────────────────────────────────────────────────
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, db } from "./shared";

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
