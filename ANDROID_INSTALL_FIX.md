# Android: „Aplicația nesigură a fost blocată" (Google Play Protect)

## Cauza reală

DetectLab **nu are APK** — butonul „Aplicație Android" instalează PWA-ul. Mesajul

> Google Play Protect — Aplicația nesigură a fost blocată
> „Această aplicație a fost creată pentru o versiune Android mai veche și nu include cele mai
> recente măsuri de protecție a confidențialității."

apare pentru că pe Android fiecare browser care instalează un PWA **își construiește propriul
WebAPK** (un APK subțire, semnat, în care Android învelește aplicația web). Play Protect
avertizează dacă `targetSdkVersion` din acel APK este cu mai mult de 2 versiuni sub versiunea
Android a telefonului și poate bloca definitiv instalarea:

- Android 14 blochează instalarea APK-urilor cu `targetSdk < 23`
- Android 15/16 blochează instalarea APK-urilor cu `targetSdk < 24`

WebAPK-urile generate de **Chrome** (serviciul de „minting" al Google) sunt la zi și trec fără
avertisment. WebAPK-urile generate de **Samsung Internet** și de unele browsere OEM sunt construite
de canalul lor propriu, cu `targetSdkVersion` vechi — de aceea sunt raportate ca „nesigure" și
blocate. Este o problemă cunoscută, deschisă la Samsung din aprilie 2026 și încă nerezolvată:
[SamsungInternet/support#123](https://github.com/SamsungInternet/support/issues/123).

## Ce s-a schimbat în site

1. **Detectare browser + redirecționare spre Chrome** (`index.html`, secțiunea „Get the DetectLab
   App")
   - La apăsarea butonului „Aplicație Android" se detectează browserul (`SamsungBrowser`,
     `MiuiBrowser`, `HuaweiBrowser`, `UCBrowser`, Firefox etc.).
   - Pe browserele care generează WebAPK-ul blocat, utilizatorul **nu** mai este trimis să instaleze
     local: i se afișează un card cu pași clari și un buton **„Deschide în Chrome"** care folosește
     un link `intent://…#Intent;package=com.android.chrome;…` (cu `S.browser_fallback_url` pentru
     telefoanele fără Chrome).
   - Pe Chrome (unde instalarea nu este afectată) fluxul rămâne cel nativ: `beforeinstallprompt` →
     „Instalează aplicația".
2. **Card de ajutor** cu explicația avertismentului și soluția de avarie:
   „Mai multe detalii" → **„Instalează oricum"** (funcționează pe majoritatea telefoanelor care
   blochează WebAPK-ul, dar mesajul rămâne înfricoșător pentru utilizatori).
3. **Banner fix pe pagina deschisă în Chrome** (`?pwa=install`): după redirecționare, utilizatorul
   vede imediat butonul „Instalează DetectLab", iar marker-ul `?pwa=install` este eliminat din URL.
4. **Toate textele noi sunt traduse RO + EN** (`js/translations.js`), iar cardul/banner-ul se
   re-randează la schimbarea limbii.
5. **`manifest.json`**: adăugat `id` și `scope` (identitate stabilă a WebAPK-ului la actualizări) și
   eliminat `screenshots: []` (array gol, invalid).
6. **`sw.js`**: cache bump (`detectlab-v78-android-install-chrome`) + noile URL-uri versionate în
   lista de pre-cache, ca PWA-urile deja instalate să primească imediat fluxul nou.
7. **Test nou**: `node test-pwa-android-install.js` — verifică detectarea browserelor (Samsung
   Internet, Miui, Firefox, Chrome), cardul de redirecționare, fluxul nativ Chrome, linkul
   `intent://`, banner-ul `?pwa=install`, traducerile și manifestul/SW.

## Cum verifici

```bash
node test-pwa-android-install.js
```

Pe telefon:

1. Deschide site-ul în **Samsung Internet** și apasă „Aplicație Android" → trebuie să apară cardul
   cu „Deschide în Chrome".
2. Apasă butonul → se deschide Chrome cu banner-ul „Instalează DetectLab" → instalarea trece fără
   Play Protect.
3. Dacă vrei să testezi și bypass-ul: instalează din Samsung Internet și, la avertisment, apasă
   „Mai multe detalii" → „Instalează oricum".

## Ce nu se poate rezolva din site

- WebAPK-ul generat de Samsung Internet rămâne blocat până când Samsung își actualizează serviciul
  de generare; nu există setare în `manifest.json` care să schimbe `targetSdkVersion`-ul lui.
- Pe termen lung, singura soluție completă este publicarea în **Google Play** (Play App Signing):
  acolo `targetSdk` este controlat de tine, iar din **30 septembrie 2026** verificarea
  dezvoltatorilor se aplică etapizat și aplicațiilor distribuite în afara Play Store.
