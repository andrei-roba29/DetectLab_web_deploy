-- Prevent duplicate email signups (Google OAuth vs email/password)
-- Fixes bug where a user could log in with Google and then sign up again
-- with the same Gmail, creating two auth.users rows with the same email,
-- which then caused refresh-token collisions and logout after ~3 seconds.

-- 1) Normalize email for comparison
--    - Lowercase + trim
--    - For Gmail / Googlemail: remove dots, strip +tag, unify domain to gmail.com
--    This prevents j.o.h.n.d.o.e+test@gmail.com duplicating johndoe@gmail.com
create or replace function public.normalize_email(email text)
returns text
language plpgsql
immutable
as $$
declare
  v_email text;
  local_part text;
  domain_part text;
  plus_pos int;
begin
  if email is null then
    return null;
  end if;
  v_email := lower(trim(email));
  if v_email = '' then
    return '';
  end if;
  -- Basic sanity: must contain @
  if position('@' in v_email) = 0 then
    return v_email;
  end if;

  domain_part := split_part(v_email, '@', 2);
  local_part := split_part(v_email, '@', 1);

  if domain_part in ('gmail.com', 'googlemail.com') then
    plus_pos := position('+' in local_part);
    if plus_pos > 0 then
      local_part := substring(local_part from 1 for plus_pos - 1);
    end if;
    local_part := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  end if;

  return local_part || '@' || domain_part;
end;
$$;

comment on function public.normalize_email(text) is 'Normalize email for duplicate detection: lowercase, trim, Gmail dot/plus removal, googlemail→gmail.';

-- 2) Public RPC to check if an email is already taken
--    Used by the frontend before signUp to give a friendly error without
--    waiting for the auth hook to reject.
create or replace function public.check_email_exists(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_normalized text;
  v_exists boolean;
begin
  if p_email is null or trim(p_email) = '' then
    return false;
  end if;

  v_normalized := public.normalize_email(p_email);

  select exists (
    select 1 from auth.users
    where public.normalize_email(email) = v_normalized
  ) into v_exists;

  return coalesce(v_exists, false);
end;
$$;

comment on function public.check_email_exists(text) is 'Returns true if an auth.users row already exists with same normalized email. Used to prevent duplicate Google vs password signups.';

-- Allow anon and authenticated to call the check (needed before signup)
grant execute on function public.normalize_email(text) to anon, authenticated, service_role;
grant execute on function public.check_email_exists(text) to anon, authenticated, service_role;

-- 3) Auth hook: before_user_created
--    This is the server-side hard guard. Even if the client bypasses the check,
--    the signup will be rejected with 409.
--    Supabase Auth expects a function (event jsonb) -> jsonb
--    Returning { "error": { "message": "...", "http_code": 409 } } rejects the signup.
create or replace function public.prevent_duplicate_email_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_normalized text;
  v_exists boolean;
  v_provider text;
begin
  v_email := event->'user'->>'email';
  v_provider := coalesce(event->'user'->>'aud', '') || '/' || coalesce(event->>'provider', '');

  if v_email is null or trim(v_email) = '' then
    return event;
  end if;

  v_normalized := public.normalize_email(v_email);

  -- Check if normalized email already exists
  select exists (
    select 1 from auth.users
    where public.normalize_email(email) = v_normalized
  ) into v_exists;

  if v_exists then
    -- Return error object as per Supabase Auth hook spec
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'An account with this email (' || v_email || ') already exists. Please log in with your original method (Google or email/password) instead of creating a new account. If you signed up with Google, use "Continue with Google".',
        'http_code', 409
      )
    );
  end if;

  -- No duplicate, allow creation
  return event;
end;
$$;

comment on function public.prevent_duplicate_email_hook(jsonb) is 'Supabase Auth before_user_created hook: rejects signup if normalized email already exists, preventing Google + password duplicate accounts.';

-- Permissions: only supabase_auth_admin should execute the hook
grant execute on function public.prevent_duplicate_email_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.prevent_duplicate_email_hook(jsonb) from anon, authenticated, public;

-- 4) Optional helper view to detect existing duplicates (for admin cleanup)
--    Shows normalized email groups with >1 user
create or replace view public.duplicate_emails as
  select
    public.normalize_email(email) as normalized_email,
    array_agg(id) as user_ids,
    array_agg(email) as original_emails,
    count(*) as duplicate_count
  from auth.users
  where email is not null
  group by public.normalize_email(email)
  having count(*) > 1;

comment on view public.duplicate_emails is 'Admin view: lists normalized emails that have more than one auth.users row (Google vs password duplicates).';

-- Grant read on view to service_role only (admin)
grant select on public.duplicate_emails to service_role;
revoke all on public.duplicate_emails from anon, authenticated, public;

-- 5) Ensure profiles trigger does not create issues with duplicates
--    (Existing trigger sync_newsletter_from_user_metadata is idempotent, no change needed)
