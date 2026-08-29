-- ═══════════════════════════════════════════════════════════════════════════
-- 0018_enforce_subscription_active_employee_writes.sql
--
-- Vulnerabilidad corregida: el alta de empleados no validaba en el servidor
-- que la suscripción de la empresa estuviera activa. La UI ocultaba la
-- pantalla principal con PaywallScreen, pero:
--   1. El Panel (RolePanel → "Registrar Empleado") seguía montado en el DOM.
--   2. Nada en el backend/DB impedía el INSERT si alguien lo disparaba de
--      todas formas (ej. re-montando el componente, o llamando la RPC/
--      endpoint directo desde la consola).
--
-- Este archivo agrega la validación de suscripción en el ÚNICO lugar donde
-- realmente puede aplicarse desde SQL: la función join_company() (la usa el
-- flujo de "unirse a una empresa existente") y, como defensa en profundidad,
-- la policy de INSERT de public.users (por si algún día se inserta directo
-- desde el cliente sin pasar por una RPC).
--
-- OJO — IMPORTANTE: api/create-employee.js (el flujo real y principal de alta
-- de empleados) usa la SERVICE ROLE KEY, que por diseño de Supabase BYPASEA
-- RLS por completo — ninguna policy de esta tabla se evalúa para ese cliente.
-- Por eso el chequeo equivalente para ese camino se agregó DENTRO del propio
-- endpoint (api/create-employee.js), no acá. Esta migración cubre lo que SÍ
-- puede cubrir SQL: RPCs SECURITY DEFINER (que también bypasean RLS, así que
-- necesitan su propio "if not ... raise exception") y la policy para
-- cualquier insert directo del cliente autenticado normal.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: ¿la empresa tiene trial vigente o plan pagado vigente? ─────────
create or replace function public.is_subscription_active(p_company uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.subscriptions
    where company_id = p_company
      and (
        (status = 'trial'  and trial_ends_at is not null and trial_ends_at > now())
        or
        (status = 'active' and paid_until   is not null and paid_until   > now())
      )
  );
$$;
revoke all on function public.is_subscription_active(uuid) from public;
grant execute on function public.is_subscription_active(uuid) to authenticated;

-- ── join_company(): agregar el chequeo ANTES de insertar el perfil ────────
create or replace function public.join_company(
  p_company_id uuid,
  p_name       text,
  p_email      text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'La empresa no existe.';
  end if;

  -- Bloqueo estricto: sin suscripción activa (ni trial ni plan pagado
  -- vigente), nadie puede sumarse como empleado de esa empresa. errcode
  -- 42501 (insufficient_privilege) hace que PostgREST devuelva HTTP 403,
  -- no un 400/500 genérico.
  if not public.is_subscription_active(p_company_id) then
    raise exception 'La suscripción de esta empresa no está activa.'
      using errcode = '42501';
  end if;

  insert into public.users (id, company_id, name, email, role, permissions, active)
  values (v_uid, p_company_id, p_name, p_email, 'empleado', public.default_permissions(), true);
end;
$$;
revoke all on function public.join_company(uuid,text,text) from public;
grant execute on function public.join_company(uuid,text,text) to authenticated;

-- ── Defensa en profundidad: policy de INSERT de public.users ──────────────
-- Cubre el caso de un insert directo del cliente (fuera de las RPC), que
-- hoy no existe en el código pero podría agregarse en el futuro sin este
-- candado. No protege api/create-employee.js (ver nota arriba).
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert with check (
    auth.uid() = id
    and role in ('owner','empleado')
    and (
      (role = 'owner' and company_id = id)
      or
      (
        role = 'empleado'
        and company_id <> id
        and permissions = public.default_permissions()
        and public.is_subscription_active(company_id)
      )
    )
  );
