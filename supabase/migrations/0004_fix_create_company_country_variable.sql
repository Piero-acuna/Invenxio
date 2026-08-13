-- Aplicada en producción el 2026-08-12 (antes de esta sesión de revisión).
-- Se documenta acá para que el repo refleje exactamente el historial real
-- de la base de datos (ver `supabase migration list` / list_migrations).
create or replace function public.create_company(
  p_company_name text,
  p_country       text default 'PE',
  p_owner_name    text default 'Propietario',
  p_owner_email   text default ''
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gateway text;
  v_currency_code text;
  v_currency_symbol text;
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;

  if p_country = 'PE' then
    v_gateway := 'culqi'; v_currency_code := 'PEN'; v_currency_symbol := 'S/';
  else
    v_gateway := 'mercadopago'; v_currency_code := 'USD'; v_currency_symbol := '$';
  end if;

  insert into public.companies (id, owner_id, name, plan, country, payment_gateway, currency_code, currency_symbol)
  values (v_uid, v_uid, p_company_name, 'free', coalesce(p_country,'OTHER'), v_gateway, v_currency_code, v_currency_symbol);

  insert into public.users (id, company_id, name, email, role, permissions, active)
  values (v_uid, v_uid, p_owner_name, p_owner_email, 'owner', '{}'::jsonb, true);

  insert into public.subscriptions (company_id, status, plan, trial_ends_at, payment_gateway, currency_code)
  values (v_uid, 'trial', 'trial', now() + interval '14 days', v_gateway, v_currency_code);

  return v_uid;
end;
$$;
revoke all on function public.create_company(text,text,text,text) from public;
grant execute on function public.create_company(text,text,text,text) to authenticated;
