# Architektura a vývoj

## Výstup a nasazení

Node.js 22+, přesné dev závislosti v lockfile. `npm ci` instaluje esbuild
a Prettier. Runtime knihovny jsou připnuté ve `vendor/`. `npm run build` ověřuje
SHA-256, sestavuje aplikaci a worker a vkládá je do HTML spolu se styly, knihovnami,
územním číselníkem a úplnými licenčními texty. Build nepotřebuje veřejná datová API.

Výstup `docs/index.html` se necommituje. Push do `master` provede `npm run check`
a nasadí `docs/` přes GitHub Actions. PR prochází stejnými kontrolami bez nasazení.
Nastavení Pages musí používat **GitHub Actions**, nikoliv publikování větve.

`npm run preview` servíruje pouze hotové HTML na loopback rozhraní. Volitelná
proměnná `PORT` mění port; výchozí je 4317. Žádné zdrojové soubory nezpřístupňuje.

## Datový model

`src/core/cube.js` normalizuje vstup na kostku s popsanými dimenzemi, kategoriemi,
hodnotami, stavy, jednotkami a původem. Role dimenze může být časová, územní,
ukazatelová nebo obecná. Kódy jsou řetězce. Číselné hodnoty jsou `Float64Array`,
chybějící hodnoty uvnitř `NaN`; při exportu a projekci jsou `null`. Stavy jsou
samostatná mapa, aby se důvěrnost nezaměnila s chybějícím či nulovým údajem.

Počet buněk kontrolujeme před alokací i před dotazem. Výchozí maximum je 150 000.
Projekce grafu vybírá jednu veličinu, osu, volitelnou dimenzi řad a explicitní
hodnoty ostatních dimenzí. Nepoužívá implicitní agregace. Zdrojová kostka zůstává
zachovaná pro tabulku a export.

`src/data/datastat.js` načítá katalog, definice, oficiální výběry a číselníky.
Varianty seskupuje podle typu dimenze. Respektuje zakázané kombinace ukazatelů
a dimenzí z metadat. POST výběr používá `IndicatorType`, skutečné kódy dimenzí
a explicitní seznamy položek včetně hierarchických úrovní. Pro data volí JSON-stat.
Pomocné endpointy odhadů velikosti nejsou podmínkou načítání.

`src/data/csv-source.js` je obecná čtečka dlouhého CSV rozděleného po obdobích.
`src/data/profiles.json` deklaruje URL, mapování sloupců, číselníky, časové pokrytí
a pomocné ukazatele jednotlivých sad. MOS je jeden profil, bez vlastní JS čtečky.
Worker `index-worker.js` dostává schéma sloupců a identifikátor indexu; podporuje
textové kódy, různá období i pořadí sloupců. Původní IndexedDB `csustats-mos-v1`,
store `files` a historické cache klíče zůstávají kompatibilní.

`core/dimensions.js` sdílí vyhledávání ve skupinách, hierarchie a historickou
platnost kategorií napříč zdroji. `core/selection.js` kontroluje normalizované
výběry a omezení. `data/sources.js` registruje zdrojové adaptéry. UI ani projekce
grafů nevětví chování podle ID konkrétní sady nebo konkrétního ukazatele.
Poměrové přepočty používají zvolený jmenovatel dostupný v načtených datech nebo
v pomocných údajích deklarovaných profilem. Nespoléhají na jeden populační kód.

`src/data/tabular.js` zpracovává CSV a ploché JSON záznamy. Import vyžaduje
jednoznačné souřadnice. Parsery běží v Blob workeru, vloženém v HTML.

## Síť a limity

Všechna volání veřejných API i souborů MOS jdou přes `ApiClient` v `core/http.js`.
Povolené jsou pouze HTTPS hosty `data.csu.gov.cz` a `opendata.csu.gov.cz` a metody
GET, HEAD a čtecí POST. Nepoužíváme cookies ani přihlašovací údaje.

- Jedna fronta a jeden společný rozpočet pro oba hosty; max. 30 startů/minutu,
  alespoň 1,2 s mezi starty a jeden přenos v dané frontě.
- Web Locks koordinují rezervace kvóty a celé přenosy mezi kartami. Místní
  úložiště zachovává časové značky a pozastavení i přes obnovení stránky.
- Bez těchto funkcí funguje omezení v rámci jedné instance; sdílení mezi kartami
  pak není plně zaručené. Kvóta aplikace není zveřejněný limit ČSÚ a nenahrazuje
  reakci na konkrétní odpověď serveru ani omezení společné veřejné IP adresy.
- HTTP 429 pozastaví frontu nejméně na minutu a respektuje delší `Retry-After`.
  Přijímáme počet sekund i HTTP datum, s ohledem na čas serveru.
- HTTP 403 pozastaví frontu nejméně na 10 minut. 400/401/404/413 neopakujeme.
- 408/429/500/502/503/504 dovolují nejvýše dvě opakování s prodlužovaným čekáním.
  Při delší serverové pauze se požadavek ukončí s uvedením chyby; další dotaz
  čeká ve frontě. Síťové/CORS chyby se slepě neopakují.
- Zohledňujeme zpřístupněné `RateLimit-Remaining`, `RateLimit-Reset`
  a `X-RateLimit-*`. Prohlížeč může neexponované hlavičky skrýt.
- Shodné souběžné dotazy sdílejí přenos. Zrušení jednoho odběratele neruší
  ostatní. Přenos se ukončí, když nezůstane žádný odběratel.
- Hlídáme deklarovanou i skutečně přenesenou velikost a časový limit. Neznámou
  či komprimovanou délku nezobrazujeme jako falešné procento.

Přehled UI uchovává 100 posledních síťových odpovědí se stavem, trváním a bajty.
HTTP 0 označuje síťovou chybu či zrušení, nikoli skutečný HTTP status serveru.
Export obrázku používá místní datovou URL, nikoli další API.

## Cache a UI

`src/core/analysis.js` připravuje přepočtené sloupce, souhrny a Tukeyho detekci
odlehlých hodnot. Poměry v tabulce a grafu sdílejí `ratioTransform` z `cube.js`;
jmenovatel se hledá podle všech souřadnic kromě ukazatele. Souhrny používají
kompenzovaný součet a zvlášť počítají dostupnost původních i přepočtených hodnot.
Neúplné souhrny do detekce nevstupují. Srovnatelné skupiny zachovávají ostatní
dimenze, ukazatel, jednotku a dostupnou úroveň hierarchie. Minimum je pět hodnot;
kvartily používají interpolaci R7 a hranice jsou Q1/Q3 ± 1,5 IQR.

`src/ui/chart-items.js` spravuje nezávislý ruční výběr grafu. Stav obsahuje kódy
`seriesIds`/`categoryIds`, nikoli názvy; `null` znamená automatický výběr,
prázdné pole explicitně prázdný výběr. Tyto volby, řazení řad, dimenze srovnání
a souhrnu a filtry tabulky se ukládají do stavu výběru a zachovají změnu jazyka.

Katalog má platnost 24 h, definice/číselníky 7 dní, výběry DataStatu 6 h.
Požadavky výslovně používají `Accept-Language: cs` nebo `en`; cache DataStatu
rozlišuje jazyk metadat i dat. Klíč souběžného požadavku zahrnuje jazyk, fronta
a rate limiting zůstávají společné. Worker dostává jazyk u každé zprávy.

`src/i18n/index.js` spravuje jazyk, interpolaci, formátování a počáteční texty
HTML. `src/i18n/en.json` obsahuje překlady českých zdrojových textů.
Počáteční jazyk určuje sdílený odkaz, poté uložená ruční preference, poté
`navigator.languages` (s náhradou `navigator.language`) a nakonec čeština.
Regionální značky se párují podle základního jazyka; do preference se zapisuje
pouze ruční přepnutí, nikoli jazyk ze sdíleného výběru. Dynamické
UI používá `t` a HTML text `ht`; proměnné a zdrojová metadata se nepřekládají.
Test ověřuje pokrytí statických textů, přístupných názvů, volání překladů a shodu
zástupných parametrů. Při změně jazyka se popisky API znovu načtou podle původních
kódů. Neodeslané filtry a konfigurace grafu zůstávají zachované; selhání obnovy
vrátí původní data s výslovným upozorněním na jazyk zdrojových názvů.

Roční MOS soubory se automaticky nestahují znovu; obnovení je explicitní. Trvalé úložiště
má náhradu v omezené RAM. Ovladače grafu nepotřebují nové síťové dotazy.

`src/app/workbench.js` řídí operace, rušení, stav URL a přepínání zdrojů.
`src/ui/` odděluje katalog, dimenze, výsledky, import, přenosy a pomocné dialogy.
Tabulator virtualizuje tabulku. ECharts poskytuje grafy, zoom, legendu a export
do Canvas PNG či SVG. Uživatelské texty v HTML a tooltipech escapujeme.

## Testy

`npm run check` provádí formátování, deterministické testy a produkční build.
Testy nevolají veřejná API. Pokrývají hustý i řídký JSON-stat, starší obálky,
pořadí kategorií, CSV varianty, JSON záznamy, neplatná data, nuly, chráněné údaje,
velké výběry, projekce a jednotky, HTTP frontu, retry/cooldown, rušení, deduplikaci,
velikost přenosu, skutečný sestavený worker a samostatnost HTML výstupu.

Změny knihoven jsou explicitní: soubory, zdrojové URL, SHA-256 i licence.
`npm run vendor:restore` obnovuje jen chybějící soubory a kontroluje jejich hash.
