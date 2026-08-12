-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_rls.sql — Row Level Security, traducción 1:1 de firestore.rules
--
-- Los "helpers" de abajo son el equivalente exacto de las funciones de
-- firestore.rules: isActive(), myCompanyId(), isOwner(companyId),
-- hasPerm(companyId, key). Se marcan SECURITY DEFINER + STABLE para:
--   1. Poder leer public.users desde dentro de una policy de public.users
--      sin caer en recursión infinita (el patrón estándar de Supabase).
--   2. Cachear el resultado dentro de la misma consulta (STABLE).
-- Todas usan `set search_path = public` por seguridad (evita search_path
-- hijacking en funciones SECURITY DEFINER).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── DEFAULT PERMISSIONS (debe reflejar defaultPermissions() en permissions.js) ──
create or replace function public.default_permissions()
returns jsonb language sql immutable as $$
  select '{
    "ver_inventario": true, "crear_productos": false, "editar_productos": false,
    "registrar_ventas": true, "registrar_compras": false,
    "ver_almacen": false, "gestionar_almacen": false,
    "ver_proveedores": false, "gestionar_proveedores": false,
    "ver_metricas_financieras": false, "eliminar_registros": false
  }'::jsonb;
$$;

-- ── VALID PERMISSION KEYS (debe reflejar ALL_PERMISSION_KEYS en permissions.js) ──
create or replace function public.valid_permission_keys()
returns text[] language sql immutable as $$
  select array[
    'ver_inventario', 'crear_productos', 'editar_productos',
    'registrar_ventas', 'registrar_compras',
    'ver_almacen', 'gestionar_almacen',
    'ver_proveedores', 'gestionar_proveedores',
    'ver_metricas_financieras', 'eliminar_registros'
  ];
$$;

create or replace function public.my_profile()
returns public.users
language sql security definer stable
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;

create or replace function public.is_active()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select active from public.users where id = auth.uid()), false);
$$;

create or replace function public.my_company_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select company_id from public.users where id = auth.uid();
$$;

create or replace function public.is_same_company(target_company uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_active() and public.my_company_id() = target_company;
$$;

create or replace function public.is_owner(target_company uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_same_company(target_company)
     and (select role from public.users where id = auth.uid()) = 'owner';
$$;

create or replace function public.has_perm(target_company uuid, perm_key text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select public.is_owner(target_company)
      or (
        public.is_same_company(target_company)
        and coalesce(
          (select (permissions -> perm_key)::boolean from public.users where id = auth.uid()),
          false
        )
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Activar RLS en TODAS las tablas de negocio
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.companies            enable row level security;
alter table public.users                enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.invoice_counters     enable row level security;
alter table public.products             enable row level security;
alter table public.product_history      enable row level security;
alter table public.suppliers            enable row level security;
alter table public.transactions         enable row level security;
alter table public.supplier_sales       enable row level security;
alter table public.warehouse_locations  enable row level security;
alter table public.warehouse_stock      enable row level security;
alter table public.warehouse_movements  enable row level security;
alter table public.warehouse_products   enable row level security;

-- Fuerza RLS incluso para el dueño de la tabla en consultas normales (no
-- afecta a las funciones SECURITY DEFINER de arriba ni al service_role, que
-- siempre bypasean RLS — así se comportan los backends de pago).
-- (no usamos FORCE porque los helpers ya son SECURITY DEFINER y no queremos
--  romper triggers; se deja comentado como referencia)
-- alter table public.users force row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- USERS/{uid}
-- ═══════════════════════════════════════════════════════════════════════════
create policy users_select on public.users
  for select using (
    auth.uid() = id or public.is_owner(company_id)
  );

-- Alta de cuenta nueva (ver create_company() y create_employee_profile() en
-- 0003_functions.sql, que además insertan por este mismo camino gracias a
-- SECURITY DEFINER). Esta policy sigue existiendo para el caso de que algún
-- cliente inserte directo — misma validación que la regla "create" original:
-- el Dueño siempre con company_id = su propio id; el empleado siempre con
-- los permisos por defecto (la elevación real ocurre después, vía update,
-- y solo el Dueño puede hacerla).
create policy users_insert on public.users
  for insert with check (
    auth.uid() = id
    and role in ('owner','empleado')
    and (
      (role = 'owner' and company_id = id)
      or
      (role = 'empleado' and company_id <> id and permissions = public.default_permissions())
    )
  );

-- Update: solo Dueño de la MISMA empresa, y solo puede tocar
-- permissions/active/updated_at (lo demás lo valida el trigger de abajo,
-- porque RLS no puede restringir columnas por sí sola).
create policy users_update on public.users
  for update using (
    public.is_owner(company_id)
  ) with check (
    public.is_owner(company_id)
  );

-- No hay delete de perfiles (solo desactivar) — sin policy de delete =
-- denegado por defecto con RLS activo.

-- Trigger: restringe qué columnas puede tocar el update y valida las keys
-- de permissions, igual que affectedKeys().hasOnly([...]) en Firestore.
create or replace function public.enforce_users_update()
returns trigger language plpgsql as $$
begin
  if new.company_id <> old.company_id then
    raise exception 'No se puede mover un usuario a otra empresa.';
  end if;
  if new.role <> old.role then
    raise exception 'No se puede cambiar el rol de un usuario.';
  end if;
  if new.name <> old.name or new.email <> old.email then
    raise exception 'Este canal solo puede actualizar permissions/active.';
  end if;
  if new.permissions <> old.permissions then
    if not (select bool_and(key = any(public.valid_permission_keys()))
            from jsonb_object_keys(new.permissions) as key) then
      raise exception 'permissions contiene una clave inválida.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger users_before_update
  before update on public.users
  for each row execute function public.enforce_users_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPANIES/{companyId}
-- ═══════════════════════════════════════════════════════════════════════════
create policy companies_select on public.companies
  for select using ( public.is_same_company(id) );

create policy companies_insert on public.companies
  for insert with check (
    auth.uid() = id and owner_id = id and plan = 'free'
  );

create policy companies_update on public.companies
  for update using ( public.is_owner(id) )
  with check ( public.is_owner(id) );

-- Trigger: solo permite tocar billing/name/country/payment_gateway/
-- currency_code/currency_symbol — nunca owner_id ni plan — y si cambia
-- country, exige que payment_gateway/currency vengan coherentes entre sí
-- (PE ⇒ culqi + PEN + S/ ; cualquier otro ⇒ mercadopago + USD + $), igual
-- que la regla original.
create or replace function public.enforce_companies_update()
returns trigger language plpgsql as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'No se puede cambiar el dueño de la empresa.';
  end if;
  if new.plan <> old.plan then
    raise exception 'El plan solo lo cambia el backend de pagos.';
  end if;
  if (new.country, new.payment_gateway, new.currency_code, new.currency_symbol)
     is distinct from (old.country, old.payment_gateway, old.currency_code, old.currency_symbol) then
    if new.country = 'PE' then
      if new.payment_gateway <> 'culqi' or new.currency_code <> 'PEN' or new.currency_symbol <> 'S/' then
        raise exception 'Perú debe usar culqi/PEN/S/.';
      end if;
    else
      if new.payment_gateway <> 'mercadopago' or new.currency_code <> 'USD' or new.currency_symbol <> '$' then
        raise exception 'Fuera de Perú debe usar mercadopago/USD/$.';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger companies_before_update
  before update on public.companies
  for each row execute function public.enforce_companies_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS (companies/{id}/meta/subscription)
-- Solo lectura desde el cliente. La única escritura posterior a la creación
-- la hace el backend de pagos con la service_role key, que bypasea RLS por
-- completo — por eso "update" queda bloqueado incluso para el Dueño.
-- ═══════════════════════════════════════════════════════════════════════════
create policy subscriptions_select on public.subscriptions
  for select using ( public.is_same_company(company_id) );

create policy subscriptions_insert on public.subscriptions
  for insert with check (
    public.is_owner(company_id) and status = 'trial' and plan = 'trial'
  );
-- (el PK company_id ya impide un segundo insert = "creación única")
-- No hay policy de update/delete ⇒ denegado para cualquier rol autenticado
-- normal; el service_role de las funciones de pago sí puede porque
-- bypasea RLS.

-- ═══════════════════════════════════════════════════════════════════════════
-- INVOICE COUNTERS
-- ═══════════════════════════════════════════════════════════════════════════
create policy invoice_counters_select on public.invoice_counters
  for select using (
    public.has_perm(company_id, 'registrar_ventas') or public.has_perm(company_id, 'registrar_compras')
  );
create policy invoice_counters_insert on public.invoice_counters
  for insert with check (
    (public.has_perm(company_id, 'registrar_ventas') or public.has_perm(company_id, 'registrar_compras'))
    and value = 1
  );
create policy invoice_counters_update on public.invoice_counters
  for update using (
    public.has_perm(company_id, 'registrar_ventas') or public.has_perm(company_id, 'registrar_compras')
  ) with check (true); -- el incremento atómico real se valida en la función next_invoice_number()

-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTS + PRODUCT_HISTORY
-- ═══════════════════════════════════════════════════════════════════════════
create policy products_select on public.products
  for select using (
    public.has_perm(company_id,'ver_inventario') or public.has_perm(company_id,'crear_productos') or public.has_perm(company_id,'editar_productos')
  );
create policy products_insert on public.products
  for insert with check ( public.has_perm(company_id,'crear_productos') );
create policy products_update on public.products
  for update using (
    public.has_perm(company_id,'editar_productos') or public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'registrar_compras')
  );
create policy products_delete on public.products
  for delete using ( public.has_perm(company_id,'eliminar_registros') );

create policy product_history_select on public.product_history
  for select using (
    public.has_perm(company_id,'ver_inventario') or public.has_perm(company_id,'crear_productos') or public.has_perm(company_id,'editar_productos')
  );
create policy product_history_insert on public.product_history
  for insert with check (
    public.has_perm(company_id,'editar_productos') or public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'registrar_compras')
  );
-- update/delete: sin policy = inmutable, igual que en Firestore.

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPLIERS
-- ═══════════════════════════════════════════════════════════════════════════
create policy suppliers_select on public.suppliers
  for select using ( public.has_perm(company_id,'ver_proveedores') or public.has_perm(company_id,'gestionar_proveedores') );
create policy suppliers_insert on public.suppliers
  for insert with check ( public.has_perm(company_id,'gestionar_proveedores') or public.has_perm(company_id,'registrar_compras') );
create policy suppliers_update on public.suppliers
  for update using ( public.has_perm(company_id,'gestionar_proveedores') or public.has_perm(company_id,'registrar_compras') );
create policy suppliers_delete on public.suppliers
  for delete using ( public.has_perm(company_id,'eliminar_registros') );

-- ═══════════════════════════════════════════════════════════════════════════
-- TRANSACTIONS (inmutable)
-- ═══════════════════════════════════════════════════════════════════════════
create policy transactions_select on public.transactions
  for select using (
    public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'registrar_compras') or public.has_perm(company_id,'ver_metricas_financieras')
  );
create policy transactions_insert on public.transactions
  for insert with check (
    public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'registrar_compras')
  );
-- update/delete: sin policy = inmutable.

-- ═══════════════════════════════════════════════════════════════════════════
-- SUPPLIER SALES
-- ═══════════════════════════════════════════════════════════════════════════
create policy supplier_sales_select on public.supplier_sales
  for select using ( public.has_perm(company_id,'ver_proveedores') or public.has_perm(company_id,'gestionar_proveedores') );
create policy supplier_sales_insert on public.supplier_sales
  for insert with check ( public.has_perm(company_id,'gestionar_proveedores') );
create policy supplier_sales_update on public.supplier_sales
  for update using ( public.has_perm(company_id,'gestionar_proveedores') );
-- delete: sin policy = denegado (igual que "allow delete: if false").

-- ═══════════════════════════════════════════════════════════════════════════
-- WAREHOUSE_*
-- ═══════════════════════════════════════════════════════════════════════════
create policy warehouse_locations_select on public.warehouse_locations
  for select using ( public.has_perm(company_id,'ver_almacen') or public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_locations_all on public.warehouse_locations
  for insert with check ( public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_locations_upd on public.warehouse_locations
  for update using ( public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_locations_del on public.warehouse_locations
  for delete using ( public.has_perm(company_id,'gestionar_almacen') );

create policy warehouse_stock_select on public.warehouse_stock
  for select using ( public.has_perm(company_id,'ver_almacen') or public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_stock_insert on public.warehouse_stock
  for insert with check (
    public.has_perm(company_id,'gestionar_almacen') or public.has_perm(company_id,'registrar_compras') or public.has_perm(company_id,'gestionar_proveedores')
  );
create policy warehouse_stock_update on public.warehouse_stock
  for update using (
    public.has_perm(company_id,'gestionar_almacen') or public.has_perm(company_id,'registrar_compras') or public.has_perm(company_id,'gestionar_proveedores')
  );
create policy warehouse_stock_delete on public.warehouse_stock
  for delete using ( public.has_perm(company_id,'eliminar_registros') );

create policy warehouse_movements_select on public.warehouse_movements
  for select using ( public.has_perm(company_id,'ver_almacen') or public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_movements_insert on public.warehouse_movements
  for insert with check (
    public.has_perm(company_id,'gestionar_almacen') or public.has_perm(company_id,'registrar_compras') or public.has_perm(company_id,'gestionar_proveedores')
  );
-- update/delete: sin policy = inmutable.

create policy warehouse_products_select on public.warehouse_products
  for select using ( public.has_perm(company_id,'ver_almacen') or public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_products_insert on public.warehouse_products
  for insert with check ( public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_products_update on public.warehouse_products
  for update using ( public.has_perm(company_id,'gestionar_almacen') );
create policy warehouse_products_delete on public.warehouse_products
  for delete using ( public.has_perm(company_id,'gestionar_almacen') or public.has_perm(company_id,'eliminar_registros') );
