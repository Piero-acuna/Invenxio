-- ═══════════════════════════════════════════════════════════════════════════
-- 0014_dashboard_summary_and_indexes.sql
--
-- Encontrado en una auditoría de rendimiento: DashboardModule.jsx (la
-- pantalla de inicio, la que más tiempo pasa abierta) se suscribía a TODA
-- la tabla `transactions` de la empresa SIN límite — y por cómo funciona
-- `subscribeToCollection` (ver shared.js), cualquier venta o compra hecha
-- por CUALQUIER empleado, en CUALQUIER módulo, disparaba una re-descarga de
-- la tabla COMPLETA para cada usuario que tuviera el Dashboard abierto en
-- ese momento. Como `transactions` es un historial que solo crece, esto
-- empeora con el tiempo — es exactamente el patrón de "datos acumulados"
-- pegándole cada vez más fuerte al rendimiento.
--
-- Lo único que el Dashboard necesita de esa tabla es:
--   1. Ventas/compras de HOY (conteo + total).
--   2. Los últimos 5 movimientos.
--   3. Un ranking de más/menos vendidos (esto sí necesita el histórico
--      completo — pero agregado por producto, no fila por fila).
--
-- Esta función hace esas 3 cosas EN LA BASE DE DATOS con `GROUP BY`/`COUNT`/
-- `SUM`/`LIMIT` — devuelve un JSON chiquito sin importar cuántas filas tenga
-- `transactions`, en vez de bajar la tabla entera al navegador para que el
-- JS la agregue ahí. Es una función normal (sin SECURITY DEFINER): corre
-- con los mismos permisos de quien la llama, así que respeta la política
-- RLS `transactions_select` tal cual ya la respetaba el SELECT directo que
-- hacía el cliente — ningún cambio de a quién se le muestra qué.
-- ═══════════════════════════════════════════════════════════════════════════

-- Índice para las 2 condiciones nuevas que se filtran seguido y que el
-- índice existente (company_id, created_at desc) no cubre bien: "ventas/
-- compras de HOY" (company_id + type + date) y "todas las ventas, para el
-- ranking" (company_id + type).
create index if not exists transactions_company_type_date_idx
  on public.transactions(company_id, type, date);

create or replace function public.dashboard_transactions_summary(
  p_company     uuid,
  p_client_date date default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_date date := coalesce(p_client_date, current_date);
  v_result jsonb;
begin
  select jsonb_build_object(
    'salesToday', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
      from public.transactions
      where company_id = p_company and type = 'venta' and date = v_date
    ),
    'purchasesToday', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
      from public.transactions
      where company_id = p_company and type = 'compra' and date = v_date
    ),
    'recent', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, type, date, product, sku, qty, total, client, supplier, created_at
        from public.transactions
        where company_id = p_company and type in ('venta', 'compra')
        order by created_at desc
        limit 5
      ) r
    ),
    -- Un renglón por SKU (o nombre, si no tiene SKU) con el total vendido —
    -- el ranking top/menos-vendidos en sí lo sigue armando el JS en
    -- DashboardModule.jsx (misma lógica de siempre), pero ahora ordenando
    -- ~cientos de productos en vez de potencialmente miles de transacciones.
    'topProductsAgg', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
        select coalesce(sku, product) as key, max(product) as name, sum(qty) as qty
        from public.transactions
        where company_id = p_company and type = 'venta'
        group by coalesce(sku, product)
      ) a
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.dashboard_transactions_summary(uuid, date) from public;
grant execute on function public.dashboard_transactions_summary(uuid, date) to authenticated;
