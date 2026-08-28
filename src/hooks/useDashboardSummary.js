// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useDashboardSummary.js
//
// Reemplaza, SOLO para el Dashboard, la vieja suscripción a la tabla
// `transactions` COMPLETA (ver DashboardModule.jsx) por una llamada a la
// función agregada dashboard_transactions_summary() — ver
// supabase/migrations/0014_dashboard_summary_and_indexes.sql para el
// porqué. El resto de la app (MovementsModule, SuppliersModule) sigue
// usando useCollection normal sin tocar — esto es específico del
// Dashboard, que es la pantalla que más tiempo suele quedar abierta.
//
// Se re-consulta (con el mismo debounce de 300ms que usa
// subscribeToCollection, ver services/firestore/shared.js) cada vez que
// cambia algo en `transactions` para esta empresa, para que el resumen
// se mantenga al día en tiempo real igual que antes.
//
// Si la RPC falla por cualquier motivo, esto NUNCA tira la excepción hacia
// arriba — no queremos que un error acá tumbe todo el Dashboard. Se
// degrada mostrando el resumen en ceros/vacío y se loguea el error en
// consola, para que el resto de la pantalla (Almacén, Proveedores,
// Inventario) siga funcionando normal.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { getDashboardTransactionsSummary } from "../services/firestore/transactions";
import { supabase, uniqueChannelName, subscribeToChannel } from "../services/firestore/shared";

const EMPTY_SUMMARY = {
  salesToday: { count: 0, total: 0 },
  purchasesToday: { count: 0, total: 0 },
  recent: [],
  topProductsAgg: [],
};

export function useDashboardTransactionsSummary(companyId) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    async function fetchSummary() {
      try {
        const data = await getDashboardTransactionsSummary(companyId);
        if (!cancelled) setSummary({ ...EMPTY_SUMMARY, ...data });
      } catch (err) {
        console.error("[useDashboardTransactionsSummary]", err);
        if (!cancelled) setSummary(EMPTY_SUMMARY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSummary();

    let debounceTimer = null;
    const scheduleFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchSummary, 300);
    };

    function buildChannel() {
      return supabase
        .channel(uniqueChannelName(`transactions_summary:${companyId}`))
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "transactions", filter: `company_id=eq.${companyId}` },
          scheduleFetch
        )
        .subscribe();
    }
    // Resiliencia ante bfcache: ver el comentario largo en shared.js. Sin
    // esto, este era justo el hook que más tiempo pasa montado (el
    // Dashboard suele quedar abierto en una pestaña), así que era el más
    // expuesto a quedarse "ciego" en tiempo real tras un back/forward.
    const unsubscribeChannel = subscribeToChannel({ buildChannel, refetch: fetchSummary });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeChannel();
    };
  }, [companyId]);

  return [summary, loading];
}
