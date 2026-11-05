# Používání Národních dat

## Jazyk

V záhlaví přepnete **Čeština / English**. Volba se zapamatuje v tomto prohlížeči
a je součástí sdíleného výběru. Jazyk v odkazu má přednost před uloženou ruční
volbou. Pokud chybí obojí, použije se první podporovaný jazyk z preferencí
prohlížeče (`cs` nebo `en`, včetně variant jako `cs-CZ` a `en-US`); jinak čeština.
Otevření sdíleného odkazu uloženou ruční volbu nepřepisuje.
Překládá se ovládání, dialogy, grafy, tabulky, exportní popisky i přístupné názvy.
Čísla a data používají formát zvoleného jazyka.

DataStat požaduje názvy a metodiku ve zvoleném jazyce. Pokud ČSÚ některý text
nepřeložil, může i anglická odpověď obsahovat původní český text. Oba jazyky mají
samostatnou cache, ale společnou frontu a API limity. Přepnutí zachová výběr, graf a původní
číselné údaje. Vlastní soubory a CSV zdroje včetně MOS uchovávají názvy publikované
poskytovatelem; aplikace nepřekládá jejich obsah automaticky.

## Datová sada a výběr

Otevřete **Datové sady**, vyhledejte téma nebo kód a vyberte sadu. Katalog lze
omezit na ČSÚ DataStat, MOS nebo sady s údaji za obce. Vyhledávání probíhá místně
nad načteným katalogem; každé stisknutí klávesy nevolá API.

Vlevo se objeví dimenze konkrétní sady. Může jít o roky, školní roky, měsíce,
obce, kraje, pohlaví, věk nebo odvětví. Vyberte jednu či více položek každé
dimenze a stiskněte **Načíst výběr**. Variantou dimenze lze změnit například
územní členění. Aplikace kontroluje neplatné kombinace a počet výsledných buněk.

U MOS se po otevření zobrazí výběr roků. Uložené roky jsou odlišené. Číselníky
a roční soubory se uchovávají v místní cache. Výběr obcí lze hledat podle jména
i kódu nebo hromadně přidat obce odpovídající okresu či kraji. Opakované přidání
nevytváří duplicity. Roční soubor MOS má desítky MB i při výběru jedné obce.

Na telefonu rozbalíte filtry tlačítkem **Výběr a filtry**. Dialogy lze zavřít
klávesou Escape. `Ctrl+K` / `Cmd+K` otevře katalog.

## Graf

- **Osa kategorií** vybírá vodorovnou osu; u pruhového grafu jde o svislou osu.
- **Datové řady** rozdělují hodnoty například podle obcí nebo pohlaví.
- **Ukazatel** volí jednu veličinu a její jednotku.
- Zbývající dimenze jsou v ovladačích výřezu grafu. Jejich hodnoty nesčítáme.
- V nastavení jsou popisky, extrémy, řazení, počet řad a legenda.
- **Vybrat řady a položky grafu** otevře vyhledávatelný seznam celého načteného
  výběru. Položky lze jednotlivě přidávat a odebírat, i když nejsou mezi prvními
  automaticky vybranými řadami. Ruční výběr může mít až 200 položek a ukládá se
  do sdíleného odkazu. **Obnovit automatický výběr** vrátí omezení počtu řad.
- **Automatický výběr řad** může řady vybrat podle poslední dostupné hodnoty
  (po přepočtu, pokud je aktivní) nebo největší odchylky od srovnatelných položek.
- Delší grafy mají posuvník a zoom. Legenda umožňuje jednotlivé řady vypnout.
- **Index** hledá společnou nenulovou základnu viditelných řad. Chybějící údaje
  zůstávají prázdné. **Poměrový přepočet** nabídne dostupné jmenovatele a měřítko
  1, 100 nebo 1 000. Lze tak například přepočítat počet zařízení na obyvatele,
  pokud oba údaje odpovídají stejným dimenzím. Potřebný další ukazatel zahrňte
  do výběru; některé souborové profily poskytují pomocné údaje automaticky.
  Zkontrolujte jednotky a věcný význam zvoleného poměru.
- Skládané grafy používejte pouze pro sčitatelné, nepřekrývající se skupiny.
  Celkový údaj a jeho dílčí skupiny se nesmí sčítat.

Pokud by bylo řad nebo bodů příliš mnoho, aplikace vyžádá menší výřez. Omezení
grafu nikdy neodstraňuje řádky z načtené tabulky. Kategoriální kódy nevykreslujeme
jako číselné veličiny.

**Uložit obrázek** nabízí PNG a SVG a tři velikosti až 3 200 × 2 000. Export
zachovává název, výřez, jednotku, zdroj, legendu a aktuální zoom.

## Tabulka a CSV

Tabulka obsahuje všechny dimenze načteného výběru. Má řazení, vyhledávání,
virtualizaci a vlastní posouvání. Výchozí zobrazení skrývá chybějící údaje;
zaškrtávací pole je vrátí. Skutečná nula zůstává číselnou hodnotou.

CSV respektuje vyhledávání a přepínač chybějících údajů v tabulce. Obsahuje názvy
i kódy, původní hodnoty, jednotky, stavy a zdroj. **Poměrový přepočet** ve společném
ovládání nad grafem a tabulkou přidá vedle původní hodnoty přepočtený údaj a jeho
jednotku. CSV jej také obsahuje, včetně informací o srovnání. Index je režim grafu;
tabulka při něm zachovává původní hodnoty. Exportované texty jsou ošetřené proti spuštění vzorců
v tabulkových editorech.

**Souhrn tabulky → Součet přes: Roky** (nebo jinou dostupnou dimenzi) sloučí
období do jednoho řádku pro každou kombinaci ostatních dimenzí. Různé ukazatele
a jednotky zůstávají oddělené. Přepočtený součet je **součtem jednotlivých
přepočtů**, nikoli podílem součtů. Například dotace za rok A / obyvatelé v roce A
× 1 000 + dotace za rok B / obyvatelé v roce B × 1 000. Pokrytí uvádí, kolik
položek do součtu vstoupilo; chybějící údaje nejsou nuly. Souhrn se uplatní i v CSV.
Sčitatelnost musí odpovídat metodice ukazatele; stejné jednotky samy o sobě
nezaručují, že má součet věcný význam.

## Odlehlé hodnoty

Ve **Srovnávat podle** zvolte například obce, výrobky nebo jinou dimenzi.
Sloupec **Srovnání** označí hodnoty mimo interval Q1 − 1,5 × IQR až Q3 + 1,5 × IQR,
kde IQR = Q3 − Q1 a kvartily používají lineární interpolaci. Potřeba je alespoň
pět číselných údajů. Ukazatele, jednotky, období a ostatní dimenze tvoří samostatné
skupiny; dostupné územní úrovně se nemíchají. Aktivní poměrový přepočet se použije
i pro toto srovnání. Neúplné součty jsou z detekce vynechány.

**Jen odlehlé hodnoty** omezí tabulku i CSV. **Odlehlé položky do grafu** vybere
příslušné řady nebo kategorie a obejde automatický výběr prvních 20 řad.
**Přidat do grafu** u jednotlivého řádku přidá konkrétní položku. Při více
ukazatelích se graf sestaví pro ukazatel prvního odpovídajícího řádku;
pro jednoznačný výběr použijte **Ukazatel v tabulce**. Graf zůstává po jednotlivých
obdobích i při souhrnné tabulce. Odlehlé body jsou zvýrazněné; pro čitelnost se
zobrazuje nejvýše 100 značek na řadu. Detekce je orientační pomůcka k průzkumu dat.

## Vlastní soubor

Otevřete CSV/TSV nebo JSON do 20 MB. JSON-stat se načte přímo. U ostatních tabulek
přiřaďte hodnotu, kategorii a volitelně čas a jednotku. Kódy s úvodními nulami
zůstávají textem. CSV může být UTF-8 nebo Windows-1250. Při nejednoznačných
kombinacích aplikace požádá o úpravu vstupu; hodnoty nesčítá automaticky.

## Cache, sdílení a chyby

**Místní data** ukazují uložené soubory a výběry a umožňují jejich odstranění.
**Obnovit ze zdroje** obejde datovou cache. Definice výběru je součástí odkazu;
příjemce musí data načíst. Místní soubor se odkazem nepřenáší.

Průběhový dialog rozlišuje čekání, stahování, zpracování, ukládání a jednotlivé
soubory. Je-li velikost přenosu neznámá, ukazuje aktivitu a skutečně přijaté bajty.
Načítání lze zrušit bez odstranění již uložených souborů.

Indikátor API otevře přehled posledních 100 požadavků a případné čekací doby.
Při HTTP 429 poskytovatel omezuje frekvenci; aplikace další požadavky pozastaví.
Obnovování stránky limit neobchází, pokud je dostupné místní úložiště.
