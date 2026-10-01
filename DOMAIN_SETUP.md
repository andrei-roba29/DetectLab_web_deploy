# Setup `detectlab.eu` (Cloudflare + Netlify)

Data pregătirii: 28 septembrie 2026.

## Arhitectura aleasă

- `https://detectlab.ro` — piața România, limba implicită română.
- `https://detectlab.eu` — piața europeană, limba implicită engleză.
- Ambele domenii servesc același deployment Netlify și aceeași bază de conturi.
- `www.detectlab.ro` redirecționează la `detectlab.ro`.
- `www.detectlab.eu` redirecționează la `detectlab.eu`.
- Domeniile apex `.ro` și `.eu` **nu** se redirecționează unul către celălalt.
- Harta pornește cu vederea existentă asupra României. Pe `detectlab.eu`
  deplasarea nu mai este limitată la acel dreptunghi; pe `detectlab.ro` harta
  rămâne blocată pe aria APM din România, exact ca înainte de varianta
  europeană (detalii în `MARKET_ISOLATION.md`).
- Varianta europeană (cele 25 de limbi din meniu, hărțile istorice CENAGIS /
  IH PAN, limitele europene ale straturilor) există **doar** pe
  `detectlab.eu`; `detectlab.ro` păstrează interfața și straturile dinaintea
  acesteia.

## Situația DNS observată înainte de configurare

`detectlab.eu` este delegat în registrul `.eu` către nameserverele Cloudflare
`finley.ns.cloudflare.com` și `meadow.ns.cloudflare.com`, dar acele servere
refuză zona. Rezultatul public este `SERVFAIL` (delegare nefuncțională).

Cauza probabilă: nameserverele au fost introduse la registrar înainte ca zona
`detectlab.eu` să fie adăugată în Cloudflare. Nu presupune că noua zonă va primi
aceeași pereche de nameservere ca `.ro`; trebuie folosită exact perechea afișată
de Cloudflare pentru `detectlab.eu`.

## 1. Adaugă domeniul în Cloudflare

1. Cloudflare Dashboard → **Domains** → **Onboard a domain**.
2. Introdu `detectlab.eu` (fără `www` și fără `https://`).
3. Selectează planul **Free**.
4. Continuă până când Cloudflare afișează cele două nameservere atribuite.
5. Copiază exact ambele valori.

Dacă DNSSEC este activ la registrar, dezactivează-l înainte de schimbarea
nameserverelor. Poate fi reactivat din Cloudflare după ce zona devine `Active`.

## 2. Corectează nameserverele la Host-Age

1. Cont client Host-Age → **Domenii**.
2. Deschide `detectlab.eu`.
3. Dacă DNSSEC este activ, dezactivează-l înainte de schimbarea nameserverelor.
4. Intră la **Nameservere** și selectează **Custom**.
5. Șterge vechile valori:
   - `finley.ns.cloudflare.com`
   - `meadow.ns.cloudflare.com`
6. Introdu exact nameserverele atribuite zonei `detectlab.eu` de Cloudflare:
   - `elias.ns.cloudflare.com`
   - `nelci.ns.cloudflare.com`
7. Salvează modificările.
8. Așteaptă până când Cloudflare marchează domeniul **Active**.

## 3. Adaugă domeniul la proiectul Netlify existent

1. Netlify → proiectul care servește `detectlab.ro`.
2. **Project configuration → Domain management → Production domains**.
3. **Add domain alias** și introdu `detectlab.eu`.
4. Păstrează `detectlab.ro` ca domeniu existent; nu configura redirect `.eu` →
   `.ro`.
5. Notează domeniul proiectului, de forma `<project-name>.netlify.app`.

Netlify va asocia de regulă și varianta `www.detectlab.eu`. Fișierul
`netlify.toml` din repository forțează numai canonicalizarea
`www.detectlab.eu` → `detectlab.eu` (și echivalentul `.ro`).

## 4. Creează înregistrările DNS în Cloudflare

Cloudflare → `detectlab.eu` → **DNS → Records**:

| Type | Name | Target | Proxy status | TTL |
|---|---|---|---|---|
| `CNAME` | `@` | `apex-loadbalancer.netlify.com` | `DNS only` | Auto |
| `CNAME` | `www` | `<project-name>.netlify.app` | `DNS only` | Auto |

Observații:

- Înlocuiește `<project-name>` cu numele real din Netlify.
- Nu include `https://` și nu adăuga `/` la finalul targetului.
- Șterge eventualele înregistrări A/AAAA/CNAME de parking care au același nume.
- Nu crea simultan CNAME și A pentru `@`.
- Păstrează înregistrările web `DNS only` permanent cât timp site-ul este
  găzduit pe Netlify. Mesajul Cloudflare „not fully protected” este un avertisment
  generic și poate fi ignorat în această arhitectură. Netlify oferă deja CDN,
  protecție DDoS și HTTPS și recomandă să nu fie pus proxy-ul/CDN-ul Cloudflare
  în fața serviciului său, deoarece dubla intermediere poate afecta verificarea
  DNS, emiterea/reînnoirea certificatului TLS și comportamentul cache-ului.

## 5. Activează HTTPS în Netlify

1. Revino la **Domain management**.
2. Așteaptă ca `detectlab.eu` și `www.detectlab.eu` să treacă verificarea DNS.
3. În secțiunea **HTTPS**, verifică emiterea certificatului Netlify/Let's Encrypt.
4. Activează **Force HTTPS** după emiterea certificatului.

## 6. Permite autentificarea Supabase de pe `.eu`

Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs**:

- adaugă `https://detectlab.eu/**`;
- adaugă `https://www.detectlab.eu/**` (variantă de siguranță înainte de redirect);
- păstrează intrările existente pentru `.ro` și preview/dezvoltare.

Frontendul construiește redirectul OAuth din `window.location.origin`, deci
fără allowlist Supabase autentificarea inițiată de pe `.eu` poate fi refuzată
sau trimisă pe alt origin.

## 7. Configurează backendul Railway pentru ambele domenii

Adaugă/actualizează variabila serviciului backend:

```env
FRONTEND_ORIGINS=https://detectlab.ro,https://www.detectlab.ro,https://detectlab.eu,https://www.detectlab.eu
STRIPE_SITE_URL=https://detectlab.ro
```

`STRIPE_SITE_URL` rămâne doar fallback. Pentru un checkout pornit de pe un
origin din `FRONTEND_ORIGINS`, backendul folosește acel origin pentru
`success_url`, `cancel_url` și revenirea din portalul Stripe.

După modificare, redeploy backendul Railway.

## 8. Configurează `contact@detectlab.eu` prin Cloudflare Email Routing

După ce zona este `Active`:

1. Cloudflare → **Compute / Email Service → Email Routing**.
2. Selectează `detectlab.eu` și pornește onboarding-ul.
3. Acceptă înregistrările MX și TXT propuse automat de Cloudflare.
4. La **Destination Addresses**, adaugă adresa personală la care vrei să ajungă
   mesajele și confirmă linkul primit pe e-mail.
5. La **Routing Rules**, creează:
   - Custom address: `contact@detectlab.eu`
   - Action: **Send to an email**
   - Destination: adresa verificată.
6. Trimite un mesaj de test dintr-o altă căsuță.

Email Routing asigură primirea/redirecționarea mesajelor. Trimiterea mesajelor
*ca* `contact@detectlab.eu` necesită separat un serviciu SMTP/mailbox care
permite acest alias.

## 9. Verificări după propagare

- `https://detectlab.eu/` se încarcă fără eroare de certificat.
- Prima vizită pe `.eu` pornește în engleză.
- Prima vizită pe `.ro` pornește în română.
- Alegerea manuală a limbii este memorată separat pe fiecare origin.
- Harta poate fi deplasată în afara limitelor României **pe `.eu`**; pe `.ro`
  rămâne blocată pe aria APM din România (comportamentul anterior).
- Meniul de limbi de pe `.ro` conține doar RO/EN; cel de pe `.eu` conține
  toate cele 25 de limbi.
- Straturile CENAGIS / IH PAN (Hărți Istorice Europene) apar doar în panoul
  de pe `.eu`.
- `https://www.detectlab.eu/...` redirecționează la același path pe apex.
- Login e-mail și OAuth revin pe domeniul de pornire.
- Un checkout Stripe de test pornit pe `.eu` revine pe `.eu/checkout.html`.
- `contact@detectlab.eu` livrează mesajul către destinația verificată.

## Limitări funcționale curente

Eliminarea limitei de pan permite navigarea europeană, dar nu extinde automat
seturile de date. Straturile APM, UAT, Patrimoniu, multe hărți istorice, LIDAR
și unele analize își păstrează acoperirea reală din România. Pe măsură ce se
adaugă regiuni europene, fiecare sursă trebuie configurată cu propriul URL,
bounds, atribuire, licență și comportament de indisponibilitate în afara
acoperirii.
