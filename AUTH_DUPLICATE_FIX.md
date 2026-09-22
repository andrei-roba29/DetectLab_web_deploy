# Auth Duplicate Gmail Fix — 2026-09-22

## Bug Report
A user was able to:
1. Log in with Google (OAuth) using `xyz@gmail.com`
2. Then sign up again with same `xyz@gmail.com` via email/password form

Result:
- Two `auth.users` rows with same email (different IDs)
- Refresh token rotation collision → `refresh_token_not_found` / `already used`
- Frontend `isAuthErrorFatal()` treated it as fatal and called `signOut()`
- User was logged out after ~3 seconds every time

## Root Cause
- Supabase Auth by default allows same email via different providers if `enable_manual_linking=false` and no `before_user_created` hook
- No client-side check before `signUp`
- Startup validation treated token reuse as fatal, causing logout loop

## Fix — Multi-Layer Defense

### 1. Server-side hard guard (Supabase migration)
File: `supabase/migrations/20260922000000_prevent_duplicate_email.sql`

- `public.normalize_email(text)` — normalizes email:
  - lowercase + trim
  - Gmail: remove dots, strip `+tag`, unify `googlemail.com` → `gmail.com`
  - Prevents `j.o.h.n+spam@gmail.com` duplicating `john@gmail.com`

- `public.check_email_exists(p_email text)` — security definer RPC, returns bool
  - Callable from anon/authenticated for pre-signup UX
  - Uses normalized comparison

- `public.prevent_duplicate_email_hook(event jsonb)` — Auth hook `before_user_created`
  - Rejects signup with HTTP 409 if normalized email already exists
  - Message: "An account with this email already exists. Please log in with your original method..."

- `public.duplicate_emails` view — lists existing duplicates for admin cleanup

Grant:
- `check_email_exists` → anon, authenticated, service_role
- `prevent_duplicate_email_hook` → supabase_auth_admin only

### 2. Supabase config
File: `supabase/config.toml`

Enabled hook:
```toml
[auth.hook.before_user_created]
enabled = true
uri = "pg-functions://postgres/public/prevent_duplicate_email_hook"
```

For **production** (Supabase Cloud dashboard):
1. Go to Auth → Hooks → Add hook → Before User Created
2. Type: Postgres Function
3. Function: `public.prevent_duplicate_email_hook`
4. Or via SQL editor, run the migration file manually

### 3. Frontend guard (js/auth.js)
- `normalizeEmailClient()` — mirrors server normalization
- `checkEmailExists(email)` — calls `supabase.rpc('check_email_exists')`
- `isDuplicateEmailError()` — detects 409 / "already exists" messages
- `friendlyDuplicateMessage()` — user-friendly message suggesting Google vs password

**doRegister() now:**
1. Extracts fields (ultra-defensive)
2. Calls `checkEmailExists()` → if true, blocks and shows friendly message (no signup attempt)
3. Calls `signUp()` → if Supabase returns empty identities or 409, blocks
4. Handles hook error (409) with friendly message

**doLogin() now:**
- If invalid credentials and email exists → suggests "Continue with Google"
- If no account → suggests register

**authWithProvider() now:**
- Shows "Redirecting..." feedback
- Handles duplicate error with friendly message
- Requests offline access for Google

**Startup validation fix:**
- `isAuthErrorFatal()` no longer treats `refresh_token_not_found` / `already used` as fatal during startup
- New helper `isRefreshTokenReuseError()` preserves session on reuse errors
- Prevents 3-second logout loop for duplicate accounts and concurrent tabs
- Only 401/403/user_not_found still force signOut

### 4. OAuth error handling
- `openAuth()` and `window.load` now parse URL hash for `error_description`
- If duplicate, shows friendly message and re-opens login modal
- Cleans error params from URL

## How to clean existing duplicate (the reported user)

In Supabase SQL editor:

```sql
-- Find duplicates
select * from public.duplicate_emails;

-- For a specific email, see both accounts
select id, email, raw_user_meta_data->>'provider' as provider, created_at, last_sign_in_at
from auth.users
where public.normalize_email(email) = public.normalize_email('theuser@gmail.com')
order by created_at;

-- Decide which to keep (oldest usually has Google identity)
-- Delete the newer one (CAUTION: this deletes the user and cascades to profiles etc.)
-- Replace with actual ID to delete:

-- delete from auth.users where id = 'NEWER_USER_ID';

-- Alternative: if you want to keep both but merge, you need to manually link identities
-- Supabase does not auto-link; you can use auth.admin API or dashboard to link.

-- After deletion, the user should be able to log in without 3-sec logout.
```

For the reported user, the newest account (created via email/password after Google) should be deleted, keeping the Google account.

## Testing

1. Create account with Google (e.g. test@gmail.com)
2. Log out
3. Try to register with same test@gmail.com via email form
   - Expected: Immediate error "An account with this email already exists..."
   - No new row in auth.users
4. Try variants: `t.e.s.t@gmail.com`, `test+spam@gmail.com`, `test@googlemail.com`
   - Expected: All blocked (normalized to same)
5. Login with wrong password for Google-only account
   - Expected: Message suggesting Google login
6. Normal login should not logout after 3 seconds

## Deployment Checklist

- [ ] Apply migration `20260922000000_prevent_duplicate_email.sql` to production DB (via `supabase db push` or SQL editor)
- [ ] Enable Auth Hook in Supabase Cloud Dashboard (if not auto-enabled by migration)
- [ ] Deploy updated `js/auth.js` (cache-bust via `?v=20260922` if needed in index.html)
- [ ] Clean up existing duplicate for affected user via SQL above
- [ ] Monitor logs for `check_email_exists` RPC failures

## Future Improvements

- Implement account linking: If user tries Google login and password account exists, link identities instead of blocking (requires `enable_manual_linking=true` and custom UI)
- Add password reset flow that detects Google-only accounts and suggests Google login
- Add rate limiting on `check_email_exists` RPC to prevent enumeration (currently low risk)
