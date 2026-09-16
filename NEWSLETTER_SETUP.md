# DetectLab Newsletter — Setup complet

Acest ghid explică cum este legat checkbox-ul din formularul de înregistrare la baza de date și cum poți diferenția abonații de neabonați + cum trimiți primul newsletter.

---

## 1. Cum este legat checkbox-ul la DB

### Frontend
- **Checkbox HTML**: `index.html` → `id="regNewsletter"`  
  ```html
  <input type="checkbox" id="regNewsletter">
  <span>Subscribe to Newsletter (discounts and useful info)</span>
  ```
- **La sign-up**: `js/auth.js` → `doRegister()` citește `regNewsletter.checked` și îl trimite în `user_metadata`:
  ```js
  supabase.auth.signUp({
    email, password,
    options: { data: { full_name: name, newsletter_opt_in: !!(newsletterOptIn && newsletterOptIn.checked) } }
  })
  ```
  Dacă `newsletter_opt_in === true`, după sign-up se încearcă imediat persistarea prin:
  1. `POST /api/newsletter/subscribe` (backend, cu `Authorization: Bearer <supabase JWT>`) — calea principală, bypass RLS via `pool` (service_role / `DATABASE_URL`).
  2. Fallback direct: `supabase.from('profiles').upsert({ newsletter_subscribed: true })` (funcționează când migrația 013 este aplicată și RLS permite update pe propriul rând).
  - La log-in / reconectare, `_syncNewsletterFromSession(session)` re-împinge `newsletter_opt_in === true` dacă în DB este încă `false` (acoperă cazul când e-mailul a fost confirmat pe alt device sau trigger-ul nu a rulat încă).

### DB — sursa de adevăr
- **Tabel**: `public.profiles` (un rând per `auth.users.id`)
  - `newsletter_subscribed boolean NOT NULL DEFAULT false` — **GDPR opt-in**
  - `newsletter_subscribed_at timestamptz`
  - `newsletter_unsubscribed_at timestamptz`
  - index parțial `WHERE newsletter_subscribed = true` pentru interogări rapide
- **Trigger** (migrație `013_newsletter.sql` / `20260916000000_newsletter.sql`):
  ```sql
  create trigger trigger_sync_newsletter_on_user_insert
    after insert on auth.users
    for each row execute function sync_newsletter_from_user_metadata();
  ```
  Funcția citește `new.raw_user_meta_data->>'newsletter_opt_in'` și face `INSERT ... ON CONFLICT DO UPDATE` în `profiles`. Astfel, **chiar și fără cod client**, un user nou cu `newsletter_opt_in:true` apare în `profiles.newsletter_subscribed = true`.
- **View audiență**:
  ```sql
  select * from newsletter_audience; -- doar abonații (subscribed = true)
  ```

### Backend (canonic)
- **Migrație**: `backend/migrations/013_newsletter.sql` (rulează automat la `npm start` via `ensureDatabaseSchema()` / `runMigrations()`).
- **Serviciu**: `backend/src/services/newsletter.js` — `getSubscribedUsers()`, `setNewsletterSubscription()`, `getSubscriberCounts()`, `sendCampaign()`, `buildFirstNewsletter()`.
- **API** (montat în `backend/src/app.js` → `newsletterRouter`):
  - `GET /api/newsletter/health` (public) — counts
  - `GET /api/newsletter/status` (auth) — statusul user-ului curent
  - `POST /api/newsletter/subscribe` / `unsubscribe` / `toggle` (auth)
  - `GET /api/newsletter/subscribers?limit=200&subscribed=true|false` (auth + `x-admin-key`)
  - `POST /api/newsletter/send-first` (admin) — creează + trimite primul newsletter
  - `GET /api/newsletter/campaigns`, `POST /api/newsletter/campaigns`, `POST /api/newsletter/send`

### Frontend — gestionarea abonării după înregistrare
- **Panou Cont**: `index.html` → `#acctNewsletterWrap` (toggle + badge ABONAT/NEABONAT) — randat de `js/newsletter.js` + `js/account-legacy.js` (`renderNewsletterToggle()`).
- **Script**: `js/newsletter.js` expune `window.loadNewsletterStatus()`, `window.setNewsletterSubscribed(bool)`, `window.fetchNewsletterAudience()`.
- **One-click unsubscribe din e-mail**: link `{{unsubscribe_url}}` = `https://detectlab.ro/?unsubscribe=<USER_ID>` — handler în `js/newsletter.js` (`?unsubscribe=`) cheamă `POST /unsubscribe` dacă user-ul este logat.

---

## 2. Cum diferențiezi abonații de neabonați

### SQL direct (Supabase SQL Editor / `psql`)

```sql
-- Toți abonații (audiența pentru send)
select user_id, email, full_name, newsletter_subscribed_at
from newsletter_audience
order by newsletter_subscribed_at;

-- Counts rapide (pentru badge)
select
  count(*)::int as total,
  count(*) filter (where newsletter_subscribed)::int as abonati,
  count(*) filter (where not newsletter_subscribed)::int as neabonati
from profiles;

-- Listă completă cu status (diferențiere explicită)
select
  u.email,
  p.newsletter_subscribed,
  p.newsletter_subscribed_at,
  p.newsletter_unsubscribed_at,
  p.plan
from profiles p
join auth.users u on u.id = p.id
order by p.newsletter_subscribed desc, u.created_at desc;

-- Doar abonați / doar neabonați
select email from newsletter_audience; -- abonați
select u.email from profiles p join auth.users u on u.id=p.id where not p.newsletter_subscribed; -- neabonați
```

### API (pentru admin UI / scripturi)

```bash
# Health public (fără auth)
curl https://detectlab-backend-production.up.railway.app/api/newsletter/health

# Listă diferențiată (necesită JWT + x-admin-key dacă backend are INGESTION_ADMIN_KEY)
TOKEN=$(supabase auth token) # sau din browser: await supabaseClient.auth.getSession()
curl -H "Authorization: Bearer $TOKEN" \
     -H "x-admin-key: $INGESTION_ADMIN_KEY" \
     "https://detectlab-backend-production.up.railway.app/api/newsletter/subscribers?limit=200"

# Doar abonați
curl -H "Authorization: Bearer $TOKEN" -H "x-admin-key: $KEY" \
     "https://detectlab-backend-production.up.railway.app/api/newsletter/subscribers?subscribed=true"

# Doar neabonați
curl -H "Authorization: Bearer $TOKEN" -H "x-admin-key: $KEY" \
     "https://detectlab-backend-production.up.railway.app/api/newsletter/subscribers?subscribed=false"
```

### UI
- **Panou Cont** (fiecare user își vede propriul status): `ABONAT` / `NEABONAT` + toggle.
- **Admin**: deschide `newsletter-admin.html` (vezi secțiunea 3) → secțiunea *Audiență* → filtre `Doar abonați` / `Doar neabonați` + tabel + KPI.

---

## 3. Cum trimiți primul newsletter

### Opțiunea A — Admin UI (recomandat, fără terminal)
1. Deschide `https://detectlab.ro/newsletter-admin.html` (sau local `newsletter-admin.html`).
2. Loghează-te cu un cont DetectLab.
3. Dacă backend are `INGESTION_ADMIN_KEY` / `NEWSLETTER_ADMIN_KEY`, introdu cheia în câmpul *Admin key*.
4. Verifică *Audiență* → `📊` (counts) și *Abonați* (tabel).
5. Apasă **📤 Trimite primul newsletter** (secțiunea *Trimite newsletter* → *1) Primul newsletter*).
   - Creează campania `Bun venit în comunitatea DetectLab…` (HTML din `backend/src/services/newsletter.js → buildFirstNewsletter()`).
   - Trimite secvențial către toți `newsletter_subscribed = true` (personalizare `{{first_name}}`, `{{unsubscribe_url}}`).
   - Dacă `SMTP_HOST` / `RESEND_API_KEY` nu sunt setate, rulează în mod *logged-only* (marchează ca `sent` și loghează destinatarii — util pentru demo fără SMTP).
6. Vezi rezultatul: `recipients / sent / failed / loggedOnly` + tabel *Campanii recente*.

### Opțiunea B — API direct
```bash
TOKEN=... # JWT Supabase al unui user autentificat
curl -X POST https://detectlab-backend-production.up.railway.app/api/newsletter/send-first \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-admin-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
# Răspuns: { ok:true, campaign_id:"...", recipients:12, sent:12, failed:0, loggedOnly:false }
# Force resend dacă a fost deja trimis:
curl -X POST "https://detectlab-backend-production.up.railway.app/api/newsletter/send-first?force=true" ...
```

### Opțiunea C — CLI pe server (Railway / VPS)
```bash
# Dry run (verifică audiența + preview fără a trimite)
DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
npm run newsletter:dry-run
# sau: node backend/scripts/sendFirstNewsletter.js --dry-run

# Trimitere reală
DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
SMTP_HOST=smtp.example.com SMTP_USER=... SMTP_PASS=... SMTP_FROM="DetectLab <noreply@detectlab.ro>" \
npm run newsletter:send

# Cu Resend în loc de SMTP
RESEND_API_KEY=re_... NEWSLETTER_FROM="DetectLab <noreply@detectlab.ro>" \
npm run newsletter:send

# Fără SMTP/Resend → logged-only (marchează ca sent, loghează)
npm run newsletter:send

# Force resend
npm run newsletter:send:force
```

### Configurare e-mail (backend `env`)
* `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` / `NEWSLETTER_FROM` — via `nodemailer`
* sau `RESEND_API_KEY` + `NEWSLETTER_FROM` — via `https://api.resend.com/emails`
* `NEWSLETTER_SITE_URL` (default `STRIPE_SITE_URL` sau `https://detectlab.ro`) — pentru link-uri din template
* `INGESTION_ADMIN_KEY` / `NEWSLETTER_ADMIN_KEY` — protejează `GET /subscribers` și `POST /send-first` (dacă nu e setat, orice user autentificat poate trimite — util în dev)

### Ce conține primul newsletter
- **Subject**: `Bun venit în comunitatea DetectLab — noutăți, reduceri și hărți noi 🛰️`
- **Preview**: `Îți mulțumim că te-ai abonat! Iată ce urmează pe DetectLab și un mic cadou de bun venit.`
- **HTML**: header gradient, salut personalizat `Salut {{first_name}}!`, listă beneficii (hărți istorice, reduceri Premium exclusive, potențial arheologic, ghiduri), card cadou `BUNVENIT10` (-10% Premium 14 zile), CTA *Explorează harta*, footer GDPR cu `{{unsubscribe_url}}`.
- Fișier preview generat: `newsletter-preview.html` (poți deschide în browser).

### Audit / retry
- `public.newsletter_campaigns` — status `draft|sending|sent|failed`, `recipients_count`, `sent_count`, `failed_count`
- `public.newsletter_sends` — per-recipient `pending|sent|failed|skipped`, `error`
```sql
select email, status, error from newsletter_sends where campaign_id = '...' and status='failed';
```

---

## 4. Migrație & deploy

- Backend: la `npm start` rulează automat `runMigrations(pool)` → aplică `013_newsletter.sql` (idempotent). Verifică logs: `Applying migration 013_newsletter.sql`.
- Supabase Cloud: rulează `supabase db push` sau aplică manual `supabase/migrations/20260916000000_newsletter.sql` în SQL Editor. Alternativ, la următorul deploy cu migrații track-uite, se aplică automat.
- După migrație, orice cont nou cu checkbox bifat apare instant în `newsletter_audience`.

---

## 5. Testare rapidă (local, fără SMTP)

```bash
# 1. Aplică migrația pe DB local (necesită DATABASE_URL)
npm run migrate

# 2. Creează un user de test (în UI) cu checkbox bifat → verifică în DB
psql $DATABASE_URL -c "select email, newsletter_subscribed from profiles join auth.users using (id) order by created_at desc limit 5;"

# 3. Dry run newsletter
npm run newsletter:dry-run

# 4. Trimite logged-only (fără SMTP)
npm run newsletter:send

# 5. Verifică în admin UI: newsletter-admin.html → Campanii recente → status sent
```

---

## 6. Fișiere cheie

- `backend/migrations/013_newsletter.sql` + `supabase/migrations/20260916000000_newsletter.sql`
- `backend/src/services/newsletter.js` + `backend/src/routes/newsletter.js`
- `backend/scripts/sendFirstNewsletter.js`
- `js/auth.js` (legare checkbox → DB) + `js/newsletter.js` (toggle cont + unsubscribe)
- `index.html` (checkbox + panou cont newsletter) + `newsletter-admin.html` (diferențiere + send)
- `newsletter-preview.html` (previzualizare primul e-mail)

---

*Întrebări? Verifică `newsletter-admin.html` → `GET /health` sau logs backend `pino`.*
