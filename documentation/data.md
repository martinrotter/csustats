# Zdroje a interpretace dat

- [Databáze MOS – otevřená data](https://csu.gov.cz/produkty/databaze-mos-otevrena-data)
- [Dokumentace MOS](https://csu.gov.cz/statistika/databaze-mos-otevrena-data-dokumentace)
- Číselníky `mos_uzemi.csv`, `mos_ukaz.csv`, `mos_okruhy.csv` a roční soubory
  `mos_data_RRRR.csv` z adresáře `https://opendata.csu.gov.cz/soubory/od/od_mos01/`.
- [Struktura území ČR k 1. 1. 2026](https://csu.gov.cz/i_zakladni_uzemni_ciselniky_na_uzemi_cr_a_klasifikace_cz_nuts):
  vložený výřez vazeb okresů na kraje v `src/data/regions.json`, včetně původní URL
  a data platnosti. Názvové varianty okresů MOS jsou sjednocené.

Zdroj poskytuje celé roční CSV pro všechny obce od roku 2000. Výběr jedné obce
proto nezmenšuje první přenos: soubory mají desítky MB. Aplikace zpracovává CSV
po částech ve workeru, drží v RAM plný index jen posledního roku a ukládá výřezy
pro vybrané obce. Původní CSV se uchovává v IndexedDB. Číselníky se obnovují po
sedmi dnech, s návratem k uložené verzi při nedostupnosti zdroje.

Výchozí známý nejnovější rok je 2025; aplikace zkouší také soubor za předchozí
kalendářní rok. Nejnovější soubor nemusí obsahovat všechny ukazatele a může být
ČSÚ později aktualizován. Pro aktualizaci slouží **Znovu stáhnout vybraný rok**.

Údaje se vztahují k území obce platnému v příslušném roce. Aplikace používá
historickou příslušnost k okresu z MOS; názvy krajů odpovídají vloženému číselníku.
Neprovádí přepočet historických údajů na dnešní hranice. Sčítání a jednorázová
šetření mohou mít jiné referenční datum než rok souboru; rozhoduje metodika.

Nuly, nedostupné a chráněné hodnoty jsou odlišné. Chybějící hodnoty v časovém
grafu se nespojují čarou. Míry, průměry, indexy a kategoriální kódy nelze libovolně
přepočítávat na obyvatele; ovladač nabízí přepočet pouze pro vhodné jednotky.

Statistická data si zachovávají původ a podmínky ČSÚ. Licence MIT projektu se
vztahuje na vlastní kód aplikace, nikoliv na přelicencování zdrojových statistik.
