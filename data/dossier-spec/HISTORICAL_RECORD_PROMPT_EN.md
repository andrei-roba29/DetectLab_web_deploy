# Prompt – Complete Historical Record for Every Locality in Romania

Build a highly rigorous historical database for **every locality in Romania**, treating each locality as a distinct geographical entity.

## 1. EXACT IDENTIFICATION OF THE LOCALITY – ABSOLUTE PRIORITY

For every locality, first identify beyond any doubt which locality the data refers to.

**NEVER rely on the locality name alone.**

There are numerous homonymous localities in Romania, including villages sharing the same name in different counties or even in the same area.

For identification use, in order of importance:

1. the SIRUTA code, if available;
2. the county;
3. the UAT / commune / town / municipality it belongs to;
4. the geographic coordinates;
5. the locality type;
6. alternative or historical names;
7. official identifiers from other databases;
8. any other unique geographic identifier available.

### The fundamental rule

If two or more localities share the same name, treat them as completely different entities.

Example:

“Măgura, county X, commune Y”

MUST NOT be confused with:

“Măgura, county Z, commune W”.

If a source mentions only “Măgura”, without enough information to identify the locality, **do not automatically assign the information to any locality**.

Mark the information as:

`INSUFFICIENT IDENTIFICATION`

and look for additional sources.

Never transfer historical information from a homonymous locality to the locality under analysis.

---

# 2. LOCALITY IDENTITY

For every locality provide:

* the current name;
* the county;
* the commune/UAT;
* the locality type:

  * village;
  * component locality;
  * commune;
  * town;
  * municipality;
  * another official category;
* the SIRUTA code;
* the county code;
* the geographic coordinates of the locality;
* latitude;
* longitude;
* any additional geographic identifiers;
* the postal code, if available;
* neighbouring localities, if the information is relevant.

If several coordinates are available, explain what each represents:

* the locality centre;
* the administrative centre;
* the centroid;
* the coordinate of a site;
* the coordinate of a monument, etc.

Do not confuse the coordinates of the locality with the coordinates of an archaeological site located within its bounds.

---

# 3. HISTORICAL NAMES AND TOPONYMIC VARIANTS

Identify all relevant variants of the locality name.

Include:

* the current name;
* the earliest known form;
* medieval variants;
* Latin variants;
* German variants;
* Hungarian variants;
* Slavic variants;
* Turkish variants, if any;
* Austro-Hungarian variants;
* variants from historical maps;
* variants from administrative documents;
* spelling variants;
* archaic forms;
* regional forms;
* any vanished names.

For each variant indicate:

* the form of the name;
* the period;
* the source;
* the context in which it appears.

**Do not assume that two similar names designate the same locality.**

If there was an official name change, mention it separately from mere spelling variants.

---

# 4. FIRST DOCUMENTARY ATTESTATION

Identify the oldest known documentary mention of the locality.

For it provide:

* the year;
* the exact form of the name;
* the type of document;
* the language of the document;
* the author / issuer, if known;
* the context of the document;
* the bibliographic source;
* the link to the online source, if one exists.

Very important:

**Do not automatically treat a date presented on a website as the first documentary attestation.**

Check whether older sources exist.

If an older but controversial mention exists, state this explicitly.

Separate:

* the certain first documentary attestation;
* the oldest possible mention;
* any controversial attestations.

---

# 5. THE HISTORY OF THE LOCALITY

Produce a chronological synthesis of the locality's history.

Organise the information by periods:

## Prehistory

Include only documented information about the locality's territory.

## Antiquity

Separate, if possible:

* the Dacian period;
* the Roman period;
* the post-Roman period;
* migrations / transition period.

## Early Middle Ages

## Middle Ages

## Early modern period

## The 18th–19th centuries

## The Austro-Hungarian period, where relevant

## World War I

## The interwar period

## World War II

## The communist period

## The post-1989 period

For each period present only the information that can be attributed to that locality with sufficient certainty.

---

# 6. ADMINISTRATION AND TERRITORIAL AFFILIATION

Identify the administrative changes of the locality.

Include, if available:

* historical counties;
* plăși (districts);
* districts;
* counties (comitats);
* regions;
* raions;
* communes;
* UATs;
* changes of administrative affiliation;
* the periods during which the locality belonged to each structure.

For each change indicate:

`PERIOD → ADMINISTRATIVE STRUCTURE`

Do not project the current administrative structure onto historical periods.

---

# 7. POPULATION AND ETHNIC STRUCTURE

If verifiable historical data exist, include:

* the population;
* censuses;
* the ethnic structure;
* the confessional structure;
* languages used;
* population evolution.

Mention the census year and the source.

Do not turn estimates into exact values.

---

# 8. ESTATES, OWNERS AND FAMILIES

Look for information about:

* estates;
* domains;
* owners;
* nobles;
* boyars;
* aristocratic families;
* important families;
* religious institutions that held land;
* changes of ownership.

For each piece of information indicate the period and the source.

---

# 9. HISTORIC BUILDINGS AND OBJECTIVES

Identify the historical objectives associated with the locality:

* churches;
* chapels;
* monasteries;
* fortresses;
* fortifications;
* manors;
* castles;
* historic houses;
* mills;
* inns;
* bridges;
* historic roads;
* cemeteries;
* funerary monuments;
* crosses;
* commemorative monuments;
* other historic constructions.

For each objective, if the information is available:

* name;
* type;
* dating;
* historical period;
* description;
* current condition;
* coordinates;
* LMI code;
* RAN code;
* CIMEC link;
* other identifiers;
* the source.

---

# 10. ARCHAEOLOGICAL SITES WITHIN THE LOCALITY'S BOUNDS

This is a mandatory section and must be treated separately from the general history of the locality.

Search first in:

**the National Archaeological Repertory (RAN / CIMEC)**

and in other relevant official or academic databases.

For **EVERY archaeological site associated with the locality**, extract:

### Identification

* RAN code;
* official name of the site;
* the locality;
* the commune/UAT;
* the county;
* the category;
* the site type;
* the components of the site.

### Chronology

* historical epoch;
* period;
* archaeological culture;
* century / chronological interval;
* the exact chronology from RAN, if available.

Do not oversimplify the chronology.

If RAN states:

`Medieval period / 14th–15th c.`

keep that information.

### Description

Transcribe/faithfully paraphrase the site description, without inventing information absent from the source.

Include:

* the site description;
* the location;
* the archaeological context;
* components;
* relevant observations.

### Location

Include:

* coordinates;
* latitude;
* longitude;
* the precision of the coordinates, if it can be determined;
* the location description.

Very important:

**Do not confuse the site coordinates with the locality coordinates.**

### Links

For each site include:

* direct link to the RAN/CIMEC record page;
* RAN code;
* link to a map, if one exists;
* link to the LMI, if one exists;
* other relevant official links.

---

# 11. CLASSIFICATION OF SITES BY EPOCH

For each site, also create a standardised classification.

Example:

| Site  | RAN code | Epoch       | Period          | Culture    | Type    |
| ----- | -------- | ----------- | --------------- | ---------- | ------- |
| Site X | 12345.01 | Prehistory  | Bronze Age      | Wietenberg | settlement |
| Site Y | 12345.02 | Antiquity   | 2nd–3rd c.      | Roman      | villa   |
| Site Z | 12345.03 | Middle Ages | 14th–15th c.    | —          | settlement |

If the source does not allow the culture to be identified, write:

`Unknown / not specified`

Do not deduce the culture merely from the period.

---

# 12. SITES LOCATED “WITHIN THE LOCALITY'S BOUNDS”

Pay special attention to the phrase “within the locality's bounds”.

Include only the sites that RAN explicitly assigns to the analysed locality.

If a site is very close to the locality, but RAN assigns it to a different locality:

**Do NOT include it automatically.**

You may create a separate section:

`Sites in the vicinity of the locality`

but only when it is clear that the site belongs to another locality.

Do not move sites between localities on the basis of geographic proximity.

---

# 13. CIMEC / RAN LINKS

For every site, objective or monument that has an official page, provide the direct link.

Prioritise:

1. RAN / CIMEC;
2. the National Heritage Institute (INP);
3. the List of Historical Monuments (LMI);
4. academic institutions;
5. archives;
6. digital libraries;
7. credible secondary sources.

Never invent URLs.

If no direct link exists, state only the source and explain that a direct link was not identified.

---

# 14. MAPS AND HISTORICAL DOCUMENTS

Look, when available, for:

* historical military maps;
* Habsburg maps;
* Austro-Hungarian maps;
* interwar maps;
* cadastre plans;
* historic urban plans;
* administrative maps;
* old topographic maps.

For each one mention:

* the period;
* the name of the locality on the map;
* any variants of the name;
* the source;
* the link.

---

# 15. TOPONYMY AND MICROTOPONYMY

Look for information about:

* the name of the village;
* hill names;
* valleys;
* pastures;
* forests;
* waters;
* topographic points;
* estates;
* vanished places;
* hamlets;
* old village cores;
* historic roads.

Pay special attention to microtoponyms that may indicate:

* vanished settlements;
* vanished churches;
* cemeteries;
* fortifications;
* old roads;
* historic economic activities.

**Do not interpret a toponym as archaeological evidence.**

If you make an interpretation, clearly mark it as a hypothesis.

---

# 16. VANISHED LOCALITIES AND HAMLETS

Look for:

* vanished villages;
* vanished hamlets;
* absorbed localities;
* renamed localities;
* relocated localities;
* old village cores;
* abandoned settlements.

For each one:

* name;
* location;
* period;
* the relationship to the current locality;
* source;
* coordinates, if any;
* RAN code, where applicable.

---

# 17. SOURCES AND VERIFICATION OF INFORMATION

For every important historical statement identify the source.

The priority of sources is:

**Level 1 – official sources**

* RAN / CIMEC;
* INP;
* INS / SIRUTA;
* archives;
* public institutions;
* governmental databases.

**Level 2 – academic sources**

* scientific articles;
* books;
* monographs;
* theses;
* archaeological volumes;
* university publications.

**Level 3 – local sources**

* local monographs;
* town-hall websites;
* local museums;
* county libraries;
* historical societies.

**Level 4 – secondary sources**

* Wikipedia;
* blogs;
* tourist sites;
* forums, etc.

Do not use a level-4 source for an important statement if a primary or academic source exists.

---

# 18. CONFLICTS BETWEEN SOURCES

If two sources offer different information:

Do NOT automatically choose one of them.

Present:

* information A;
* information B;
* the source of each;
* the possible explanation of the difference;
* the level of certainty.

Example:

`The first attestation is given as 1332 by source A, while source B gives 1334. The original document must be checked to establish the correct form.`

---

# 19. LEVEL OF CERTAINTY

For important historical information use:

🟢 **Certain** – supported by primary/official sources or multiple independent sources.

🟡 **Probable** – supported by credible sources, but without complete confirmation.

🟠 **Controversial** – different interpretations exist.

🔴 **Hypothesis** – a historical/archaeological possibility that is not demonstrated.

Do not turn hypotheses into facts.

---

# 20. STRICT RULE AGAINST HALLUCINATIONS

Do not invent:

* years;
* coordinates;
* SIRUTA codes;
* RAN codes;
* LMI codes;
* historical names;
* sites;
* archaeological cultures;
* links;
* documents;
* quotes;
* owners;
* events.

If the information cannot be verified, write:

`No verifiable source was identified.`

If insufficient information exists, it is better to leave the field empty than to estimate.

---

# 21. HOMONYM IDENTIFICATION – FINAL CHECK

Before finalising the record, run a special check:

### CHECK 1

Does the locality name match?

### CHECK 2

Does the county match?

### CHECK 3

Does the UAT match?

### CHECK 4

Does the SIRUTA code match?

### CHECK 5

Do the coordinates match?

### CHECK 6

Are the RAN sites assigned to exactly this locality?

### CHECK 7

Does the historical information come from sources referring exactly to this locality?

If any of these checks fails, **do not assign the information to the locality** until the identity is clarified.

---

# 22. FINAL STRUCTURE OF THE RECORD

For every locality return the information in the following structure:

## [LOCALITY NAME]

### Identity

* Name:
* County:
* UAT:
* Type:
* SIRUTA code:
* Coordinates:
* Latitude:
* Longitude:

### Historical names

* ...

### First attestation

* Year:
* Historical form:
* Document:
* Source:

### History

#### Prehistory

...

#### Antiquity

...

#### Middle Ages

...

#### Modern period

...

#### 19th–20th centuries

...

#### Contemporary period

...

### Administrative evolution

...

### Population

...

### Families / owners / estates

...

### Historic buildings and monuments

...

### RAN archaeological sites

For each:

#### [Site name]

* RAN code:
* Name:
* Category:
* Type:
* Components:
* Epoch:
* Period:
* Culture:
* Chronology:
* Description:
* Coordinates:
* Latitude:
* Longitude:
* LMI code:
* RAN/CIMEC link:
* Other sources:

### Sites in the vicinity

Only if they explicitly belong to other localities.

### Vanished localities / hamlets

...

### Historical toponymy

...

### Historical maps

...

### Sources

List the sources used and the direct links.

### Overall level of certainty

* Locality identification:
* Locality history:
* Archaeological sites:
* Toponymy:
* Other information:

---

# 23. FINAL RULE

The objective is not to produce a generic description of a locality name.

The objective is to produce a **documented historical record of a unique geographical entity**, identified by:

**LOCALITY + COUNTY + UAT + SIRUTA + COORDINATES**

and to associate with that entity only the historical and archaeological information that can be verifiably attributed to that locality.

If you cannot demonstrate that a piece of information belongs to the respective locality, **do not assign it to the locality**.
