# Vývoj a nasazení

## Prostředí a příkazy

Použijte Node.js 22 nebo novější. `npm ci` nainstaluje přesné verze z lockfile.
esbuild a Prettier jsou jen vývojové závislosti. `vendor/` už obsahuje knihovny
potřebné pro prohlížeč; běžný build nic dalšího nestahuje.

| Příkaz                   | Význam                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| `npm run build`          | Vytvoří samostatné `docs/index.html` a značku `.nojekyll`.              |
| `npm run preview`        | Servíruje jen hotovou stránku na lokálním rozhraní; volitelně `PORT`.   |
| `npm test`               | Spustí testy čisté logiky, skutečného zabaleného workeru a HTML buildu. |
| `npm run format`         | Zformátuje vlastní zdroje, dokumentaci a konfiguraci.                   |
| `npm run check`          | Ověří formát, spustí testy a vytvoří aktuální HTML.                     |
| `npm run build:check`    | Porovná místní výstup s aktuálními zdroji bez přepisování.              |
| `npm run vendor:check`   | Ověří SHA-256 všech převzatých souborů a licencí.                       |
| `npm run vendor:restore` | Obnoví chybějící vendor soubory z připnutých URL a ověří hash.          |

## Architektura

`src/main.js` vytváří aplikaci pomocí `src/app/create-app.js`. Každá instance má
vlastní kontext v `src/app/context.js`; ten drží stav výběru, cache, grafů a
probíhajících operací.

Jednotlivé části `src/features/` jsou továrny přijímající tento kontext `app`.
Vrátí pojmenované operace, které se zaregistrují před spuštěním aplikace. Křížové
volání `app.getYear(...)` či `app.renderSelection()` tak vždy míří na společnou
instanci. Továrny při registraci neprovádějí síťové požadavky ani neobsluhují DOM.

| Část                               | Odpovědnost                                                          |
| ---------------------------------- | -------------------------------------------------------------------- |
| `downloads`                        | HTTP, číselníky, CSV worker a roční výřezy.                          |
| `storage`                          | IndexedDB, omezená náhradní cache v RAM a přehled uložených souborů. |
| `transfers`                        | Zrušení operace, průběh souborů i celé dávky a stav dialogu.         |
| `data`                             | Územní historie, hodnoty a výpočty ukazatelů.                        |
| `places`, `years`                  | Jednotlivý i hromadný výběr a dialog roků.                           |
| `indicators`                       | Pokrytí dat, filtrování a metodika.                                  |
| `overview`, `charts`               | Tabulky, přehled roku, porovnání a časové řady.                      |
| `exports`                          | CSV a PNG vytvořené na klientovi.                                    |
| `feedback`, `navigation`, `events` | Zprávy, URL, přepínání pohledů a obsluha ovládacích prvků.           |

Čisté algoritmy jsou v `src/core/` a nevyžadují prohlížeč. Vstup workeru
`src/data/csv-worker.js` se sestavuje samostatně společně s Papa Parse. Prohlížeč
jej spouští z Blob URL; nepotřebuje další místní soubor ani modulový import.

## Build a výstup

Build ověří `vendor/manifest.json`, sestaví ES moduly aplikace a workeru přes
esbuild a vloží vše do HTML šablony spolu se styly, katalogem krajů a úplnými
licencemi. Záměrně vytváří jediný soubor bez závislosti na CDN, takže podporuje
GitHub Pages i přímé otevření z disku.

`docs/` je generovaný a ignorovaný v Gitu. `.cache/`, `.local/`, testovací výstupy,
logy, soubory editorů a místní prostředí se také necommitují. Konce řádků vlastních
zdrojů jsou sjednocené na LF; vendor soubory zůstávají beze změny bajtů.

## Automatické publikování

V repozitáři jednou nastavte **Settings → Pages → Source → GitHub Actions**.
Pro tento workflow se nepoužívá volba **Deploy from a branch / master / docs**.
Adresář `docs/` vzniká až na runneru a publikuje se jako Pages artifact.

Push do `master` automaticky provede instalaci, kontrolu formátu, testy, build a
nasazení. Pull requesty spouštějí stejný build bez nasazení. Deploy má jen práva
`pages: write` a `id-token: write`; kontrolní job má pouze čtení repozitáře.
Výsledná URL je v Actions u deploymentu prostředí `github-pages`.

Veškeré úpravy pro běžné zveřejnění tedy znamenají jen commit a push zdrojů.
Lokální build je dobrovolný náhled, nikoliv podmínka nasazení.

## Aktualizace knihoven a dat

Verze knihoven jsou explicitní ve vendor manifestu; aktualizace je vědomá změna
souborů, licencí, URL a kontrolních součtů. `vendor:restore` existující upravené
soubory nepřepisuje. Změny verzí ověřte testy a v prohlížeči a ponechte všechny
požadované copyrighty v `THIRD_PARTY_NOTICES.md` a v buildu.

Regionální katalog má vlastní zdroj a datum v `src/data/regions.json`. Jeho změny
ověřte proti aktuálním názvům okresů v MOS. Automatické testy používají malé
fixture a obejdou se bez přístupu na živý ČSÚ server.
