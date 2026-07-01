// ─────────────────────────────────────────────────────────────────────────────
// src/config/permissions.js
//
// Catálogo de "Permisos de Acceso". Reemplaza al viejo sistema de roles fijos
// (src/config/roles.js queda obsoleto y puede borrarse).
//
// Cada empleado guarda en Firestore un objeto `permissions: { clave: bool }`.
// El Dueño NUNCA depende de este objeto: siempre tiene acceso total
// (ver getEffectivePermissions). Esto evita que el Dueño se quede sin acceso
// por un error de datos.
// ─────────────────────────────────────────────────────────────────────────────

export const PERMISSION_GROUPS = [
  {
    id:    "inventario",
    label: "Inventario",
    permissions: [
      { key: "ver_inventario",   label: "Ver inventario",   help: "Ver la lista de productos y su stock.",        default: true  },
      { key: "crear_productos",  label: "Crear productos",  help: "Agregar productos nuevos al catálogo.",        default: false },
      { key: "editar_productos", label: "Editar productos", help: "Modificar precios, stock y datos de un producto.", default: false },
    ],
  },
  {
    id:    "movimientos",
    label: "Movimientos",
    permissions: [
      { key: "registrar_ventas",  label: "Registrar ventas",  help: "Usar el punto de venta y registrar ventas.",     default: true  },
      { key: "registrar_compras", label: "Registrar compras", help: "Registrar compras a proveedores y recibir stock.", default: false },
    ],
  },
  {
    id:    "proveedores",
    label: "Proveedores",
    permissions: [
      { key: "ver_proveedores",       label: "Ver proveedores",       help: "Ver la lista y los datos de los proveedores.",          default: false },
      { key: "gestionar_proveedores", label: "Gestionar proveedores", help: "Crear proveedores y registrar ventas hacia ellos.",     default: false },
    ],
  },
  {
    id:    "sistema",
    label: "Sistema",
    permissions: [
      { key: "ver_metricas_financieras", label: "Ver métricas financieras", help: "Ver el historial de movimientos y el gráfico de ingresos.", default: false },
      {
        key: "eliminar_registros", label: "Eliminar registros",
        help: "Permite borrar productos y proveedores de forma PERMANENTE. Otorga este permiso con mucho cuidado.",
        default: false, danger: true,
      },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

/** Permisos por defecto para un empleado recién registrado. */
export function defaultPermissions() {
  const out = {};
  for (const g of PERMISSION_GROUPS) for (const p of g.permissions) out[p.key] = !!p.default;
  return out;
}

function allTrue() {
  const out = {};
  for (const k of ALL_PERMISSION_KEYS) out[k] = true;
  return out;
}

/**
 * Permisos EFECTIVOS de un perfil: el Dueño siempre tiene todo,
 * un empleado tiene exactamente lo guardado en Firestore (con
 * defaultPermissions() como base por si falta algún campo nuevo).
 */
export function getEffectivePermissions(profile) {
  if (!profile) return defaultPermissions();
  if (profile.role === "owner") return allTrue();
  return { ...defaultPermissions(), ...(profile.permissions || {}) };
}

export function hasPermission(profile, key) {
  return !!getEffectivePermissions(profile)[key];
}

// ── Pestañas principales y su visibilidad según permisos ────────────────────
export const TAB_DEFS = {
  inventory: { id: "inventory", label: "Inventario" },
  movements: { id: "movements", label: "Movimientos" },
  suppliers: { id: "suppliers", label: "Proveedores" },
};

/** ¿Puede este usuario ver la pestaña principal `tabId`? */
export function canSeeTab(profile, tabId) {
  if (!profile) return false;
  if (profile.role === "owner") return true;
  if (tabId === "inventory") {
    return hasPermission(profile, "ver_inventario")
        || hasPermission(profile, "crear_productos")
        || hasPermission(profile, "editar_productos");
  }
  if (tabId === "movements") {
    return hasPermission(profile, "registrar_ventas")
        || hasPermission(profile, "registrar_compras");
  }
  if (tabId === "suppliers") {
    return hasPermission(profile, "ver_proveedores")
        || hasPermission(profile, "gestionar_proveedores");
  }
  return false;
}
