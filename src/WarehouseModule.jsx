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
import { RefreshCw, Warehouse, Boxes, MapPin, PackageX } from "lucide-react";
import MapaTab       from "./components/warehouse/MapaTab";
import ProductosTab  from "./components/warehouse/ProductosTab";
import MovimientoTab from "./components/warehouse/MovimientoTab";
import HistorialTab  from "./components/warehouse/HistorialTab";
import { useAuth } from "./contexts/AuthContext";
import { formatMoney } from "./utils/currency";

// `storeProducts` = catálogo de la TIENDA (colección "products"). El almacén
// solo lo usa como lista de destino posible en "Enviar a Tienda" — nunca para
// elegir qué hay en el almacén. El almacén tiene su propio catálogo
// (`warehouseProducts`) que se gestiona en la pestaña "Mis Productos".
//
// `locations`, `stock`, `movements`, `warehouseProducts` YA NO se cargan acá
// con useWarehouseData() — llegan como prop desde InventorySystem.jsx, que
// las carga una sola vez y las comparte con SuppliersModule.jsx y
// MovementsModule.jsx también (antes cada uno abría su propia suscripción
// independiente a exactamente los mismos datos de almacén).
export default function WarehouseModule({
  companyId, userName, storeProducts = [], canManage,
  locations, stock, movements, warehouseProducts, loading,
}) {
  const { companyCurrency } = useAuth();
  const currencySymbol = companyCurrency.currencySymbol;
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

  // Resumen general — antes NO existía ningún resumen dentro de Almacén
  // (solo había uno en el Dashboard, en otra pantalla). Mismo cálculo de
  // "valor" que usa el Dashboard: empaques en stock × precio de cada
  // empaque, sumado por producto.
  const summary = useMemo(() => {
    let value = 0, totalPacks = 0, outOfStock = 0;
    warehouseProducts.forEach(p => {
      const packs = (stockByProduct[p.id] || []).reduce((sum, s) => sum + (s.qty || 0), 0);
      totalPacks += packs;
      if (packs === 0) outOfStock++;
      if (p.unitPrice) value += packs * Number(p.unitPrice);
    });
    return { value, totalPacks, outOfStock, totalProducts: warehouseProducts.length, totalLocations: locations.length };
  }, [warehouseProducts, stockByProduct, locations]);

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
      {/* Resumen — visible en cualquier pestaña de Almacén */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400"><Warehouse size={16} /></div>
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Valor</p>
            <p className="text-sm font-bold text-white truncate">{formatMoney(summary.value, currencySymbol)}</p>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400"><Boxes size={16} /></div>
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Productos</p>
            <p className="text-sm font-bold text-white truncate">{summary.totalProducts}</p>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400"><MapPin size={16} /></div>
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Ubicaciones</p>
            <p className="text-sm font-bold text-white truncate">{summary.totalLocations}</p>
          </div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-red-500/10 text-red-400"><PackageX size={16} /></div>
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Sin stock</p>
            <p className="text-sm font-bold text-white truncate">{summary.outOfStock}</p>
          </div>
        </div>
      </div>

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

