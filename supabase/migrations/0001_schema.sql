-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_schema.sql — Invenxio: Firestore → Postgres (Supabase)
--
-- Mapeo de colecciones Firestore → tablas Postgres:
--   users/{uid}                                  → public.users
--   companies/{companyId}                        → public.companies
--   companies/{id}/meta/subscription             → public.subscriptions
--   companies/{id}/meta/invoiceCounter            → public.invoice_counters
--   companies/{id}/products/{id}                 → public.products
--   companies/{id}/products/{id}/history/{id}    → public.product_history
--   companies/{id}/suppliers/{id}                → public.suppliers
--   companies/{id}/transactions/{id}              → public.transactions
--   companies/{id}/supplierSales/{id}             → public.supplier_sales
--   companies/{id}/warehouseLocations/{id}        → public.warehouse_locations
--   companies/{id}/warehouseStock/{id}            → public.warehouse_stock
--   companies/{id}/warehouseMovements/{id}        → public.warehouse_movements
--   companies/{id}/warehouseProducts/{id}         → public.warehouse_products
--
-- Convención: TODAS las columnas van en snake_case (idiomático en Postgres).
-- La capa de servicios en el frontend (src/services/firestore/*.js) convierte
-- automáticamente snake_case ⇄ camelCase, así que ningún componente de React
-- tiene que cambiar sus nombres de campo.
--
-- IMPORTANTE sobre "companyId": igual que en Firestore, el id de la empresa
-- ES el uid del Dueño fundador (no un uuid random) — así el Dueño siempre
-- sabe su propio companyId sin tener que leer nada primero. Por eso
-- companies.id NO tiene default: siempre se inserta explícitamente = auth.uid().
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ── COMPANIES ────────────────────────────────────────────────────────────
create table public.companies (
  id                uuid primary key,                 -- == owner_id == uid del fundador
  owner_id          uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  plan              text not null default 'free',
  country           text not null default 'PE',
  payment_gateway   text not null default 'culqi',
  currency_code     text not null default 'PEN',
  currency_symbol   text not null default 'S/',
  billing           jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);
comment on table public.companies is 'Empresa (tenant). id == owner_id por diseño.';

-- ── USERS (perfil de app; auth.users ya tiene la cuenta de login) ─────────
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  email         text not null,
  role          text not null check (role in ('owner','empleado')),
  permissions   jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index users_company_id_idx on public.users(company_id);
comment on table public.users is 'Perfil de app de cada usuario. role=owner tiene todos los permisos implícitos.';

-- Ahora que existe public.users, agregamos el FK que faltaba en companies
-- (owner_id ya referencia auth.users, así que no hay dependencia circular
-- real entre companies/users — se podía crear en cualquier orden).

-- ── SUBSCRIPTIONS (companies/{id}/meta/subscription) ──────────────────────
create table public.subscriptions (
  company_id            uuid primary key references public.companies(id) on delete cascade,
  status                text not null,               -- 'trial' | 'active' | 'expired' | ...
  plan                  text not null,                -- 'trial' | 'monthly' | 'cortesia'
  trial_ends_at         timestamptz,
  paid_until            timestamptz,
  payment_gateway       text,
  currency_code         text,
  last_payment_at       timestamptz,
  last_charge_id        text,
  granted_manually_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);
comment on table public.subscriptions is 'Solo lectura desde el cliente. Solo lo escribe el backend con service_role (pagos, courtesy grant) — ver RLS.';

-- ── INVOICE COUNTERS (companies/{id}/meta/invoiceCounter) ─────────────────
create table public.invoice_counters (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  value       integer not null default 0,
  updated_at  timestamptz
);

-- ── PRODUCTS (catálogo de tienda) ──────────────────────────────────────────
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  sku          text,
  description  text,
  category     text,
  price        numeric(14,2) not null default 0,
  cost         numeric(14,2) not null default 0,
  stock        numeric(14,3) not null default 0,
  min_stock    numeric(14,3) not null default 0,
  status       text not null default 'En Stock',      -- 'En Stock' | 'Stock Bajo' | 'Agotado'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index products_company_id_idx on public.products(company_id);

-- ── PRODUCT HISTORY (log inmutable, subcolección) ──────────────────────────
create table public.product_history (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  date         date not null,
  action       text not null,
  qty          numeric(14,3) not null,
  user_name    text,
  note         text,
  created_at   timestamptz not null default now()
);
create index product_history_product_id_idx on public.product_history(product_id, created_at desc);

-- ── SUPPLIERS ───────────────────────────────────────────────────────────────
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  notes         text,
  total_orders  integer not null default 0,
  total_spent   numeric(14,2) not null default 0,
  last_order    text default '—',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index suppliers_company_id_idx on public.suppliers(company_id);

-- ── TRANSACTIONS (ventas y compras — log inmutable) ────────────────────────
create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  type           text not null,                 -- 'venta' | 'compra'
  target         text,                           -- 'almacen' cuando aplica
  date           date not null,
  time           text,
  product        text not null,
  sku            text,
  description    text,
  qty            numeric(14,3) not null,
  unit_cost      numeric(14,2),
  unit_price     numeric(14,2),
  total          numeric(14,2) not null default 0,
  supplier       text,
  client         text,
  note           text,
  created_by     text,
  pack_mode      boolean not null default false,
  pack_qty       numeric(14,3),
  pack_name      text,
  base_unit_name text,
  location_id    uuid,
  location_name  text,
  created_at     timestamptz not null default now()
);
create index transactions_company_id_idx on public.transactions(company_id, created_at desc);

-- ── SUPPLIER SALES (almacén → proveedor) ───────────────────────────────────
create table public.supplier_sales (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  supplier              text not null,
  product               text not null,
  description           text,
  sku                   text,
  qty                   numeric(14,3) not null,
  pack_name             text,
  pack_qty              numeric(14,3),
  unit_price            numeric(14,2) not null default 0,
  total                 numeric(14,2) not null default 0,
  status                text not null default 'Entregado',   -- 'Entregado' | 'Cancelado' | ...
  note                  text,
  warehouse_product_id  uuid,
  location_id           uuid,
  location_name         text,
  date                  date not null default current_date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);
create index supplier_sales_company_id_idx on public.supplier_sales(company_id, created_at desc);

-- ── WAREHOUSE LOCATIONS ─────────────────────────────────────────────────────
create table public.warehouse_locations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index warehouse_locations_company_id_idx on public.warehouse_locations(company_id);

-- ── WAREHOUSE STOCK (qty por producto+ubicación) ───────────────────────────
create table public.warehouse_stock (
  id             text primary key,           -- `${product_id}__${location_id}`, igual que en Firestore
  company_id     uuid not null references public.companies(id) on delete cascade,
  product_id     uuid not null,
  product_name   text,
  sku            text,
  location_id    uuid not null references public.warehouse_locations(id) on delete cascade,
  location_name  text,
  qty            numeric(14,3) not null default 0,
  updated_at     timestamptz
);
create index warehouse_stock_company_id_idx on public.warehouse_stock(company_id);
create index warehouse_stock_product_idx on public.warehouse_stock(company_id, product_id);

-- ── WAREHOUSE MOVEMENTS (log inmutable) ────────────────────────────────────
create table public.warehouse_movements (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  type                 text not null,      -- 'entrada' | 'salida' | 'traslado' | 'envio_inventario'
  product_id           uuid not null,
  product_name         text,
  sku                  text,
  qty                  numeric(14,3) not null,
  unit_qty             numeric(14,3),
  from_location_id     uuid,
  from_location_name   text,
  to_location_id       uuid,
  to_location_name     text,
  store_product_id     uuid,
  store_product_name   text,
  reason               text,
  user_name            text,
  date                 date not null,
  time                 text,
  pack_name            text,
  pack_qty             numeric(14,3),
  pack_price           numeric(14,2),
  created_at           timestamptz not null default now()
);
create index warehouse_movements_company_id_idx on public.warehouse_movements(company_id, created_at desc);

-- ── WAREHOUSE PRODUCTS (catálogo propio del almacén) ───────────────────────
create table public.warehouse_products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  sku          text,
  description  text,
  pack_name    text,
  pack_qty     numeric(14,3),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create index warehouse_products_company_id_idx on public.warehouse_products(company_id);

-- ── Realtime: habilitar replicación lógica para las tablas que la app
--    escucha en vivo (equivalente a onSnapshot). El resto (product_history,
--    invoice_counters, subscriptions) también se puede agregar si se quiere
--    tiempo real ahí, pero no es necesario para el comportamiento actual.
alter publication supabase_realtime add table
  public.products,
  public.suppliers,
  public.transactions,
  public.supplier_sales,
  public.warehouse_locations,
  public.warehouse_stock,
  public.warehouse_movements,
  public.warehouse_products,
  public.users,
  public.companies,
  public.subscriptions,
  public.product_history;
