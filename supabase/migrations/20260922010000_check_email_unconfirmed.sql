-- Returns true only if an auth.users row exists with the same normalized email
-- AND the address has not been confirmed yet (email_confirmed_at IS NULL).
-- Used by the login form to show a manual "resend confirmation" trigger.
create or replace function public.check_email_unconfirmed(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_normalized text;
  v_unconfirmed boolean;
begin
  if p_email is null or trim(p_email) = '' then
    return false;
  end if;

  v_normalized := public.normalize_email(p_email);

  select exists (
    select 1 from auth.users
    where public.normalize_email(email) = v_normalized
      and email_confirmed_at is null
  ) into v_unconfirmed;

  return coalesce(v_unconfirmed, false);
end;
$$;

comment on function public.check_email_unconfirmed(text) is
  'Returns true if the normalized email exists on an unconfirmed auth.users row.';

grant execute on function public.check_email_unconfirmed(text) to anon, authenticated, service_role;
