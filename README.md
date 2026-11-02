# CsuStats

Jednostránkový průzkumník otevřených dat městské a obecní statistiky ČSÚ (MOS).

## Spuštění

Otevřete **index.html** v aktuálním Firefoxu, Chromu nebo Edge. Není potřeba instalace, Node.js ani lokální server. Stejný soubor lze samostatně nahrát na běžný statický hosting. Všechny knihovny, styly i zpracování CSV jsou vložené přímo v HTML; při provozu se nenačítá žádný kód z CDN.

Internet je potřeba pro první stažení číselníků a vybraných ročních dat. Přístup k místnímu úložišti u souborů `file://` závisí na prohlížeči a jeho nastavení. Když IndexedDB není dostupné nebo je plné, aplikace oznámí přechod na dočasnou paměť. Bez trvalého úložiště je potřeba po zavření stránky soubory stáhnout znovu.

## Použití

1. Při otevření vyberte v dialogu roky, které vás zajímají. Zeleně označené roky už jsou uložené a znovu se nestahují. K dispozici jsou předvolby posledních pěti let, uložených roků nebo všech roků. Výběr lze přeskočit nebo kdykoliv znovu otevřít přes **Spravovat stažené roky**.
2. Vyhledejte obec názvem (i bez diakritiky) nebo šestimístným kódem. Tlačítko **Přidat okres nebo kraj** otevře hromadný výběr jednoho i více okresů či krajů. Obce lze připojit ke stávajícímu výběru bez duplicit nebo jimi celý výběr nahradit. Limit 20 obcí byl odstraněn. Uložený rok se použije automaticky; další rok načtete tlačítkem **Načíst**.
3. V **Přehledu roku** hledejte ukazatele, filtrujte okruhy a řaďte sloupce. Název je oddělený od okruhu, kódu a počtu obcí s číselným údajem. Výchozí filtr skryje ukazatele bez číselných hodnot pro vybrané obce. Kliknutím na řádek otevřete graf a metodiku. Souhrnné karty vždy popisují první vybranou obec.
4. V **Porovnání obcí** zvolte ukazatel; lze jej hledat podle názvu, kódu nebo okruhu. Ukazatele bez číselných údajů jsou standardně skryté, přepínačem je lze zobrazit. U každého je uvedeno pokrytí vybraných obcí. Vhodné početní a peněžní ukazatele lze přepočítat na 1 000 obyvatel; základem je obyvatelstvo k 31. 12. stejného roku.
5. Ve **Vývoji v čase** zvolte období a klikněte na **Načíst období**. Pro každý rok je potřeba samostatný soubor; uložené roky se použijí z prohlížeče. Index počítá první společný rok s dostupnou nenulovou hodnotou všech vybraných obcí jako 100.
6. Tlačítka **CSV** exportují tabulku, ikona u grafu vytvoří PNG s titulkem, obdobím a zdrojem. Přehled exportuje jen aktuálně vyfiltrované řádky. CSV používá UTF-8 s BOM a oddělovač `;`.
7. **Spravovat stažené roky** umožňuje odebrat uložené soubory. **Znovu stáhnout vybraný rok** aktualizuje data přímo ze zdroje.

U velkých výběrů levý panel ukazuje nejprve 12 obcí; další lze rozbalovat. Tabulky a CSV vždy zahrnují celý výběr. Široké tabulky průběžně vykreslují jen viditelné sloupce; jejich názvy rozlišují stejně pojmenované obce okresem. Porovnávací graf lze posouvat, časový graf při více než 20 obcích standardně ukazuje prvních 10. Přepínačem **Obce v grafu** lze zobrazit 20, 50 nebo všechny vybrané obce. Zúžení grafu nikdy nezkracuje tabulku ani CSV.

Průběhový dialog rozlišuje čekající, uložené, stahované, zpracovávané a dokončené soubory. Ukazuje průběh aktuálního souboru i celého výběru. Velikost ročního CSV se před stažením zjišťuje požadavkem HEAD, aby komprese přenosu nezkreslila procenta. Pokud velikost není dostupná, běží animovaný průběh a zobrazuje se počet přijatých MB. Načítání lze zrušit; již dokončené soubory zůstanou uložené.

Označení **⚠ málo dat** znamená, že je číselný údaj dostupný pro méně než polovinu vybraných kombinací obec/rok nebo jde jen o jediný údaj z více požadovaných. V časové řadě je tak označen také ukazatel, který má hodnoty pouze v jednom roce z více vybraných let. Nuly se počítají jako dostupná čísla; chráněné a chybějící údaje se nepočítají. Dokud nejsou všechny roky období načtené, neověřené historické ukazatele zůstávají v seznamu a aplikace na neúplné ověření upozorní. Přímo vybraný ukazatel zůstane dostupný pro metodiku, i když je bez číselných hodnot.

Výběr se ukládá do části adresy za `#`. Na hostingu lze sdílet celou adresu. U souboru z disku potřebuje příjemce vlastní kopii HTML a přenesení části adresy od `#`. Data ani nastavení se neodesílají žádnému aplikačnímu serveru; požadavky na veřejné CSV směřují přímo na ČSÚ.

## Zdroj a interpretace

- Zdrojová stránka: https://csu.gov.cz/produkty/databaze-mos-otevrena-data
- Dokumentace: https://csu.gov.cz/statistika/databaze-mos-otevrena-data-dokumentace
- CSV: `https://opendata.csu.gov.cz/soubory/od/od_mos01/`
- Číselníky: `mos_uzemi.csv`, `mos_ukaz.csv`, `mos_okruhy.csv`.
- Vazba okresů na kraje: vložený výřez oficiálního souboru [Struktura území ČR k 1. 1. 2026](https://csu.gov.cz/i_zakladni_uzemni_ciselniky_na_uzemi_cr_a_klasifikace_cz_nuts), uložený v `src/regions.json`. Názvové varianty okresů v MOS jsou sjednocené; při vytvoření byla ověřena shoda všech okresů v MOS. Příslušnost obce k okresu se vždy bere z historického záznamu MOS pro zvolený rok; názvy krajů odpovídají vloženému číselníku.
- Roční data: `mos_data_RRRR.csv`, od roku 2000. Výchozí známý nejnovější rok je 2025; po zveřejnění se zkouší doplnit i předchozí kalendářní rok.

ČSÚ publikuje celé roční soubory pro všechny obce, nikoliv dotazovací API pro jednotlivou obec. První stažení jednoho roku proto má desítky MB. CSV se zpracovává po částech ve Web Workeru. Plný index zůstává v RAM jen pro poslední zpracovaný rok; pro ostatní roky se drží malé výřezy vybraných obcí. Trvale se ukládají původní CSV v IndexedDB. Číselníky se obnovují po sedmi dnech a při nedostupném zdroji se použije starší uložená verze.

**Pomlčka** znamená nedostupný údaj, **i.d.** chráněný údaj; **0 je skutečná nula**. Chráněné a chybějící údaje se nevykreslují jako nulové hodnoty. Nejnovější roční soubor nemusí obsahovat všechny ukazatele. Údaje sčítání a jednorázových šetření mohou mít referenční datum odlišné od roku souboru. Metodika a územní vymezení obcí se mohou v čase měnit; aplikace uchovává kódy obcí a respektuje historii číselníku při hledání, ale neprovádí přepočet historických území na dnešní hranice.

## Vývoj a ověření

Pro **běh** potřebujete jen `index.html`. Další soubory slouží pro úpravy:

- `src/template.html`, `src/styles.css`, `src/data-ui.css`, `src/app.js`, `src/worker.js`, `src/transfer.js`, `src/regions.json`: zdroj aplikace a vazby okresů na kraje.
- `vendor/`: připnuté knihovny a jejich licence.
- `build.mjs`: vytvoří kompletní `index.html`; chybějící knihovny stáhne z jsDelivr.
- `verify.mjs`: ověří hromadné přidání a nahrazení 500 obcí bez duplicit, vazby krajů, plánování chybějících a uložených roků, procenta přenosu, dostupnost čísel a malé pokrytí, rozlišení nuly/prázdné/chráněné hodnoty, validaci CSV, zpracování přes hranice bloků a soběstačnost HTML.

Při změnách spusťte z této složky:

```powershell
node build.mjs
node verify.mjs
```

Vizuální a funkční ověření při implementaci proběhlo přes dočasný lokální HTTP náhled nad skutečnými ročníky 2023–2025, včetně CSV/PNG exportů, rušení stahování a použití cache. Vestavěný testovací prohlížeč z bezpečnostních důvodů neumožňuje navigaci na `file://`; přímé otevření souboru v uživatelově prohlížeči proto nebylo interaktivně ověřeno. HTML používá klasické vložené skripty a Blob Worker bez lokálních fetchů či modulových importů, aby fungovalo i při otevření z disku. Datový server ČSÚ vrací `Access-Control-Allow-Origin: *`.

Licence knihoven: Papa Parse 5.5.3 (MIT), Tabulator 6.3.1 (MIT), Apache ECharts 6.0.0 (Apache-2.0). Plné licence jsou také přímo v samostatném HTML.
