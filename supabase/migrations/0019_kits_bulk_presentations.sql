-- ═══════════════════════════════════════════════════════════════════════════
-- 0019_kits_bulk_presentations.sql
--
-- Objetivo: soportar Kits/Packs/Cajas y Venta a Granel (peso) a partir de un
-- único stock base, con precios que se congelan por ticket.
--
-- DECISIÓN DE DISEÑO CLAVE: un único concepto — "factor" — modela tanto los
-- kits como el granel. `product_presentations.factor` responde siempre la
-- misma pregunta: "¿a cuántas unidades BASE equivale UNA de estas
-- presentaciones?". Para el Pack Oreo (6 galletas) factor=6. Para la Caja
-- (10 packs) factor=60. Para "Kilogramo" de arroz factor=1.000 (porque el
-- stock base YA está en kg). Para "Saco 35kg" factor=35.000. Es la MISMA
-- columna, el MISMO tipo de dato, la MISMA multiplicación en la única RPC
-- que descuenta stock — no hace falta bifurcar la lógica por unit_type en
-- ningún lado del cálculo, solo en la validación de "no vendas medio
-- alfajor" (ver record_sale_v2).
--
-- DECISIÓN: KG en decimal, no gramos enteros. `products.stock` ya era
-- numeric(14,3) desde 0001_schema.sql — 3 decimales = precisión de GRAMO
-- (0.001 kg = 1 g) sin necesitar una columna ni una unidad de medida
-- distinta para productos a granel. "35 kg" se guarda como 35.000 en la
-- MISMA columna que hoy guarda "60" unidades de Oreo. Elegí esto en vez de
-- guardar gramos enteros porque evitaba una conversión ×1000/÷1000 en cada
-- lectura/escritura de la UI (que ya muestra `stock` tal cual en kg en
-- todos los reportes) sin ganar nada a cambio — 3 decimales ya cubre el
-- caso de uso (fracciones de gramo no son razonables en un POS de tienda).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PRODUCTS: el Producto Base gana un unit_type ────────────────────────────
alter table public.products
  add column unit_type       text not null default 'unidad' check (unit_type in ('unidad','peso')),
  add column base_unit_label text not null default 'un';   -- 'un' | 'kg' | 'g' | 'L' ... solo para mostrar, no afecta el cálculo

comment on column public.products.unit_type is
  'unidad = se vende por unidades enteras (contables). peso = se vende por fracciones decimales (kg). Determina si record_sale_v2 exige que qty_base sea entero.';
comment on column public.products.stock is
  'Stock BASE del producto — SIEMPRE en la unidad más pequeña indivisible: 1 galleta suelta, o 1.000 kg. Todas las presentaciones (packs, cajas, sacos, "Kilogramo") son múltiplos de esta misma unidad vía product_presentations.factor.';

-- ── PRODUCT_PRESENTATIONS: las formas en que se compra/vende un producto ───
create table public.product_presentations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  name             text not null,                          -- 'Unidad', 'Pack x6', 'Caja x10 packs', 'Kilogramo', 'Saco 35kg'
  barcode          text,                                    -- el pack/caja suele traer SU PROPIO código de barras, distinto al de la unidad suelta
  factor           numeric(14,3) not null check (factor > 0), -- cuántas unidades BASE hay en UNA de esta presentación
  price            numeric(14,2) not null default 0,        -- precio de venta de ESTA presentación completa (precio del pack, precio de 1 kg) — NO precio por unidad base
  is_default_sale  boolean not null default false,          -- cuál aparece preseleccionada en el POS
  is_purchase_only boolean not null default false,          -- ej. "Saco 35kg": se usa para INGRESAR stock, no se vende tal cual en caja
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);
create index product_presentations_product_id_idx on public.product_presentations(product_id);
-- Un código de barras no puede repetirse dentro de la misma empresa (sí
-- puede repetirse ENTRE empresas distintas — cada una escanea su propio
-- catálogo). Parcial: permite múltiples filas con barcode NULL/''.
create unique index product_presentations_barcode_idx
  on public.product_presentations(company_id, barcode)
  where barcode is not null and barcode <> '';

comment on column public.product_presentations.factor is
  'Unidades BASE que representa UNA de esta presentación. Pack x6 → 6. Caja de 10 packs → 60. "Kilogramo" de un producto a granel → 1.000 (el stock base ya está en kg). "Saco 35kg" → 35.000.';
comment on column public.product_presentations.price is
  'Precio de venta de UNA unidad de ESTA presentación (precio del pack completo, precio de 1 kg) — no un precio "por unidad base". Se congela en sale_items.unit_price al momento de vender; cambiarlo acá NUNCA reescribe ventas pasadas.';

-- ── Trigger: una presentación no puede "apuntar" a un producto de OTRA
--    empresa (aunque su propio company_id sea válido para RLS) — mismo tipo
--    de control que ya usa enforce_users_update()/enforce_companies_update()
--    en 0002_rls.sql. Esto corre SIEMPRE, incluso desde funciones
--    SECURITY DEFINER que bypasean RLS, porque los triggers de fila no se
--    saltan nunca — a diferencia de una policy RLS, que sí se puede
--    bypasear con la service_role key o dentro de otra función definer. ──
create or replace function public.enforce_product_presentations_write()
returns trigger language plpgsql as $$
declare v_product_company uuid;
begin
  if tg_op = 'UPDATE' then
    if new.product_id <> old.product_id then
      raise exception 'No se puede reasignar una presentación a otro producto.';
    end if;
    if new.company_id <> old.company_id then
      raise exception 'No se puede mover una presentación a otra empresa.';
    end if;
  end if;

  select company_id into v_product_company from public.products where id = new.product_id;
  if v_product_company is null then
    raise exception 'El producto base no existe.';
  end if;
  if v_product_company <> new.company_id then
    raise exception 'La presentación debe pertenecer a la misma empresa que su producto base.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
create trigger product_presentations_before_write
  before insert or update on public.product_presentations
  for each row execute function public.enforce_product_presentations_write();

-- ── RLS product_presentations — mismo patrón que products (0002_rls.sql) ──
alter table public.product_presentations enable row level security;

create policy product_presentations_select on public.product_presentations
  for select using (
    public.has_perm(company_id,'ver_inventario') or public.has_perm(company_id,'crear_productos') or public.has_perm(company_id,'editar_productos')
  );
create policy product_presentations_insert on public.product_presentations
  for insert with check ( public.has_perm(company_id,'crear_productos') );
create policy product_presentations_update on public.product_presentations
  for update using ( public.has_perm(company_id,'editar_productos') );
  -- Caso 3 ("el administrador actualiza el precio en product_presentations")
  -- pasa exactamente por acá: es un UPDATE directo del cliente, protegido
  -- por RLS + el trigger de arriba — no necesita una RPC dedicada porque
  -- cambiar un precio de catálogo no es una operación transaccional (no
  -- toca stock ni dinero ya cobrado).
create policy product_presentations_delete on public.product_presentations
  for delete using ( public.has_perm(company_id,'eliminar_registros') );

-- ═══════════════════════════════════════════════════════════════════════════
-- SALES / SALE_ITEMS — el ticket inmutable
-- ═══════════════════════════════════════════════════════════════════════════
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  date            date not null,
  time            text not null default to_char(now(),'HH24:MI'),
  client          text not null default 'Cliente',
  payment_method  text not null default 'Efectivo',
  subtotal        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  status          text not null default 'completada' check (status in ('completada','cancelada')),
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index sales_company_id_idx on public.sales(company_id, created_at desc);

create table public.sale_items (
  id                          uuid primary key default gen_random_uuid(),
  sale_id                     uuid not null references public.sales(id) on delete cascade,
  company_id                  uuid not null references public.companies(id) on delete cascade,

  -- FKs "vivas" — sirven para reportes/joins de HOY. Son nullable y con
  -- ON DELETE SET NULL a propósito: si mañana borran el producto o la
  -- presentación del catálogo, el TICKET DE HOY no debe desaparecer ni
  -- quedar huérfano — por eso cada dato que importa para reconstruir el
  -- recibo también se guarda "congelado" abajo, en las columnas *_snapshot.
  product_id                  uuid references public.products(id) on delete set null,
  presentation_id             uuid references public.product_presentations(id) on delete set null,

  -- ── Snapshot: esto es lo que hace inmutable al ticket. Se escribe UNA
  --    vez, dentro de record_sale_v2(), leyendo el precio/factor/nombre
  --    REALES de la base en ese instante — y no hay ninguna policy RLS que
  --    permita a un cliente hacer UPDATE sobre esta tabla después (ver
  --    abajo). Cambiar product_presentations.price mañana no reescribe
  --    ni un solo char de estas columnas. ──
  product_name_snapshot       text not null,
  sku_snapshot                text,
  presentation_name_snapshot  text not null,
  unit_type_snapshot          text not null,
  factor_snapshot             numeric(14,3) not null,
  qty_presentation            numeric(14,3) not null,  -- cuánto de la PRESENTACIÓN se vendió: 1 pack, 2 cajas, 0.650 (si la presentación es "Kilogramo")
  qty_base                    numeric(14,3) not null,  -- factor_snapshot × qty_presentation — lo que REALMENTE se descontó de products.stock
  unit_price                  numeric(14,2) not null,  -- precio de product_presentations.price al momento de la venta, congelado
  line_total                  numeric(14,2) not null,  -- unit_price × qty_presentation, congelado

  created_at                  timestamptz not null default now()
);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index sale_items_company_id_idx on public.sale_items(company_id, created_at desc);
create index sale_items_product_id_idx on public.sale_items(product_id);

comment on table public.sale_items is
  'Líneas de venta INMUTABLES. Sin policies de UPDATE/DELETE para el cliente (ver RLS abajo) — la única forma de que exista o cambie una fila acá es record_sale_v2()/cancel_sale(), y ninguna de las dos acepta un precio como parámetro: el precio SIEMPRE se lee de product_presentations dentro de la función.';

-- ── RLS sales/sale_items ────────────────────────────────────────────────────
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

create policy sales_select on public.sales
  for select using (
    public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'ver_metricas_financieras')
  );
create policy sale_items_select on public.sale_items
  for select using (
    public.has_perm(company_id,'registrar_ventas') or public.has_perm(company_id,'ver_metricas_financieras')
  );

-- A PROPÓSITO no hay policies de insert/update/delete en ninguna de las 2
-- tablas. Con RLS activo y CERO policies para un comando, Postgres deniega
-- ESE comando por completo para cualquier cliente autenticado normal — no
-- hay forma de que alguien haga `.from('sale_items').update(...)` desde el
-- navegador ni desde curl/Postman con un token válido, sin importar su rol
-- o permisos. Las únicas 2 funciones que escriben acá son SECURITY DEFINER
-- (record_sale_v2, cancel_sale) — bypasean RLS por ser dueñas de la tabla,
-- pero como se ve más abajo, ninguna de las dos recibe un precio del
-- cliente: record_sale_v2 SIEMPRE lee product_presentations.price fresco
-- dentro de la transacción, y cancel_sale nunca toca unit_price/line_total,
-- solo el status. Esta es la garantía real de "el precio se congela" que
-- pide el requerimiento — no es una convención de la UI que alguien podría
-- saltarse, es algo que la base de datos hace estructuralmente imposible.

-- ═══════════════════════════════════════════════════════════════════════════
-- record_sale_v2() — reemplaza a record_sale() para carritos que usan
-- presentaciones. Cada item del carrito es:
--   { "presentation_id": uuid, "mode": "qty" | "amount", "value": numeric }
--   • mode "qty": value = cuántas presentaciones (1 pack, 2 cajas, o 0.650
--     si la presentación ES "Kilogramo" — venta por peso directo).
--   • mode "amount": value = monto en soles ingresado en el POS (el "S/
--     2.00" del Caso 3) — la función calcula la fracción de kg SERVIDOR-
--     SIDE con el precio real, nunca confía en un qty ya calculado por el
--     cliente (mismo espíritu que el BUG 2/BUG 3 que ya corrigieron en
--     0013_fix_dates_and_server_side_totals.sql).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_sale_v2(
  p_company        uuid,
  p_cart           jsonb,
  p_user_name      text,
  p_client_name    text default 'Cliente',
  p_payment_method text default 'Efectivo',
  p_client_date    date default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_item              jsonb;
  v_presentation_id   uuid;
  v_mode              text;
  v_value             numeric;
  v_pres              record;
  v_qty_presentation  numeric;
  v_qty_base          numeric;
  v_line_total        numeric;
  v_new_stock         numeric;
  v_sale_id           uuid;
  v_subtotal          numeric := 0;
  v_date              date := coalesce(p_client_date, current_date);
  v_items_result      jsonb := '[]'::jsonb;
begin
  if not public.has_perm(p_company,'registrar_ventas') then
    raise exception 'No autorizado.';
  end if;
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'El carrito está vacío.';
  end if;

  -- Bloquea de una sola vez TODOS los productos involucrados, en orden fijo
  -- por id — evita deadlocks entre ventas concurrentes que tocan los mismos
  -- productos en distinto orden (mismo patrón que ya usa record_sale()).
  perform 1 from public.products
    where company_id = p_company
      and id in (
        select pp.product_id
        from jsonb_array_elements(p_cart) elem
        join public.product_presentations pp on pp.id = (elem->>'presentation_id')::uuid
        where pp.company_id = p_company
      )
    order by id
    for update;

  insert into public.sales (company_id, date, client, payment_method, subtotal, total, created_by)
  values (p_company, v_date, coalesce(p_client_name,'Cliente'), coalesce(p_payment_method,'Efectivo'), 0, 0, p_user_name)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_cart) loop
    v_presentation_id := (v_item->>'presentation_id')::uuid;
    v_mode  := coalesce(v_item->>'mode', 'qty');
    v_value := (v_item->>'value')::numeric;
    if v_value is null or v_value <= 0 then
      raise exception 'Cantidad inválida en el carrito.';
    end if;

    -- Todo lo que sigue se LEE del servidor — presentación, producto,
    -- factor, precio — nunca se confía en nada del carrito salvo el
    -- presentation_id y la cantidad/monto ingresados.
    select
      pp.id as presentation_id, pp.name as presentation_name, pp.factor, pp.price,
      pr.id as product_id, pr.name as product_name, pr.sku, pr.stock, pr.min_stock, pr.unit_type
    into v_pres
    from public.product_presentations pp
    join public.products pr on pr.id = pp.product_id
    where pp.id = v_presentation_id and pp.company_id = p_company and pp.active = true;
    if not found then
      raise exception 'La presentación seleccionada ya no existe o no pertenece a esta empresa.';
    end if;

    if v_mode = 'amount' then
      if v_pres.price <= 0 then
        raise exception 'No se puede vender "%" por monto: no tiene un precio configurado.', v_pres.presentation_name;
      end if;
      -- Caso 3: "Venta por S/2.00 calcula la fracción" — v_value es el
      -- monto en soles, se convierte a cantidad de la presentación con el
      -- precio REAL leído arriba, no con uno que haya mandado el cliente.
      v_qty_presentation := round(v_value / v_pres.price, 3);
    else
      v_qty_presentation := round(v_value, 3);
    end if;

    v_qty_base := round(v_qty_presentation * v_pres.factor, 3);

    -- unit_type = 'unidad' ⇒ no existen las "0.5 galletas". unit_type =
    -- 'peso' no tiene esta restricción (0.650 kg es perfectamente válido).
    if v_pres.unit_type = 'unidad' and v_qty_base <> trunc(v_qty_base) then
      raise exception '"%" se vende por unidad entera — la cantidad calculada (%) no es un número entero de unidades.', v_pres.product_name, v_qty_base;
    end if;

    if v_pres.stock < v_qty_base then
      raise exception 'Stock insuficiente para "%": quedan %, se intentó vender %.', v_pres.product_name, v_pres.stock, v_qty_base;
    end if;

    v_line_total := round(v_pres.price * v_qty_presentation, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_new_stock := v_pres.stock - v_qty_base;
    update public.products
      set stock = v_new_stock, status = public._stock_status(v_new_stock, v_pres.min_stock), updated_at = now()
      where id = v_pres.product_id;

    insert into public.sale_items (
      sale_id, company_id, product_id, product_name_snapshot, sku_snapshot,
      presentation_id, presentation_name_snapshot, unit_type_snapshot, factor_snapshot,
      qty_presentation, qty_base, unit_price, line_total
    ) values (
      v_sale_id, p_company, v_pres.product_id, v_pres.product_name, v_pres.sku,
      v_pres.presentation_id, v_pres.presentation_name, v_pres.unit_type, v_pres.factor,
      v_qty_presentation, v_qty_base, v_pres.price, v_line_total
    );

    insert into public.product_history (company_id, product_id, date, action, qty, user_name, note)
      values (p_company, v_pres.product_id, v_date, 'Venta', v_qty_base, p_user_name,
              v_qty_presentation || ' × ' || v_pres.presentation_name);

    -- v_value/v_pres ya quedaron sueltos de la fila locked del pre-lock de
    -- arriba (mismo product_id no puede repetirse con stock desactualizado
    -- entre líneas: el update de esta iteración ya quedó visible para la
    -- siguiente iteración dentro de esta misma transacción).
    v_items_result := v_items_result || jsonb_build_object(
      'presentationName', v_pres.presentation_name, 'qtyPresentation', v_qty_presentation,
      'qtyBase', v_qty_base, 'unitPrice', v_pres.price, 'lineTotal', v_line_total
    );
  end loop;

  update public.sales set subtotal = v_subtotal, total = v_subtotal where id = v_sale_id;

  return jsonb_build_object('saleId', v_sale_id, 'total', v_subtotal, 'items', v_items_result);
end;
$$;
revoke all on function public.record_sale_v2(uuid,jsonb,text,text,text,date) from public;
grant execute on function public.record_sale_v2(uuid,jsonb,text,text,text,date) to authenticated;

-- ── cancel_sale() — mismo patrón que cancel_supplier_sale() (0013). Solo
--    cambia `status`; unit_price/line_total/total quedan INTACTOS incluso
--    en una venta cancelada — sigue siendo el registro fiel de lo que se
--    cobró, ahora marcado como anulado. ──
create or replace function public.cancel_sale(
  p_company     uuid,
  p_sale_id     uuid,
  p_user_name   text,
  p_client_date date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_sale  public.sales;
  v_item  public.sale_items;
  v_stock numeric; v_min_stock numeric; v_new_stock numeric;
  v_date  date := coalesce(p_client_date, current_date);
begin
  if not public.has_perm(p_company,'registrar_ventas') then
    raise exception 'No autorizado.';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and company_id = p_company for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if v_sale.status = 'cancelada' then return; end if;

  for v_item in select * from public.sale_items where sale_id = p_sale_id loop
    if v_item.product_id is not null then
      select stock, min_stock into v_stock, v_min_stock
        from public.products where id = v_item.product_id and company_id = p_company for update;
      if found then
        v_new_stock := v_stock + v_item.qty_base;
        update public.products
          set stock = v_new_stock, status = public._stock_status(v_new_stock, v_min_stock), updated_at = now()
          where id = v_item.product_id;
        insert into public.product_history (company_id, product_id, date, action, qty, user_name, note)
          values (p_company, v_item.product_id, v_date, 'Devolución por venta cancelada', v_item.qty_base, p_user_name, 'Venta ' || p_sale_id);
      end if;
    end if;
  end loop;

  update public.sales set status = 'cancelada', updated_at = now() where id = p_sale_id;
end;
$$;
revoke all on function public.cancel_sale(uuid,uuid,text,date) from public;
grant execute on function public.cancel_sale(uuid,uuid,text,date) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_purchase_by_presentation() — el lado de "ingresar a almacén" de
-- los Casos 1 y 3 ("Ingresa 1 caja con 10 packs", "Ingresa 1 Saco de
-- 35kg"). Reutiliza la tabla `transactions` que YA existe para compras (no
-- se duplica ese log) — lo único nuevo es que el factor se RESUELVE
-- SERVIDOR-SIDE desde product_presentations en vez de recibir un pack_qty
-- del cliente (mismo espíritu que el BUG 3 de send_warehouse_to_inventory).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_purchase_by_presentation(
  p_company          uuid,
  p_presentation_id  uuid,
  p_qty_presentation numeric,   -- ej. 1 (una caja), 1 (un saco de 35kg)
  p_unit_cost        numeric,   -- costo de UNA unidad de esta presentación (costo de la caja completa, costo del saco completo)
  p_supplier_id      uuid default null,
  p_supplier_name    text default null,
  p_note             text default null,
  p_user_name        text default null,
  p_client_date      date default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pres          record;
  v_qty_base      numeric;
  v_cost_per_base numeric;
  v_total         numeric;
  v_new_stock     numeric;
  v_tx_id         uuid;
  v_orders        integer; v_spent numeric;
  v_date          date := coalesce(p_client_date, current_date);
begin
  if not public.has_perm(p_company,'registrar_compras') then
    raise exception 'No autorizado.';
  end if;
  if p_qty_presentation is null or p_qty_presentation <= 0 then
    raise exception 'Cantidad inválida.';
  end if;

  select pp.id, pp.name, pp.factor, pr.id as product_id, pr.name as product_name, pr.sku, pr.stock, pr.min_stock
    into v_pres
    from public.product_presentations pp
    join public.products pr on pr.id = pp.product_id
    where pp.id = p_presentation_id and pp.company_id = p_company
    for update of pr;
  if not found then raise exception 'La presentación seleccionada ya no existe.'; end if;

  v_qty_base      := round(p_qty_presentation * v_pres.factor, 3);
  v_cost_per_base := round(p_unit_cost / v_pres.factor, 4);
  v_total         := round(p_qty_presentation * p_unit_cost, 2);
  v_new_stock     := v_pres.stock + v_qty_base;

  update public.products
    set stock = v_new_stock, cost = v_cost_per_base, status = public._stock_status(v_new_stock, v_pres.min_stock), updated_at = now()
    where id = v_pres.product_id;

  insert into public.transactions (
    company_id, type, date, product, sku, description, qty, unit_cost, total,
    supplier, note, created_by, pack_mode, pack_qty, pack_name, base_unit_name
  ) values (
    p_company, 'compra', v_date, v_pres.product_name, v_pres.sku,
    p_qty_presentation || ' × ' || v_pres.name, v_qty_base, v_cost_per_base, v_total,
    p_supplier_name, coalesce(p_note,''), p_user_name,
    true, v_pres.factor, v_pres.name, null
  ) returning id into v_tx_id;

  insert into public.product_history (company_id, product_id, date, action, qty, user_name, note)
    values (p_company, v_pres.product_id, v_date, 'Compra', v_qty_base, p_user_name, p_qty_presentation || ' × ' || v_pres.name);

  if p_supplier_id is not null then
    select total_orders, total_spent into v_orders, v_spent
      from public.suppliers where id = p_supplier_id and company_id = p_company for update;
    if found then
      update public.suppliers
        set total_orders = coalesce(v_orders,0)+1, total_spent = coalesce(v_spent,0)+v_total,
            last_order = v_date::text, updated_at = now()
        where id = p_supplier_id;
    end if;
  end if;

  return v_tx_id;
end;
$$;
revoke all on function public.record_purchase_by_presentation(uuid,uuid,numeric,numeric,uuid,text,text,text,date) from public;
grant execute on function public.record_purchase_by_presentation(uuid,uuid,numeric,numeric,uuid,text,text,text,date) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table
  public.product_presentations,
  public.sales,
  public.sale_items;
