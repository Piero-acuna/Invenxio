// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useWarehouseData.js
// Suscribe en tiempo real a las 4 colecciones del módulo de Almacén y avisa
// cuando las 4 primeras cargas ya llegaron (loading=false). Extraído de
// WarehouseModule.jsx al separar el monolito por componentes.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import {
  subscribeToLocations, subscribeToWarehouseStock,
  subscribeToWarehouseMovements, subscribeToWarehouseProducts,
} from "../services/firestoreService";

export function useWarehouseData(companyId) {
  const [locations,         setLocations]         = useState([]);
  const [stock,             setStock]             = useState([]);
  const [movements,         setMovements]         = useState([]);
  const [warehouseProducts, setWarehouseProducts] = useState([]);
  const [loading,           setLoading]           = useState(true);

  useEffect(() => {
    if (!companyId) return;
    let done = 0;
    const check = () => { if (++done >= 4) setLoading(false); };
    const u1 = subscribeToLocations(companyId, d => { setLocations(d); check(); });
    const u2 = subscribeToWarehouseStock(companyId, d => { setStock(d); check(); });
    const u3 = subscribeToWarehouseMovements(companyId, d => { setMovements(d); check(); });
    const u4 = subscribeToWarehouseProducts(companyId, d => { setWarehouseProducts(d); check(); });
    return () => { u1(); u2(); u3(); u4(); };
  }, [companyId]);

  return { locations, stock, movements, warehouseProducts, loading };
}
