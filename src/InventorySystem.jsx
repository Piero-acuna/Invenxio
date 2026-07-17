// ─────────────────────────────────────────────────────────────────────────────
// src/InventorySystem.jsx  –  Invenxio v4.1
//
// Punto de entrada del sistema una vez autenticado: header, pestañas visibles
// según permisos, panel de equipo/facturación (RolePanel) y el módulo activo.
//
// Los 4 módulos de contenido (Inventario, Movimientos, Almacén, Proveedores)
// y las piezas compartidas (código de barras, historial, hook de colección)
// viven en archivos separados bajo src/modules/, src/components/ y
// src/hooks/ — este archivo se mantuvo como un monolito de ~2900 líneas
// hasta la refactorización; dividirlo hizo mucho más fácil navegar el
// proyecto y reduce el riesgo de conflictos de merge entre módulos.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import {
  AlertTriangle, Box, LogOut, Loader2, Warehouse,
  Package, BarChart2, Truck, LayoutDashboard,
} from "lucide-react";
import { useAuth } from "./contexts/AuthContext";
import {
  subscribeToEmployees, updateUserPermissions, setEmployeeActive,
  subscribeToCompany, updateCompanyBilling,
} from "./services/firestoreService";
import RolePanel, { RoleBadge } from "./components/RolePanel";
import { hasPermission, canSeeTab, TAB_DEFS } from "./config/permissions";
import WarehouseModule from "./WarehouseModule";
import { useCollection } from "./hooks/useCollection";

import DashboardModule  from "./modules/DashboardModule";
import InventoryModule  from "./modules/InventoryModule";
import MovementsModule  from "./modules/MovementsModule";
import SuppliersModule  from "./modules/SuppliersModule";

// ══════════════════════════════════════════════════════════════════════════════
// ROOT — Invenxio
// ══════════════════════════════════════════════════════════════════════════════
// Wrapper que provee el catálogo de TIENDA al módulo de almacén, solo como
// destino posible del botón "Enviar a Inventario" — el almacén NUNCA elige
// productos de este catálogo para su propio stock, tiene el suyo propio.
function WarehouseModuleWrapper({ companyId, userName, canManage }) {
  const [storeProducts] = useCollection(companyId, "products", "name");
  return <WarehouseModule companyId={companyId} userName={userName} storeProducts={storeProducts} canManage={canManage} />;
}

export default function InventoryApp() {
  const { currentUser, userProfile, companyName, logout, registerEmployee } = useAuth();
  const companyId = userProfile?.companyId;
  const userName  = userProfile?.name || currentUser?.email || "Usuario";
  const isOwner   = userProfile?.role === "owner";
  const canManage = isOwner; // solo el Dueño registra/gestiona empleados

  // ── Permisos del usuario actual: definen qué pestañas y botones ve ────────
  const visibleTabs = ["dashboard", "inventory", "movements", "warehouse", "suppliers"]
    .filter(id => canSeeTab(userProfile, id))
    .map(id => ({ id, ...TAB_DEFS[id] }));

  const perms = {
    verInventario:        hasPermission(userProfile, "ver_inventario"),
    crearProductos:       hasPermission(userProfile, "crear_productos"),
    editarProductos:      hasPermission(userProfile, "editar_productos"),
    registrarVentas:      hasPermission(userProfile, "registrar_ventas"),
    registrarCompras:     hasPermission(userProfile, "registrar_compras"),
    verAlmacen:           hasPermission(userProfile, "ver_almacen"),
    gestionarAlmacen:     hasPermission(userProfile, "gestionar_almacen"),
    verProveedores:       hasPermission(userProfile, "ver_proveedores"),
    gestionarProveedores: hasPermission(userProfile, "gestionar_proveedores"),
    verMetricas:          hasPermission(userProfile, "ver_metricas_financieras"),
    eliminarRegistros:    hasPermission(userProfile, "eliminar_registros"),
  };

  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.id || "inventory");
  // Si cambian los permisos (o el usuario) y la pestaña activa ya no está
  // permitida, saltamos a la primera pestaña que sí puede ver.
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some(t => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [userProfile, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Equipo de la empresa (solo se carga si el usuario puede gestionarlo) ──
  const [employees,        setEmployees]        = useState([]);
  const [employeesLoading, setEmployeesLoading]  = useState(true);
  useEffect(() => {
    if (!companyId || !canManage) { setEmployeesLoading(false); return; }
    const unsub = subscribeToEmployees(companyId, (items) => {
      setEmployees(items);
      setEmployeesLoading(false);
    });
    return unsub;
  }, [companyId, canManage]);

  async function handleRegisterEmployee({ name, email, password, permissions }) {
    await registerEmployee(email, password, name, permissions);
  }
  async function handleChangePermissions(uid, permissions) {
    await updateUserPermissions(uid, permissions);
  }
  async function handleToggleActive(uid, active) {
    await setEmployeeActive(uid, active);
  }

  // ── Datos de Facturación de la empresa (Razón Social, RUC, etc.) ──────────
  const [billing, setBilling] = useState(null);
  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeToCompany(companyId, (company) => {
      setBilling(company?.billing || null);
    });
    return unsub;
  }, [companyId]);

  async function handleSaveBilling(data) {
    await updateCompanyBilling(companyId, data);
  }

  const [products] = useCollection(companyId, "products", "name");
  const lowStock   = products.filter(p => p.status !== "En Stock").length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'IBM Plex Sans','DM Sans',system-ui,sans-serif" }}>
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6">
          <div className="flex items-center justify-between h-13 sm:h-14 gap-2">
            {/* LEFT: logo + insignia + panel */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-md shadow-amber-500/30">
                  <Box size={14} className="text-slate-900" />
                </div>
                <div className="hidden xs:block sm:block">
                  <span className="font-extrabold text-white text-sm sm:text-base tracking-tight">Inven</span>
                  <span className="font-extrabold text-amber-400 text-sm sm:text-base tracking-tight">xio</span>
                  <span className="text-xs text-slate-600 ml-1 font-mono">v1</span>
                </div>
              </div>
              <RoleBadge role={userProfile?.role} />
              <RolePanel
                userProfile={userProfile}
                companyName={companyName}
                canManage={canManage}
                employees={employees}
                employeesLoading={employeesLoading}
                onRegisterEmployee={handleRegisterEmployee}
                onChangePermissions={handleChangePermissions}
                onToggleActive={handleToggleActive}
                billing={billing}
                onSaveBilling={handleSaveBilling}
              />
            </div>

            {/* RIGHT: alertas + usuario + cerrar sesión */}
            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              {lowStock > 0 && (
                <div className="flex items-center gap-1 sm:gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 sm:px-3 py-1.5 rounded-lg">
                  <AlertTriangle size={11} />
                  <span className="hidden sm:inline">{lowStock} alertas</span>
                  <span className="sm:hidden">{lowStock}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-xs font-bold text-slate-900 flex-shrink-0">
                  {userName[0]?.toUpperCase()}
                </div>
                <span className="text-xs text-slate-400 hidden sm:block truncate max-w-24">{userName}</span>
              </div>
              <button onClick={logout} title="Cerrar sesión"
                className="p-1.5 sm:p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0">
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6">
        {visibleTabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-2">
            <AlertTriangle size={28} className="text-amber-400" />
            <p className="text-sm">Tu cuenta no tiene permisos asignados todavía.</p>
            <p className="text-xs text-slate-600">Pídele al Dueño que te asigne acceso desde el Panel.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 bg-slate-800/50 p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-slate-700/50 mb-5 sm:mb-6 w-full sm:w-fit overflow-x-auto">
              {visibleTabs.map(tab => {
                const icon = tab.id === "dashboard" ? <LayoutDashboard size={14} />
                  : tab.id === "inventory" ? <Package size={14} />
                  : tab.id === "movements" ? <BarChart2 size={14} />
                  : tab.id === "warehouse" ? <Warehouse size={14} />
                  : <Truck size={14} />;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap flex-1 sm:flex-none justify-center ${activeTab === tab.id ? "bg-amber-500 text-slate-900 shadow-lg shadow-amber-500/25" : "text-slate-400 hover:text-slate-200"}`}>
                    {icon}<span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {!companyId ? (
              <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-amber-400" /></div>
            ) : (
              <>
                {activeTab === "dashboard" && (
                  <DashboardModule companyId={companyId} userName={userName} companyName={companyName}
                    perms={perms} onNavigate={setActiveTab} />
                )}
                {activeTab === "inventory" && (
                  <InventoryModule companyId={companyId} userName={userName}
                    canCreate={perms.crearProductos} canEdit={perms.editarProductos}
                    canDelete={perms.eliminarRegistros} canViewFinance={perms.verMetricas} />
                )}
                {activeTab === "movements" && (
                  <MovementsModule companyId={companyId} userName={userName}
                    canPurchase={perms.registrarCompras} canSell={perms.registrarVentas}
                    canViewFinance={perms.verMetricas} billing={billing} />
                )}
                {activeTab === "warehouse" && (
                  <WarehouseModuleWrapper companyId={companyId} userName={userName}
                    canManage={perms.gestionarAlmacen} />
                )}
                {activeTab === "suppliers" && (
                  <SuppliersModule companyId={companyId} userName={userName}
                    canManageSuppliers={perms.gestionarProveedores} canDelete={perms.eliminarRegistros}
                    canViewFinance={perms.verMetricas} billing={billing} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
