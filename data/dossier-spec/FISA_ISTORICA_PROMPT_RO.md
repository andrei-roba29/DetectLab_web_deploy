# Prompt – Fișă istorică completă pentru fiecare localitate din România

Vreau să construiești o bază de date istorică foarte riguroasă pentru **fiecare localitate din România**, tratând fiecare localitate ca o entitate geografică distinctă.

## 1. IDENTIFICAREA EXACTĂ A LOCALITĂȚII – PRIORITATE ABSOLUTĂ

Pentru fiecare localitate, identifică mai întâi fără echivoc localitatea la care se referă datele.

**NU te baza niciodată doar pe numele localității.**

Există numeroase localități omonime în România, inclusiv sate cu același nume în județe diferite sau chiar în aceeași zonă.

Pentru identificare folosește, în ordinea importanței:

1. Codul SIRUTA, dacă este disponibil;
2. județul;
3. UAT-ul / comuna / orașul / municipiul de care aparține;
4. coordonatele geografice;
5. tipul localității;
6. denumiri alternative sau istorice;
7. identificatori oficiali din alte baze de date;
8. orice alt identificator geografic unic disponibil.

### Regula fundamentală

Dacă există două sau mai multe localități cu același nume, tratează-le ca entități complet diferite.

Exemplu:

„Măgura, județul X, comuna Y”

NU trebuie confundată cu:

„Măgura, județul Z, comuna W”.

Dacă o sursă menționează doar „Măgura”, fără suficiente informații pentru identificarea localității, **nu atribui informația automat niciunei localități**.

Marchează informația ca:

`IDENTIFICARE INSUFICIENTĂ`

și caută surse suplimentare.

Nu transfera niciodată informații istorice de la o localitate omonimă către localitatea analizată.

---

# 2. IDENTITATEA LOCALITĂȚII

Pentru fiecare localitate furnizează:

* denumirea actuală;
* județul;
* comuna/UAT-ul;
* tipul localității:

  * sat;
  * localitate componentă;
  * comună;
  * oraș;
  * municipiu;
  * altă categorie oficială;
* cod SIRUTA;
* codul județului;
* coordonatele geografice ale localității;
* latitudine;
* longitudine;
* eventuale identificatoare geografice suplimentare;
* cod poștal, dacă este disponibil;
* localități învecinate, dacă informația este relevantă.

Dacă sunt disponibile mai multe coordonate, explică ce reprezintă fiecare:

* centrul localității;
* centrul administrativ;
* centroid;
* coordonata unui sit;
* coordonata unui monument etc.

Nu confunda coordonatele localității cu coordonatele unui sit arheologic aflat în raza ei.

---

# 3. DENUMIRI ISTORICE ȘI VARIANTE TOPONIMICE

Identifică toate variantele relevante ale numelui localității.

Include:

* denumirea actuală;
* prima formă cunoscută;
* variante medievale;
* variante în latină;
* variante germane;
* variante maghiare;
* variante slave;
* variante turcești, dacă există;
* variante austro-ungare;
* variante din hărți istorice;
* variante din documente administrative;
* variante ortografice;
* forme arhaice;
* forme regionale;
* eventuale denumiri dispărute.

Pentru fiecare variantă indică:

* forma numelui;
* perioada;
* sursa;
* contextul în care apare.

**Nu presupune că două nume asemănătoare desemnează aceeași localitate.**

Dacă există o schimbare oficială de nume, menționeaz-o separat de simplele variante ortografice.

---

# 4. PRIMA ATESTARE DOCUMENTARĂ

Identifică cea mai veche mențiune documentară cunoscută a localității.

Pentru aceasta furnizează:

* anul;
* forma exactă a numelui;
* tipul documentului;
* limba documentului;
* autorul / emitentul, dacă este cunoscut;
* contextul documentului;
* sursa bibliografică;
* linkul către sursa online, dacă există.

Foarte important:

**Nu considera automat că o dată prezentată pe un site este prima atestare documentară.**

Verifică dacă există surse mai vechi.

Dacă există o mențiune mai veche dar controversată, indică acest lucru explicit.

Separă:

* prima atestare documentară certă;
* cea mai veche mențiune posibilă;
* eventualele atestări controversate.

---

# 5. ISTORIA LOCALITĂȚII

Realizează o sinteză cronologică a istoriei localității.

Împarte informația pe perioade:

## Preistorie

Include doar informații documentate privind teritoriul localității.

## Antichitate

Separă, dacă este posibil:

* perioada dacică;
* perioada romană;
* perioada post-romană;
* migrații / perioada de tranziție.

## Evul Mediu timpuriu

## Evul Mediu

## Perioada modernă timpurie

## Secolele XVIII–XIX

## Perioada austro-ungară, acolo unde este relevant

## Primul Război Mondial

## Perioada interbelică

## Al Doilea Război Mondial

## Perioada comunistă

## Perioada post-1989

Pentru fiecare perioadă prezintă numai informațiile care pot fi atribuite cu suficientă certitudine localității respective.

---

# 6. ADMINISTRAȚIE ȘI APARTENENȚĂ TERITORIALĂ

Identifică schimbările administrative ale localității.

Include, dacă sunt disponibile:

* județele istorice;
* plăși;
* districte;
* comitate;
* regiuni;
* raioane;
* comune;
* UAT-uri;
* schimbări de apartenență administrativă;
* perioadele în care localitatea a aparținut fiecărei structuri.

Pentru fiecare schimbare indică:

`PERIOADĂ → STRUCTURĂ ADMINISTRATIVĂ`

Nu proiecta structura administrativă actuală asupra perioadelor istorice.

---

# 7. POPULAȚIE ȘI STRUCTURĂ ETNICĂ

Dacă există date istorice verificabile, include:

* populația;
* recensămintele;
* structura etnică;
* structura confesională;
* limbile utilizate;
* evoluția populației.

Menționează anul recensământului și sursa.

Nu transforma estimările în valori exacte.

---

# 8. MOȘII, PROPRIETARI ȘI FAMILII

Caută informații despre:

* moșii;
* domenii;
* proprietari;
* nobili;
* boieri;
* familii aristocratice;
* familii importante;
* instituții religioase care au deținut terenuri;
* schimbări de proprietate.

Pentru fiecare informație indică perioada și sursa.

---

# 9. CLĂDIRI ȘI OBIECTIVE ISTORICE

Identifică obiectivele istorice asociate localității:

* biserici;
* capele;
* mănăstiri;
* cetăți;
* fortificații;
* conace;
* castele;
* case istorice;
* mori;
* hanuri;
* poduri;
* drumuri istorice;
* cimitire;
* monumente funerare;
* cruci;
* monumente comemorative;
* alte construcții istorice.

Pentru fiecare obiectiv, dacă informația este disponibilă:

* denumire;
* tip;
* datare;
* perioadă istorică;
* descriere;
* stare actuală;
* coordonate;
* cod LMI;
* cod RAN;
* link CIMEC;
* alte identificatoare;
* sursa.

---

# 10. SITURI ARHEOLOGICE DE PE RAZA LOCALITĂȚII

Aceasta este o secțiune obligatorie și trebuie tratată separat de istoria generală a localității.

Caută în primul rând în:

**Repertoriul Arheologic Național (RAN / CIMEC)**

și în alte baze oficiale sau academice relevante.

Pentru **FIECARE sit arheologic asociat localității**, extrage:

### Identificare

* cod RAN;
* denumirea oficială a sitului;
* localitatea;
* comuna/UAT;
* județ;
* categoria;
* tipul sitului;
* componentele sitului.

### Cronologie

* epoca istorică;
* perioada;
* cultura arheologică;
* secolul / intervalul cronologic;
* cronologia exactă din RAN, dacă este disponibilă.

Nu simplifica excesiv cronologia.

Dacă RAN indică:

`Epoca medievală / sec. XIV-XV`

păstrează această informație.

### Descriere

Transcrie/parafrazează fidel descrierea sitului, fără inventarea unor informații absente din sursă.

Include:

* descrierea sitului;
* localizarea;
* contextul arheologic;
* componente;
* observații relevante.

### Localizare

Include:

* coordonate;
* latitudine;
* longitudine;
* precizia coordonatelor, dacă poate fi determinată;
* descrierea localizării.

Foarte important:

**Nu confunda coordonatele sitului cu coordonatele localității.**

### Legături

Pentru fiecare sit include:

* link direct către fișa RAN/CIMEC;
* cod RAN;
* link către hartă, dacă există;
* link către LMI, dacă există;
* alte linkuri oficiale relevante.

---

# 11. ÎNCADRAREA SITURILOR ÎN EPOCI

Pentru fiecare sit, creează și o clasificare standardizată.

Exemplu:

| Sit   | Cod RAN  | Epocă       | Perioadă        | Cultură    | Tip     |
| ----- | -------- | ----------- | --------------- | ---------- | ------- |
| Sit X | 12345.01 | Preistorie  | Epoca bronzului | Wietenberg | așezare |
| Sit Y | 12345.02 | Antichitate | sec. II–III     | Roman      | villa   |
| Sit Z | 12345.03 | Evul Mediu  | sec. XIV–XV     | —          | așezare |

Dacă sursa nu permite identificarea culturii, scrie:

`Necunoscut / nespecificat`

Nu deduce cultura doar pe baza perioadei.

---

# 12. SITURI AFLATE „PE RAZA LOCALITĂȚII”

Atenție deosebită la formularea „pe raza localității”.

Include siturile pe care RAN le atribuie explicit localității analizate.

Dacă un sit este foarte aproape de localitate, dar RAN îl atribuie unei alte localități:

**NU îl include automat.**

Poți crea o secțiune separată:

`Situri din vecinătatea localității`

dar numai dacă este clar că situl aparține altei localități.

Nu muta situri între localități pe baza proximității geografice.

---

# 13. LINKURI CIMEC / RAN

Pentru fiecare sit, obiectiv sau monument pentru care există o pagină oficială, oferă linkul direct.

Prioritizează:

1. RAN / CIMEC;
2. Institutul Național al Patrimoniului;
3. Lista Monumentelor Istorice;
4. instituții academice;
5. arhive;
6. biblioteci digitale;
7. surse secundare credibile.

Nu inventa niciodată URL-uri.

Dacă nu există un link direct, indică doar sursa și explică faptul că linkul direct nu a fost identificat.

---

# 14. HĂRȚI ȘI DOCUMENTE ISTORICE

Caută, atunci când sunt disponibile:

* hărți militare istorice;
* hărți habsburgice;
* hărți austro-ungare;
* hărți interbelice;
* planuri cadastrale;
* planuri urbane istorice;
* hărți administrative;
* hărți topografice vechi.

Pentru fiecare menționează:

* perioada;
* denumirea localității pe hartă;
* eventualele variante ale numelui;
* sursa;
* linkul.

---

# 15. TOPONIMIE ȘI MICROTOPONIMIE

Caută informații despre:

* numele satului;
* nume de dealuri;
* văi;
* pășuni;
* păduri;
* ape;
* puncte topografice;
* moșii;
* locuri dispărute;
* cătune;
* vetre vechi;
* drumuri istorice.

Acordă atenție specială microtoponimelor care pot indica:

* așezări dispărute;
* biserici dispărute;
* cimitire;
* fortificații;
* drumuri vechi;
* activități economice istorice.

**Nu interpreta un toponim ca dovadă archeologică.**

Dacă faci o interpretare, marcheaz-o clar ca ipoteză.

---

# 16. LOCALITĂȚI DISPĂRUTE ȘI CĂTUNE

Caută:

* sate dispărute;
* cătune dispărute;
* localități absorbite;
* localități redenumite;
* localități mutate;
* vetre vechi;
* așezări abandonate.

Pentru fiecare:

* denumire;
* localizare;
* perioadă;
* relația cu localitatea actuală;
* sursă;
* coordonate, dacă există;
* eventual cod RAN.

---

# 17. SURSE ȘI VERIFICAREA INFORMAȚIEI

Pentru fiecare afirmație istorică importantă identifică sursa.

Prioritatea surselor este:

**Nivel 1 – surse oficiale**

* RAN / CIMEC;
* INP;
* INS / SIRUTA;
* arhive;
* instituții publice;
* baze de date guvernamentale.

**Nivel 2 – surse academice**

* articole științifice;
* cărți;
* monografii;
* teze;
* volume arheologice;
* publicații universitare.

**Nivel 3 – surse locale**

* monografii locale;
* site-uri ale primăriilor;
* muzee locale;
* biblioteci județene;
* societăți istorice.

**Nivel 4 – surse secundare**

* Wikipedia;
* bloguri;
* site-uri turistice;
* forumuri etc.

Nu utiliza o sursă de nivel 4 pentru o afirmație importantă dacă există o sursă primară sau academică.

---

# 18. CONFLICTE ÎNTRE SURSE

Dacă două surse oferă informații diferite:

NU alege automat una dintre ele.

Prezintă:

* informația A;
* informația B;
* sursa fiecăreia;
* explicația posibilă a diferenței;
* nivelul de certitudine.

Exemplu:

`Prima atestare este indicată ca 1332 de sursa A, în timp ce sursa B indică 1334. Documentul original trebuie verificat pentru stabilirea formei corecte.`

---

# 19. NIVEL DE CERTITUDINE

Pentru informațiile istorice importante folosește:

🟢 **Cert** – susținut de surse primare/oficiale sau multiple surse independente.

🟡 **Probabil** – susținut de surse credibile, dar fără confirmare completă.

🟠 **Controversat** – există interpretări diferite.

🔴 **Ipoteză** – posibilitate istorică/arheologică care nu este demonstrată.

Nu transforma ipotezele în fapte.

---

# 20. REGULĂ STRICTĂ ÎMPOTRIVA HALUCINAȚIILOR

Nu inventa:

* ani;
* coordonate;
* coduri SIRUTA;
* coduri RAN;
* coduri LMI;
* denumiri istorice;
* situri;
* culturi arheologice;
* legături;
* documente;
* citate;
* proprietari;
* evenimente.

Dacă informația nu poate fi verificată, scrie:

`Nu a fost identificată o sursă verificabilă.`

Dacă nu există informații suficiente, este mai bine să lași câmpul necompletat decât să estimezi.

---

# 21. IDENTIFICAREA OMOMIMELOR – VERIFICARE FINALĂ

Înainte de a finaliza fișa, execută o verificare specială:

### CHECK 1

Numele localității corespunde?

### CHECK 2

Județul corespunde?

### CHECK 3

UAT-ul corespunde?

### CHECK 4

Codul SIRUTA corespunde?

### CHECK 5

Coordonatele corespund?

### CHECK 6

Siturile RAN sunt atribuite exact acestei localități?

### CHECK 7

Informațiile istorice provin din surse care se referă exact la această localitate?

Dacă oricare dintre aceste verificări eșuează, **nu atribui informația localității** până când identitatea nu este clarificată.

---

# 22. STRUCTURA FINALĂ A FIȘEI

Pentru fiecare localitate returnează informația în următoarea structură:

## [DENUMIRE LOCALITATE]

### Identitate

* Denumire:
* Județ:
* UAT:
* Tip:
* Cod SIRUTA:
* Coordonate:
* Latitudine:
* Longitudine:

### Denumiri istorice

* ...

### Prima atestare

* An:
* Formă istorică:
* Document:
* Sursă:

### Istorie

#### Preistorie

...

#### Antichitate

...

#### Evul Mediu

...

#### Perioada modernă

...

#### Secolele XIX–XX

...

#### Perioada contemporană

...

### Evoluție administrativă

...

### Populație

...

### Familii / proprietari / moșii

...

### Clădiri și monumente istorice

...

### Situri arheologice RAN

Pentru fiecare:

#### [Numele sitului]

* Cod RAN:
* Denumire:
* Categorie:
* Tip:
* Componente:
* Epocă:
* Perioadă:
* Cultură:
* Cronologie:
* Descriere:
* Coordonate:
* Latitudine:
* Longitudine:
* Cod LMI:
* Link RAN/CIMEC:
* Alte surse:

### Situri din vecinătate

Doar dacă aparțin explicit altor localități.

### Localități / cătune dispărute

...

### Toponimie istorică

...

### Hărți istorice

...

### Surse

Listează sursele utilizate și linkurile directe.

### Nivel general de certitudine

* Identificarea localității:
* Istoria localității:
* Situri arheologice:
* Toponimie:
* Alte informații:

---

# 23. REGULĂ FINALĂ

Obiectivul nu este să produci o descriere generică despre un nume de localitate.

Obiectivul este să produzi o **fișă istorică documentată a unei entități geografice unice**, identificată prin:

**LOCALITATE + JUDEȚ + UAT + SIRUTA + COORDONATE**

și să asociezi acelei entități numai informațiile istorice și arheologice care pot fi atribuite în mod verificabil acelei localități.

În cazul în care nu poți demonstra că o informație aparține localității respective, **nu o atribui localității**.
