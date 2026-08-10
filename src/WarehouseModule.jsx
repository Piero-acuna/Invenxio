// ─────────────────────────────────────────────────────────────────────────────
// src/WarehouseModule.jsx
// Módulo completo de Almacén: orquesta las 4 pestañas (Mapa, Mis Productos,
// Registrar Movimiento, Historial), cada una en su propio archivo bajo
// src/components/warehouse/. Este archivo solo se encarga de: cargar los
// datos en tiempo real (useWarehouseData), agrupar el stock por ubicación y
// por producto, y decidir qué pestaña mostrar — nada de lógica de formularios
// vive acá.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useWarehouseData } from "./hooks/useWarehouseData";
import MapaTab       from "./components/warehouse/MapaTab";
import ProductosTab  from "./components/warehouse/ProductosTab";
import MovimientoTab from "./components/warehouse/MovimientoTab";
import HistorialTab  from "./components/warehouse/HistorialTab";

// `storeProducts` = catálogo de la TIENDA (colección "products"). El almacén
// solo lo usa como lista de destino posible en "Enviar a Tienda" — nunca para
// elegir qué hay en el almacén. El almacén tiene su propio catálogo
// (`warehouseProducts`) que se gestiona en la pestaña "Mis Productos".
export default function WarehouseModule({ companyId, userName, storeProducts = [], canManage }) {
  const { locations, stock, movements, warehouseProducts, loading } = useWarehouseData(companyId);
  const [wTab, setWTab] = useState("mapa"); // "mapa" | "productos" | "movimiento" | "historial"

  // Stock agrupado por ubicación
  const stockByLocation = useMemo(() => {
    const map = {};
    stock.forEach(s => {
      if (!map[s.locationId]) map[s.locationId] = [];
      map[s.locationId].push(s);
    });
    return map;
  }, [stock]);

  // Stock agrupado por producto (de almacén)
  const stockByProduct = useMemo(() => {
    const map = {};
    stock.forEach(s => {
      if (!map[s.productId]) map[s.productId] = [];
      map[s.productId].push(s);
    });
    return map;
  }, [stock]);

  const INNER_TABS = [
    { id: "mapa",       label: "🗺 Mapa del Almacén"  },
    { id: "productos",  label: "📦 Mis Productos",        hide: !canManage },
    { id: "movimiento", label: "🔁 Registrar Movimiento", hide: !canManage },
    { id: "historial",  label: "📋 Historial"           },
  ].filter(t => !t.hide);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw size={24} className="animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Inner tabs */}
      <div className="flex w-full sm:w-fit gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50 overflow-x-auto">
        {INNER_TABS.map(t => (
          <button key={t.id} onClick={() => setWTab(t.id)}
            className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${wTab === t.id ? "bg-amber-500 text-slate-900" : "text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {wTab === "mapa" && (
        <MapaTab
          locations={locations} stockByLocation={stockByLocation} stockByProduct={stockByProduct}
          warehouseProducts={warehouseProducts} canManage={canManage} companyId={companyId}
        />
      )}
      {wTab === "productos" && canManage && (
        <ProductosTab
          warehouseProducts={warehouseProducts} stockByProduct={stockByProduct} locations={locations}
          userName={userName} companyId={companyId}
        />
      )}
      {wTab === "movimiento" && canManage && (
        <MovimientoTab
          locations={locations} warehouseProducts={warehouseProducts} storeProducts={storeProducts}
          companyId={companyId} userName={userName} stockByProduct={stockByProduct}
        />
      )}
      {wTab === "historial" && <HistorialTab movements={movements} />}
    </div>
  );
}

