# CsuStats

Přehledný průzkumník českých obcí nad otevřenými daty ČSÚ MOS. Porovnání obcí,
roční přehledy a časové řady fungují přímo v prohlížeči.

[Web](https://martinrotter.github.io/csustats/) ·
[Návod](documentation/usage.md) ·
[Vývoj](documentation/development.md) ·
[Zdroje dat](documentation/data.md)

![Přehled obcí](documentation/images/overview.jpg)

## Co aplikace umí

- Vybrat a uložit roční soubory od roku 2000; již stažené roky se nepřenášejí znovu.
- Porovnávat jednotlivé obce i celé okresy a kraje bez duplicit.
- Procházet tabulky, interaktivní grafy a časové řady.
- Rozlišit chybějící, chráněné a číselné údaje včetně skutečných nul.
- Zobrazit pokrytí dat a označit ukazatele s malým počtem hodnot.
- Exportovat CSV a PNG a sdílet výběr adresou stránky.

Aplikace nemá backend ani runtime závislosti na CDN. Číselníky a CSV stahuje přímo
z ČSÚ; místní cache je uložená v IndexedDB každého návštěvníka. Výsledkem buildu je
jediný soubor `docs/index.html`, který lze také otevřít přímo z disku.

## Stačí commit a push

Každý push do `master` spustí [GitHub Actions](.github/workflows/ci.yml):

1. Nainstaluje připnuté vývojové závislosti přes `npm ci`.
2. Ověří formátování, testy a integritu převzatých knihoven.
3. Vytvoří samostatné HTML do `docs/`.
4. Po úspěšných kontrolách automaticky nasadí pouze `docs/` na GitHub Pages.

Výsledné HTML se necommituje. Pull requesty projdou kontrolami bez nasazení.
Jednorázově musí být v **Settings → Pages → Source** vybráno **GitHub Actions**;
potom už další zveřejnění obstará push do `master`.

## Lokální vývoj

Node.js 22 nebo novější; pro samotné prohlížení webu Node.js není potřeba.

```sh
npm ci
npm run build
npm run preview
```

Náhled běží na adrese vypsané v terminálu. Samostatný soubor `docs/index.html`
lze místo toho otevřít v prohlížeči dvojklikem.

```sh
npm test           # datové, workerové a buildové testy
npm run format    # formátování vlastních zdrojů
npm run check     # stejná sada kontrol a build jako v CI
```

## Struktura

```text
.github/workflows/     automatické kontroly a nasazení
src/
  app/                 vytvoření aplikace a jejího stavu
  core/                čisté datové a formátovací funkce
  data/                CSV worker a územní číselník
  features/            načítání, cache, obce, ukazatele, grafy a exporty
  lib/                 rozhraní k vloženým knihovnám
  styles/              čitelné zdrojové styly
  main.js              vstup aplikace
  template.html        struktura stránky
scripts/               build, náhled a kontrola vendor souborů
test/                  automatické testy a malé lokální fixture
vendor/                připnuté knihovny, licence a SHA-256 manifest
documentation/         návody, architektura, zdroje a obrázky
docs/                  generovaný web; ignorovaný v Gitu
```

## Licence a data

Vlastní kód: [MIT](LICENSE), © 2026 Martin Rotter.
Převzaté knihovny mají [samostatné licence a oznámení](THIRD_PARTY_NOTICES.md), které
jsou přiložené také ve výsledném HTML. Licence aplikace nemění podmínky dat ČSÚ.
Nejde o oficiální aplikaci Českého statistického úřadu.
