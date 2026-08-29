-- ═══════════════════════════════════════════════════════════════════════════
-- audit_rls_coverage.sql — NO es una migración, es una consulta de auditoría.
-- Pégala en el SQL Editor de Supabase cuando quieras (re)confirmar que
-- ninguna tabla de negocio quedó sin RLS activo — la única forma en que un
-- IDOR de tipo "cambiar company_id/producto_id en la petición" podría
-- colarse pese a todo lo demás.
--
-- Qué hace:
--   1. Lista toda tabla de public que tenga una columna company_id (es
--      decir, toda tabla multi-tenant de este proyecto) y muestra si
--      rowsecurity está en TRUE.
--   2. Cuenta cuántas policies tiene cada una — 0 policies + RLS activo =
--      tabla bloqueada para todos (fail-closed, seguro); RLS
--      desactivado = fail-open (inseguro, alerta roja).
-- ═══════════════════════════════════════════════════════════════════════════

select
  t.tablename,
  t.rowsecurity as rls_activo,
  coalesce(p.policy_count, 0) as cantidad_de_policies,
  case
    when not t.rowsecurity then '🔴 RLS DESACTIVADO — cualquier fila es visible/editable por cualquiera'
    when coalesce(p.policy_count, 0) = 0 then '🟡 RLS activo pero SIN policies (bloqueado para todos, revisar si es intencional)'
    else '🟢 OK'
  end as estado
from pg_tables t
join information_schema.columns c
  on c.table_schema = t.schemaname and c.table_name = t.tablename and c.column_name = 'company_id'
left join (
  select tablename, count(*) as policy_count
  from pg_policies
  where schemaname = 'public'
  group by tablename
) p on p.tablename = t.tablename
where t.schemaname = 'public'
order by t.rowsecurity asc, t.tablename;

-- ── Bonus: policies que NO referencian has_perm/is_owner/is_same_company ──
-- (o sea, cualquier policy "manual" que alguien haya escrito distinto al
-- patrón estándar del proyecto — vale la pena revisarla a mano).
select schemaname, tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and qual is not null
  and qual !~ 'has_perm|is_owner|is_same_company|auth\.uid'
order by tablename;
