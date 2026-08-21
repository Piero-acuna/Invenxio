// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useCollection.js
// Hook compartido: se suscribe en tiempo real a una colección de Firestore
// de la empresa actual y expone [items, loading].
// Extraído de InventorySystem.jsx al separar el monolito por módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { subscribeToCollection } from "../services/firestoreService";

export function useCollection(companyId, colName, orderField = "createdAt", limit = null) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!companyId) return;
    // Reinicia "loading" cada vez que cambia la suscripción (ej: al
    // cambiar de empresa) para no mostrar datos de la empresa anterior
    // como si ya hubieran cargado. Es el patrón correcto para sincronizar
    // con un sistema externo (suscripción en tiempo real de Supabase), no
    // estado derivado de props, así que no aplica moverlo al render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const unsub = subscribeToCollection(companyId, colName, data => {
      setItems(data);
      setLoading(false);
    }, orderField, limit);
    return unsub;
  }, [companyId, colName, orderField, limit]);
  return [items, loading];
}
