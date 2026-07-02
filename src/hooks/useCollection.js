// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useCollection.js
// Hook compartido: se suscribe en tiempo real a una colección de Firestore
// de la empresa actual y expone [items, loading].
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { subscribeToCollection } from "../services/firestoreService";

export function useCollection(companyId, colName, orderField = "createdAt") {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    const unsub = subscribeToCollection(companyId, colName, data => {
      setItems(data);
      setLoading(false);
    }, orderField);
    return unsub;
  }, [companyId, colName, orderField]);
  return [items, loading];
}
