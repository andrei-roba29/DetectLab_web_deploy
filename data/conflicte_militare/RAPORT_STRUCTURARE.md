# Baza de date a conflictelor militare de pe teritoriul României
**Sec. VIII î.Hr. – 1944** · generată din `batalii.csv` (28 de secole, de la 8 î.Hr. la 20 d.Hr.)

## Fișiere generate
| Fișier | Descriere |
|---|---|
| `conflicte_militare_romania.csv` | Tabelul principal (UTF-8 cu BOM, deschide corect în Excel/Sheets) |
| `conflicte_militare_romania.json` | Aceleași date în JSON (pentru aplicații web) |
| `conflicte_militare_romania.xlsx` | Excel cu 3 foi: Conflicte, Statistici, Dicționar |
| `RAPORT_STRUCTURARE.md` | Acest raport |

## Statistici
| Indicator | Valoare |
|---|---|
| Total evenimente | **198** |
| Pe teritoriul actual al României | 177 |
| Parțial (graniță / zona învecinată) | 9 |
| Context regional (participare românească, în afara granițelor) | 12 |
| Evenimente cu locație aproximativă (zona) | 159 |
| Evenimente cu coordonate | 198 |

## Structura unei înregistrări
| Câmp | Descriere |
|---|---|
| `titlu` | Numele bătăliei / conflictului |
| `tip` | Tipologia (bătălie, invazie, asediu, revoltă, bombardament etc.) |
| `data_start` / `data_end` | Datare umană; `c.` = circa |
| `an_start` / `an_end` | Numeric (negativ = î.Hr.), pentru sortare/filtrare |
| `secol` / `secol_n` | Secolul text și numeric |
| `locatie` | Localizare, iar unde nu se știe exact — zona aproximativă |
| `zona_aprox` | 0 = localizare relativ precisă, 1 = zonă aproximativă/incertă |
| `judet` / `regiune` | Județul actual și regiunea istorică |
| `lat` / `lng` | Coordonate aproximative WGS84 (pentru hartă) |
| `participanti` | Beligeranți normalizați în română |
| `descriere` | Context + desfășurare |
| `rezultat` | Cine a câștigat / consecințe |
| `teritoriu` | `da` / `partial` / `nu` (vezi mai jos) |
| `observatii` | Incertitudini de datare/locație |
| `sursa` | Secțiunea din `batalii.csv` de proveniență |

## Note metodologice
1. **Sursă unică de plecare**: coloana `REZULTAT` din `batalii.csv`, care conține, pentru fiecare secol, narativele conflictelor. Evenimentele au fost desfăcute în înregistrări individuale (de exemplu, „Războaiele Daco-Romane” → război 101–102, Tapae 101, Adamclisi, război 105–106, căderea Sarmizegetusei).
2. **Datare**: am păstrat datarea din sursă; unde era expresă, am păstrat ziua/luna (ex. 9–12 noiembrie 1330 pentru Posada). Unde sursa folosește „cca./aprox.”, am marcat cu `c.` și `zona_aprox`.
3. **Locație**: am adăugat județul actual și coordonate aproximative (WGS84) acolo unde toponimul este identificabil. Pentru evenimente fără localizare precisă (ex. Nedao, Posada, Rovine), locația este descrisă ca zonă aproximativă și marcată cu `zona_aprox=1`, iar disputele sunt consemnate în `observatii`.
4. **`teritoriu = nu`**: evenimente de context cu participare românească, dar desfășurate în afara granițelor actuale (ex. Naissus 269, Nicopole 1396, Mohács 1526, Hotin 1621, Turtucaia 1916). Nu sunt incluse în „baza de conflicte de pe teritoriu”, dar sunt utile pentru context.
5. **Diacritice**: fișierul `batalii.csv` a fost livrat în encoding cp1252 cu diacriticele pierdute (literele ă/â/î/ș/ț deveniseră `?`). Textul a fost re-romanizat pe baza contextului istoric și a toponimelor cunoscute; greșelile reziduale de diacritice trebuie verificate față de sursa originală.
6. **Surse secundare**: pentru completarea locațiilor, județelor și a diacriticelor am folosit cunoștințe istorice generale și toponimia standard; nu a fost folosită internetul în acest pas. Evenimentele cu datare/locație disputată sunt marcate în `observatii`.

## Evenimente cu datare sau locație disputată (de verificat)

- **RM-001** Conflicte inter-tribale pentru resurse (Cultura Basarabi) · c. -800 — Eveniment tip, fără nume proprii; distribuția spațială aproximativă.
- **RM-002** Incursiunile cimerienilor și ale pre-sciților · c. -800 — Fără izvoare scrise; datare pe bază de arheologie. Zona este aproximativă.
- **RM-003** Presiunea triburilor ilire în sud-vest · c. -800 — Zonă aproximativă; fără evenimente nominale.
- **RM-004** Conflicte inter-tribale geto-trace · c. -700 — Eveniment tip — nu există nume de confruntări.
- **RM-005** Expansiunea și invaziile sciților · c. -700 — Fără evenimente nominale.
- **RM-006** Întemeierea coloniei Histria și conflictele de coastă · c. -657 — Datarea întemeierii (c. 657 î.Hr.) este convențională.
- **RM-007** Conflictele dintre geți și coloniile grecești pontice · c. -600 — Eveniment tip, fără bătălii nominale.
- **RM-008** Incursiunile scitice la vest de Prut și în Câmpia Română · c. -600 — Zonă aproximativă.
- **RM-009** Războaie inter-tribale în Epoca Fierului (Hallstatt târziu) · c. -600 — Eveniment tip, fără nume proprii.
- **RM-010** Campania lui Darius I împotriva sciților (trecerea Dunării) · -513 — Datarea 513 î.Hr.; localizarea podului este aproximativă.
- **RM-011** Conflictele legate de coloniile grecești: distrugerea și refacerea Histriei · c. -500 — Datarea distrugerii este estimată pe baza arheologiei.
- **RM-012** Prăbușirea stăpânirii persane la nord de Balcani și conflictele de eliberare · c. -500 — Fără bătălii nominale; datare aproximativă.
- **RM-013** Invaziile scitice în Moldova și estul Transilvaniei · c. -500 — Eveniment tip, în baza dovezilor arheologice.
- **RM-014** Conflictele de frontieră dintre geți și Regatul Odris · c. -480 — Zonă aproximativă.
- **RM-015** Conflictul odriso-scitic de la Dunăre (Scyles vs. Sitalces) · c. -450 — Datare aproximativă (c. 450 î.Hr.).
- **RM-016** Expediția lui Alexandru cel Mare la nord de Dunăre · -335 — Localizarea exactă a trecerii este probabilă (zona Zimnicea).
- **RM-017** Dezastrul expediției lui Zopyrion · c. -331 — Datare aproximativă (c. 331–325 î.Hr.); locul uciderii nu este precis.
- **RM-018** Începutul războaielor dintre Lysimah și Dromichaetes · c. -320 — Evenimentul este reluat și mai detaliat la sec. III î.Hr.
- **RM-019** Pătrunderea triburilor celtice în Transilvania · c. -320 — Zonă aproximativă, fără bătălii nominale.
- **RM-020** Campania lui Agatocle împotriva geților (prima campanie a lui Lysimah) · -300 — Localizarea exactă a confruntării nu este cunoscută.
- **RM-021** Bătălia de la Helis și capturarea lui Lysimah · -292 — Datare cca. 292 î.Hr.; locația Helis este disputată.
- **RM-022** Invazia și conflictele cu celții (galații) · c. -280 — Fără bătălii nominale; zonele sunt aproximative.
- **RM-023** Războiul pentru Tomis (Histria și Callatis vs. Byzantion) · c. -260 — Datarea (c. 260 î.Hr.) este aproximativă.
- **RM-024** Protectoratele militare ale regilor geți asupra cetăților grecești · c. -260 — Eveniment tip, fără bătălii nominale.
- **RM-025** Conflictele cu bastarnii · c. -220 — Eveniment tip; zona aproximativă.
- **RM-026** Războaiele regelui Oroles împotriva bastarnilor · c. -200 — Datare convențională (începutul sec. II î.Hr.).
- **RM-027** Incursiunile scordiscilor în Câmpia Română și Dobrogea · c. -200 — Eveniment tip; zona aproximativă.
- **RM-028** Campaniile lui Rubobostes împotriva celților · c. -170 — Datare aproximativă pe baza contextului arheologic.
- **RM-029** Războiul lui Burebista împotriva celților (boii și tauriscii) · c. -60 — Datare aproximativă (c. 60–59 î.Hr.).
- **RM-030** Campania lui Burebista împotriva bastarnilor și sciților · c. -60 — Zonă aproximativă; fără bătălii nominale în sursă.
- **RM-031** Cucerirea orașelor grecești pontice de către Burebista · c. -55 — Datare aproximativă (55–48 î.Hr.).
- **RM-032** Implicarea lui Burebista în Războiul Civil Roman (context — nu pe teritoriul României) · -48 — Inclus pentru contextul istoric complet; nu este un conflict pe teritoriul actual al României.
- **RM-033** Războaiele interne de succesiune după moartea lui Burebista · -44 — Zonă aproximativă; fără bătălii nominale.
- **RM-034** Incursiunile dacilor transdanubieni în Moesia · c. -30 — Eveniment tip; zona aproximativă.
- **RM-035** Războiul lui Marcus Licinius Crassus în Dobrogea · -29 — Localizarea cetăților este aproximativă.
- **RM-036** Campania lui Sextus Aelius Catus la nord de Dunăre · c. 11 — Datare aproximativă (c. 11–12 d.Hr.).
- **RM-037** Campania lui Plautius Silvanus Aelianus peste Dunăre · c. 57 — Datare aproximativă; zona fără localizare precisă.
- **RM-039** Prima bătălie de la Tapae (Cornelius Fuscus) · 87 — Identificarea locației Tapae este disputată (Porțile de Fier ale Transilvaniei).
- **RM-040** A doua bătălie de la Tapae (Tettius Iulianus) · 88 — Identificarea locației Tapae este disputată.
- **RM-041** Pacea din 89 d.Hr. între Domițian și Decebal · 89 — Inclus pentru continuitatea cronologică a războaielor daco-romane.
- **RM-042** Bătălia de la Tapae (101) · 101 — Identificarea locației este disputată.
- **RM-047** Atacurile dacilor liberi și ale iazigilor asupra Daciei romane · 117 — Zonă aproximativă.
- **RM-052** Invazia carpilor (245–247) și abandonarea Limesului Transalutanus · 245 — Locația pe hartă este aproximativă (linia Transalutanus).
- **RM-053** Primul asediu al Sarmizegetusei (Ulpia Traiana) — invazia goților și a coalițiilor barbare · c. 248 — Datare aproximativă (cca. 248–249).
- **RM-055** Bătălia de la Naissus (context — în afara teritoriului României) · 269 — Inclus ca eveniment de context regional; nu s-a desfășurat pe teritoriul actual al României.
- **RM-056** Retragerea aureliană din Dacia · 271 — Eveniment de tip proces strategic, nu bătălie unică.
- **RM-057** Campaniile lui Constantin cel Mare împotriva goților și carpilor · 315 — Zonă aproximativă; fără bătălii nominale în sursă.
- **RM-058** Războiul sarmatic-gotic din 332 · 332 — Locația exactă a bătăliei nu este cunoscută.
- **RM-061** Războiul civil gotic dintre Athanaric și Fritigern · c. 370 — Datare aproximativă; zonă aproximativă.
- **RM-063** Războaiele defensive de pe limesul dunărean (Scythia Minor) · c. 400 — Eveniment tip, pe mai multe decenii.
- **RM-065** Bătălia de la râul Nedao și revolta gepizilor · 454 — Locația exactă a bătăliei este disputată; consecințele privesc direct teritoriul României.
- **RM-066** Conflictele ostrogoților cu gepizii · c. 455 — Zonă aproximativă; fără bătălii nominale.
- **RM-067** Incursiunile slave și proto-bulgare la Dunăre (începutul sec. VI) · c. 527 — Datare aproximativă a morții lui Chilbudios (c. 533).
- **RM-070** Campaniile lui Mauriciu la nord de Dunăre (bătăliile de pe Ialomița) · 591 — Locațiile exacte sunt aproximative.
- **RM-071** Conflictele de autoapărare ale comunităților locale (etnogeneza românească) · c. 600 — Eveniment tip; nu există nume de lupte sau lideri consemnați.
- **RM-072** Revolta armatei bizantine de la Dunăre (602) și prăbușirea limesului · 602 — Locația exactă a taberei nu este cunoscută.
- **RM-074** Conflictele interne post-avare din Transilvania · c. 626 — Eveniment tip, fără bătălii nominale.
- **RM-075** Bătălia de la Ongal (680) · 680 — Localizarea exactă a Ongalului este disputată (Delta Dunării / Basarabia).
- **RM-076** Conflictele de frontieră ale Kaganatului Avar (declinul avar) · c. 700 — Eveniment tip, fără bătălii nominale.
- **RM-077** Incursiunile de pradă asupra comunităților locale („veacurile întunecate”) · c. 700 — Eveniment tip, documentat arheologic.
- **RM-078** Campaniile lui Constantin al V-lea împotriva bulgarilor la Dunărea de Jos · 741 — Fără bătălii nominale pe teritoriul României (în afară de context).
- **RM-079** Bătălia de la Anchialos (context — în afara teritoriului României) · 763 — Inclus ca eveniment de context regional.
- **RM-080** Luptele pentru controlul minelor de sare și aur (sudul Transilvaniei și Banat) · c. 800 — Eveniment tip.
- **RM-081** Revolta triburilor din Dacia dunăreană împotriva bulgarilor · 824 — Identificarea triburilor și localizarea sunt discutabile.
- **RM-082** Invaziile pecenegilor în Etelköz (dislocarea maghiarilor) · c. 870 — Zona se află în mare parte în afara granițelor actuale ale României.
- **RM-083** Rezistența voievodatului lui Gelu împotriva maghiarilor · c. 896 — Sursa principală este Gesta Hungarorum (cronica din sec. XII), cu datare disputată de istoriografie.
- **RM-084** Rezistența voievodatului lui Glad (bătălia de la Mureș/Timiș) · c. 896 — Conform Gesta Hungarorum; reluat și la sec. X d.Hr.
- **RM-085** Rezistența voievodatului lui Menumorut — asediul Biharei · c. 896 — Conform Gesta Hungarorum; datare disputată.
- **RM-086** Asediul cetății Biharia (voievodatul lui Menumorut) · c. 900 — Conform Gesta Hungarorum.
- **RM-087** Bătălia de pe râul Almaș (voievodatul lui Gelu vs. Tuhutum) · c. 900 — Conform Gesta Hungarorum.
- **RM-088** Bătălia de pe râul Timiș (voievodatul lui Glad vs. maghiari) · c. 900 — Conform Gesta Hungarorum; datare disputată.
- **RM-089** Raidurile pecenegilor în regiunile extracarpatice · c. 900 — Eveniment tip.
- **RM-090** Invazia lui Sviatoslav la Dunărea de Jos (968–971) · 968 — Identificarea Pereiaslavețului cu Nufăru este probabilă, nu sigură.
- **RM-091** Campania lui Ioan Tzimiskes și asediul Dristorului · 971 — Dristorul este azi în Bulgaria, dar asediul s-a desfășurat imediat la granița Dobrogei românești.
- **RM-093** Războiul împotriva lui Ahtum (Banat) · c. 1003 — Datarea exactă este disputată (1003–1028 în sursă; majoritatea istoricilor: c. 1008).
- **RM-096** Revolta conducătorilor locali din Dobrogea (Tatos, Sestlav, Saca) · c. 1070 — Locațiile exacte (Vicina) sunt disputate.
- **RM-097** Cucerirea și consolidarea stăpânirii maghiare în Transilvania · c. 1100 — Proces pe un secol; nu este un singur conflict.
- **RM-098** Invaziile cumanilor și pecenegilor peste trecătorii Carpaților · c. 1100 — Eveniment tip.
- **RM-103** Dominația militară a lui Nogai Han în Dobrogea · c. 1271 — Eveniment de dominație, fără bătălii nominale în sursă.
- **RM-104** Revolta cneazului Litovoi · 1277 — Locația exactă a bătăliei nu este cunoscută.
- **RM-105** Revoltele sașilor și secuilor (ex. revolta lui Gylul, 1277) · c. 1277 — Eveniment tip, pe mai multe episoade.
- **RM-107** Bătălia de la Posada · 1330-11-09 — Localizarea exactă a locului bătăliei este disputată (Posada, în zona Lainici–Novaci).
- **RM-108** Bătălia de la Rovine · 1394 — Datarea exactă (1394/1395) este disputată; localizarea Rovine lor este controversată.
- **RM-109** Cruciada de la Nicopole (context — în afara teritoriului României) · 1396 — Inclus ca eveniment de context regional cu participare românească.
- **RM-110** Campaniile antiotomane ale lui Iancu de Hunedoara · 1440 — Bătăliile majore (Varna, Kosovo) au avut loc în afara teritoriului actual al României.
- **RM-111** Bătălia de la Sibiu (Vaskapu) · 1442-03-22 — Locația este disputată între zona Sibiel și trecătoarea Vaskapu (județul Hunedoara).
- **RM-112** Bătălia de la Sântimbru · 1442-03-18 — Faza inițială a conflictului; înfrângerea de la Sântimbru a fost urmată de victoriile de la Sibiu și pe Ialomița.
- **RM-113** Bătălia de pe Ialomița · 1442-09-02 — Locația exactă este disputată: unii istorici o plasează la Poarta de Fier a Transilvaniei (Zaicani), alții pe valea superioară a Ialomiței.
- **RM-116** Bătălia de la Lipnic · 1469-08-20 — Datarea este disputată între 20 august 1469 și 1470; localitatea se află azi în Republica Moldova.
- **RM-117** Bătălia de la Soci · 1471-03-07 — Locația este la granița dintre Moldova și Țara Românească (zona județului Bacău).
- **RM-120** Bătălia de la Câmpul Pâinii · 1479-10-13 — Locația câmpului de luptă se află între Șibot și Orăștie, pe luncă Mureșului; data este 13 octombrie 1479.
- **RM-121** Bătălia de la Râmnic (1481) · 1481-07-08 — Locația exactă este în zona Râmnicu Sărat, la poalele munților; datarea 8 iulie 1481.
- **RM-122** Bătălia de la Cătlăbuga · 1485-11-16 — Locația este în zona lacului Cătlăbuga, la granița cu Bugeacul (azi Ucraina); datarea 16 noiembrie 1485.
- **RM-123** Bătălia de la Șcheia · 1486-03-06 — Șcheia este localitatea de la circa 25 km nord de Roman, deși unele surse o plasează lângă Suceava.
- **RM-124** Bătălia de la Codrii Cosminului · 1497-10-26 — Câmpul de luptă se află azi în nordul Bucovinei (regiunea Cernăuți, Ucraina), la circa 100 km nord de Suceava; localizarea este aproximativă.
- **RM-125** Războaiele lui Radu de la Afumați (1522–1525) · 1522 — Inclus ca campanie (bătăliile individuale nu sunt detaliate în sursă).
- **RM-126** Bătălia de la Mohács (context — în afara teritoriului României) · 1526-08-29 — Inclus ca eveniment de context regional.
- **RM-128** Bătălia de la Obertyn · 1531-08-22 — Bătălia s-a dat în Pocuția (azi Ucraina), în afara granițelor actuale ale României.
- **RM-129** Bătălia de la Siret · 1538-02-01 — Datarea și locația exactă sunt discutate; lupta este legată de campania otomană din 1538.
- **RM-131** Bătălia de la Iezerul Cahulului · 1574-06 — Zona se află în afara granițelor actuale ale României (Republica Moldova).
- **RM-132** Bătălia de la Roșcani · 1574-06-11 — Eveniment subordonat revoltei lui Ioan Vodă cel Viteaz.
- **RM-133** Războaiele lui Ioan Vodă cel Viteaz — Bătălia de la Jiliște · 1574-04 — Localizarea exactă a bătăliei de la Jiliște este disputată.
- **RM-134** Bătălia de la Sânpaul · 1575-07-09 — Locația este în zona Sânpaul (județul Mureș).
- **RM-135** Revolta antiotomană și masacrul de la București (1594) · 1594-11-13 — Momentul de început al războaielor antiotomane ale lui Mihai Viteazul.
- **RM-138** Bătălia de la Putineiu · 1595-01-14 — Face parte din aceeași campanie ca Șerpătești și Stănești.
- **RM-139** Bătălia de la Stănești · 1595-01-25 — Face parte din campania de iarnă din 1595.
- **RM-140** Bătălia de la Târgoviște (1595) · 1595-10-05 — Urmează recucerirea Bucureștiului și bătălia de la Giurgiu (1595).
- **RM-141** Bătălia de la Șerpătești · 1595-01-23 — Împreună cu luptele de la Putineiu și Stănești fac parte din campania de iarnă 1595 a lui Mihai Viteazul.
- **RM-144** Bătălia de la Mirăslău · 1600-09-18 — Sursa îl menționează și la sec. XVII d.Hr. (recapitulare).
- **RM-147** Bătălia de la Hotin (1621) · 1621-09 — Hotinul este azi în Ucraina; inclus ca eveniment de la granița istorică a Moldovei.
- **RM-149** Bătălia de la Rabna · 1637 — Locația exactă a bătăliei este disputată.
- **RM-150** Bătălia de la Ojogeni · 1639 — Localizarea exactă a bătăliei este disputată.
- **RM-152** Bătălia de la Șoplea · 1655-06-26 — Una dintre cele mai cunoscute răscoale din Transilvania secolului al XVII-lea; bătălia finală a avut loc la Șoplea, azi în comuna Drăgănești (județul Prahova).
- **RM-155** Bătălia de la Sânmartin (1685) · 1685 — Localizarea exactă a bătăliei este disputată.
- **RM-160** Războiul Ruso-Turc (1768–1774) și ocupația Principatelor · 1768 — Bătăliile de la Larga și Cahul au avut loc în afara granițelor actuale ale României.
- **RM-162** Războiul Ruso-Turc (1806–1812) și anexarea Basarabiei · 1806 — Moștenirea teritorială a evenimentului privește și Republica Moldova de azi.
- **RM-166** Lupta de la Brad (1849) · 1849-02 — Se desfășoară în contextul războiului civil din Transilvania (1848–1849).
- **RM-167** Luptele de la Abrud (1849) · 1849-05 — Se desfășoară în contextul războiului civil din Transilvania (1848–1849).
- **RM-169** Bătălia de la Plevna · 1877-07 — Bătălia s-a desfășurat în afara teritoriului actual al României, dar este legată direct de Războiul de Independență.
- **RM-170** Luptele de la Grivița (1877) · 1877-08-30 — În afara granițelor actuale; parte din Războiul de Independență.
- **RM-171** Războiul de Independență (Russo-Turc 1877–1878) · 1877-04 — Luptele principale au avut loc în afara granițelor actuale (Bulgaria); trecerea Dunării și mobilizarea s-au desfășurat pe teritoriul românesc.
- **RM-172** Bătălia de la Smârdan · 1878-01-24 — În afara granițelor actuale; parte din Războiul de Independență.
- **RM-173** Bătălia de la Bazargic (1916) · 1916-09-05 — Bazargic se află la granița actuală dintre România și Bulgaria (Dobrogea de sud).
- **RM-174** Bătălia de la Brașov (1916) · 1916-10-07 — Parte din operația de apărare a trecătorilor din 1916.
- **RM-175** Bătălia de la Predeal (1916) · 1916-10 — Parte din operația de apărare a trecătorilor din 1916.
- **RM-176** Bătălia de la Sibiu (1916) · 1916-09-26 — Parte din operația de apărare a trecătorilor din 1916.
- **RM-177** Bătălia de la Turtucaia · 1916-09-02 — Turtucaia este azi în Bulgaria, imediat la frontiera cu România.
- **RM-178** Bătălia de la Târgu Jiu (1916) · 1916-11-16 — Parte din a doua bătălie de pe Valea Jiului și din apărarea Olteniei.
- **RM-181** Bătălia de pe Valea Prahovei (1916) · 1916-10-09 — Parte din operația de apărare a trecătorilor din 1916.
- **RM-182** Bătălia pentru București (1916) · 1916-11-30 — Parte din operația de apărare a teritoriului Munteniei.
- **RM-183** Operația de la Flămânda · 1916-09-29 — Operație de forțare a Dunării, abandonată din cauza lipsei de coordonare.
- **RM-184** Prima bătălie de la Oituz (1916) · 1916-10-12 — Urmează a doua bătălie de la Oituz (noiembrie 1916) și cea din 1917.

## Cum poate fi folosită
- **Excel**: filtrați după `Secol`, `Tip conflict` sau `Regiune istorică`.
- **Hartă**: folosiți coloanele `lat`/`lng` (unele coordonate sunt aproximative pentru evenimente preistorice/nomade — verificați `zona_aprox`).
- **Cronologie**: sortați după `an_start`/`an_end` (negativ = î.Hr.).
- **Aplicația DetectLab**: conținutul din `conflicte_militare_romania.json` poate fi încărcat ca dataset separat; nu trebuie importat în tabelul `public.events`, al cărui schema este destinat evenimentelor comunitare (creator_id, pin_id, etc.).
