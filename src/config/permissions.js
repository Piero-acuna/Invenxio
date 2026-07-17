// src/config/permissions.js — Sistema de permisos granulares de Invenxio

export const PERMISSION_GROUPS = [
  {
    id: "inventario",
    label: "Inventario",
    permissions: [
      { key: "ver_inventario",   label: "Ver inventario",   help: "Puede ver la lista de productos y su stock.", default: true  },
      { key: "crear_productos",  label: "Crear productos",  help: "Puede agregar nuevos productos al catálogo.",  default: false },
      { key: "editar_productos", label: "Editar productos", help: "Puede modificar productos y ajustar stock.",   default: false },
    ],
  },
  {
    id: "movimientos",
    label: "Movimientos",
    permissions: [
      { key: "registrar_ventas",  label: "Registrar ventas",  help: "Puede registrar ventas y ver el historial de ventas.",  default: true  },
      { key: "registrar_compras", label: "Registrar compras", help: "Puede registrar compras y ver el historial de compras.", default: false },
    ],
  },
  {
    id: "almacen",
    label: "Almacén",
    permissions: [
      { key: "ver_almacen",       label: "Ver almacén",       help: "Puede ver ubicaciones físicas y el stock por ubicación.", default: false },
      { key: "gestionar_almacen", label: "Gestionar almacén", help: "Puede crear ubicaciones y registrar entradas/salidas.",   default: false },
    ],
  },
  {
    id: "proveedores",
    label: "Proveedores",
    permissions: [
      { key: "ver_proveedores",       label: "Ver proveedores",       help: "Puede ver el listado de proveedores.",                   default: false },
      { key: "gestionar_proveedores", label: "Gestionar proveedores", help: "Puede crear/editar proveedores y registrar compras.",    default: false },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    permissions: [
      { key: "ver_metricas_financieras", label: "Ver métricas financieras", help: "Puede ver costos, totales, gráficos de rentabilidad y exportar con montos.", default: false },
      { key: "eliminar_registros",       label: "Eliminar registros",       help: "Puede eliminar productos y proveedores permanentemente.", default: false, danger: true },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

export function defaultPermissions() {
  const obj = {};
  PERMISSION_GROUPS.forEach(g => g.permissions.forEach(p => { obj[p.key] = !!p.default; }));
  return obj;
}

export function getEffectivePermissions(userProfile) {
  if (!userProfile) return defaultPermissions();
  if (userProfile.role === "owner") {
    const all = {};
    ALL_PERMISSION_KEYS.forEach(k => { all[k] = true; });
    return all;
  }
  const base = defaultPermissions();
  return { ...base, ...(userProfile.permissions || {}) };
}

export function hasPermission(profile, key) {
  return !!getEffectivePermissions(profile)[key];
}

export const TAB_DEFS = {
  dashboard: { id: "dashboard", label: "Inicio"       },
  inventory: { id: "inventory", label: "Inventario"  },
  movements: { id: "movements", label: "Movimientos" },
  warehouse: { id: "warehouse", label: "Almacén"     },
  suppliers: { id: "suppliers", label: "Proveedores" },
};

export function canSeeTab(profile, tabId) {
  if (!profile) return false;
  if (profile.role === "owner") return true;
  if (tabId === "inventory") return hasPermission(profile, "ver_inventario") || hasPermission(profile, "crear_productos") || hasPermission(profile, "editar_productos");
  if (tabId === "movements") return hasPermission(profile, "registrar_ventas") || hasPermission(profile, "registrar_compras");
  if (tabId === "warehouse") return hasPermission(profile, "ver_almacen") || hasPermission(profile, "gestionar_almacen");
  if (tabId === "suppliers") return hasPermission(profile, "ver_proveedores") || hasPermission(profile, "gestionar_proveedores");
  // El Dashboard es un resumen de los demás módulos: solo tiene sentido
  // mostrarlo si el empleado puede ver al menos uno de ellos. Así, alguien
  // sin NINGÚN permiso asignado sigue viendo el mensaje "no tienes permisos
  // todavía" (ver InventorySystem.jsx) en vez de un Dashboard vacío.
  if (tabId === "dashboard") {
    return canSeeTab(profile, "inventory") || canSeeTab(profile, "movements")
        || canSeeTab(profile, "warehouse") || canSeeTab(profile, "suppliers");
  }
  return false;
}
