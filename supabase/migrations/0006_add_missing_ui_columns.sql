-- ═══════════════════════════════════════════════════════════════════════════
-- add_missing_ui_columns — columnas que la UI (src/) ya usa en sus
-- formularios pero que faltaban en el esquema real de Supabase.
--
-- products.barcode / products.pack_qty ya existían (agregadas en
-- 0005_add_missing_product_columns.sql) — no se tocan de nuevo acá.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── WAREHOUSE_LOCATIONS ── (MapaTab.jsx: name, type, code, description) ────
alter table public.warehouse_locations
  add column if not exists type text not null default 'Zona',
  add column if not exists code text;
comment on column public.warehouse_locations.type is 'Zona | Estante | Pasillo | Refrigerador | Bodega | Otro — ver LOCATION_TYPES en constants.jsx';
comment on column public.warehouse_locations.code is 'Código corto de la ubicación, ej. "A1" (MapaTab.jsx)';

-- ── SUPPLIERS ── (SuppliersModule.jsx: name, ruc, contact, phone, address, productIds, status) ──
alter table public.suppliers
  rename column contact_name to contact;

alter table public.suppliers
  add column if not exists ruc      text,
  add column if not exists status   text  not null default 'Activo',
  add column if not exists products jsonb not null default '[]'::jsonb;
comment on column public.suppliers.ruc is 'RUC/DNI del proveedor (form.ruc en SuppliersModule.jsx)';
comment on column public.suppliers.status is 'Activo | Inactivo';
comment on column public.suppliers.products is 'Array [{id,name}] de productos de almacén asociados a este proveedor';

-- ── WAREHOUSE_PRODUCTS ── (ProductosTab.jsx: unitPrice · SuppliersModule.jsx: cost) ──
alter table public.warehouse_products
  add column if not exists unit_price numeric(14,2),
  add column if not exists cost       numeric(14,2);
comment on column public.warehouse_products.unit_price is 'Precio de referencia por unidad (ProductosTab.jsx)';
comment on column public.warehouse_products.cost is 'Costo de referencia por empaque — detecta cambios de costo en handleSupplierPurchase (SuppliersModule.jsx)';
