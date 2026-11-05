# Zdroje a interpretace dat

## ČSÚ DataStat

- [Dokumentace API](https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu)
- [Katalog API](https://data.csu.gov.cz/api/katalog/v1/swagger-ui/index.html)
- [Datový obsah API](https://data.csu.gov.cz/api/dotaz/v1/swagger-ui/index.html)
- [Portál DataStat](https://data.csu.gov.cz/datastat)
- [Specifikace JSON-stat](https://json-stat.org/format/)

Katalog popisuje sady, ukazatele, dimenze a oficiální výběry. Datový endpoint
poskytuje vybranou podmnožinu sady. Počty sad i obsah katalogu se mohou měnit.
Různé verze sady mohou mít jiné dimenze či metodiku. Identifikátor ukazatele
DataStatu není automaticky totožný s kódem ukazatele MOS.

U časových dimenzí se může jednat o roky, školní roky, měsíce, čtvrtletí i jiné
intervaly. Číselník kalendáře může obsahovat budoucí období; výchozí nabídku
omezujeme podle zveřejněného oficiálního výběru, pokud je dostupný.

Kraje, okresy, obce a jejich souhrny nesmí být při skládání nebo sčítání
zaměněny za vzájemně nezávislé skupiny. Míry, podíly a průměry nelze obecně
sčítat. Aplikace neprovádí automatické spojování různých datových sad.

## ČSÚ MOS

- [Databáze MOS – otevřená data](https://csu.gov.cz/produkty/databaze-mos-otevrena-data)
- [Dokumentace MOS](https://csu.gov.cz/statistika/databaze-mos-otevrena-data-dokumentace)
- `mos_uzemi.csv`, `mos_ukaz.csv`, `mos_okruhy.csv`, `mos_data_YYYY.csv`
  z `https://opendata.csu.gov.cz/soubory/od/od_mos01/`.
- [Struktura území ČR k 1. 1. 2026](https://csu.gov.cz/i_zakladni_uzemni_ciselniky_na_uzemi_cr_a_klasifikace_cz_nuts)
  pro vloženou vazbu okresů a krajů v `src/data/regions.json`.

Jeden roční soubor obsahuje údaje za všechny obce a má obvykle desítky MB.
Výběr jedné obce nezmenšuje první přenos. Soubor je uložený do IndexedDB a další
výběry jej mohou použít bez sítě. Novější rok může mít neúplné údaje a poskytovatel
může soubory opravit. Pro kontrolu nové verze použijte obnovení ze zdroje.

Území odpovídá platnosti obce v konkrétním roce. Vložená příslušnost okresů ke
krajům je orientační a historická data nepřepočítává na dnešní hranice. U sčítání
a jednorázových šetření rozhoduje referenční datum a metodika konkrétního ukazatele.

Profil MOS nabízí jako pomocný údaj počet obyvatel k 31. 12. téhož roku (`110900`).
Lze jej zvolit jako jmenovatel obecného poměrového přepočtu. Bez dostupného
nenulového jmenovatele zůstává hodnota prázdná. Kód druhu obce (`010000`) je
v profilu označený jako kategoriální a nevykresluje se jako spojitá veličina.

## Kvalita, dostupnost a licence

Nula, nedostupná hodnota a chráněný údaj jsou odlišné stavy. Graf chybějící hodnoty
neodhaduje a nespojuje přes ně čáry. Pokrytí je podíl číselných hodnot ve skutečně
načteném výběru. Malé pokrytí znamená méně než polovinu buněk ukazatele; neověřené
ukazatele neoznačujeme za prázdné jen proto, že dosud nebyly vyžádané.

Čistě klientská aplikace závisí na dostupnosti API a CORS poskytovatele. Síťovou
chybu prohlížeč nemusí odlišit od blokace CORS. Stavové kódy a viditelné hlavičky
jsou dostupné v přehledu požadavků. Vlastní soubory se zpracovávají místně.

Zdrojová data si zachovávají podmínky poskytovatele a původ. MIT licence aplikace
nepřelicencovává statistiky. Nejde o oficiální aplikaci Českého statistického úřadu.
