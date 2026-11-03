# Živá kartografie – implementace a ověření

Nejnovější pokračování: [sedmá iterace podle osmi bodů porovnání](ITERATION_7_REVIEW.md).

Ověřeno 1.–2. listopadu 2026 v lokálním pluginu Spherical Graph 1.10.1.
Výtvarným podkladem jsou [schválené zadání](ZIVA_KARTOGRAFIE_SPEC.md),
[tokeny](ziva-kartografie.tokens.json) a koncept 3.

## Co je implementováno

- Sdílené barvy a číselné tokeny pro WebGL; odpovídající role DOM chrání
  kontraktní test. JSON se přibalí při sestavení, nečte se za běhu ze sítě.
- Matný petrolejový oceán, minerální paleta pevniny, optický terasovaný reliéf,
  jemné pobřeží, zemské hranice a graticule. Reliéf upravuje světlo/normály,
  nikoli vlastnictví území nebo polohy měst.
- Instancovaná města s jádrem, lokálním depth-tested halo a nejvýše dvěma
  stavovými prstenci. Výběr, endpointy, trasa, Search a aktivní poznámka mají
  jednoznačnou prioritu; hover nepřebarvuje významové jádro.
- Hrany v CSS pixelech a jediná prioritní kresba každé hrany. Žádné skládání
  běžného, Search a výběrového jádra přes sebe. Halo zůstává lokální.
- Stříbrné satelity, kontextové a vybrané spoje, zachovaná výška orbity,
  zakrytí glóbusem a uživatelská ochrana výhledu.
- Petrolejové menu, zlatá hlavní akce, mentolový focus, čitelné metadata,
  jednotné přepínače, tooltip a přepracovaný detail poznámky.
- Přerámování scény podle otevřeného detailu, spodní detail v úzkém view,
  sdílené kolize/rozpočty popisků, úspornější telefonní halo a reduced motion.
  Záře po přechodu neudržuje nekonečné vykreslování.

Implementační rozcestník je v [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md).
Existující Search following, Route Finder, filtry, připnutí, uložené mapy,
autorotace a transakční ovládání layoutu zůstávají součástí pluginu.

## Automatické kontroly

Finální brána: `npm run check` s `VITEST_MAX_WORKERS=2`.

- ESLint bez varování, TypeScript bez chyb.
- 65 testovacích souborů, 405 úspěšných testů.
- Produkční build a kontrola konzistence vydání 1.10.1.
- `git diff --check` bez chyb.

Nové a upravené kontroly pokrývají souběh Search/výběru/trasy/hoveru,
nezávislé prstence, inicializaci barev prázdných instancovaných vrstev,
neměnnost souřadnic, šířky čar a viewporty, filtry, zakrytí, orbitu,
likvidaci zdrojů, zpoždění tooltipu, rozpočty popisků a přerámování.

Při souběžném vizuálním testování dva výpočetně náročné testy původního
layoutu překročily pětisekundový limit se čtyřmi workery. Finální běh používá
dva workery a proběhl po ukončení vizuálních operací. Limity ani solver se
kvůli tomu neměnily. Vitest byl spuštěn mimo omezený sandbox, protože jeho
cache v sandboxu na tomto Windows vracela chybu EPERM při přejmenování.

## Ověření v Obsidianu

Nativní Obsidian 1.14.5, vault GlobeGraph: 121 poznámek, 567 spojů,
6 kontinentů, stav Up to date. Ověřeno skutečné obnovení aplikace a načtení
nového sestavení, přehled, rotace, vyhledání Note-0061, výběr, detail,
zlaté Open note, menu a přechod detailu na spodní panel.

Ve skutečném WebGL rendereru byly ověřeny nové city/terrain shadery:
PlaneGeometry, aktivní optický reliéf, 10 programů a 0 chybných programů.
Dočasný satelit se dvěma skutečnými členy existoval pouze v rendereru;
ověřil marker, halo, prstenec a link/halo shadery: 12 programů,
0 chybných programů. Poté byl obnoven původní snapshot s nulovým počtem
tagů a odstraněn dočasný testovací stav. Poznámky nebyly měněny.

Skutečný DOM v Obsidianu byl dočasně přeměřen při následujících šířkách.
Telefonní/tabletové atributy zde simulují CSS profil, nikoli fyzický GPU:

| Šířka view | CSS profil | Vodorovné přetékání view / toolbar | Text vstupu | Hlavní akce | Menu | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| 360 px | phone | 0 / 0 px | 16 px | 44 px | 320 px | spodní, 336 px |
| 600 px | tablet | 0 / 0 px | 16 px | 44 px | 320 px | spodní, 576 px |
| 900 px | desktop | 0 / 0 px | 13 px | 36 px | 320 px | boční, 256 px |
| 1440 px | desktop | 0 / 0 px | 13 px | 36 px | 320 px | boční, 288 px |

Menu ve všech případech zůstalo uvnitř view. Dočasné rozměry i atributy
byly po měření obnoveny.

## Zachování uložené mapy

Snapshot zůstává `layout-5f8c9841-b56e-452a-82d8-889570c3c731`.
Zůstalo stejných 121 cest a identická uložená geografie. Finální SHA-256
serializovaných `positionsByPath` odpovídá dřívějšímu kontrolnímu otisku:

`86002e743162127a9a0f815f1c80f53beaed2b779c33aa46ffcaf186e87acb2b`

Existující `validateAndNormalizePosition` při opětovném načtení normalizuje
jednotkové vektory. Mezi dvěma sousedními načteními tak mohou tři složky
oscilovat o nejvýše `1.1102230246251565e-16`; rozdíl nad tuto původní
normalizaci byl přesně 0. Nejde o změnu rozložení. Celý data.json nelze
porovnávat byte-for-byte, protože aplikace ukládá také kameru a cache.
Refresh ani Renew nebyl při vizuální kontrole spuštěn.

## Zachované preference a meze ověření

Uložená opacity hran, filtry a výška satelitů se nepřepisují. Pouze výchozí
opacity hran u nových nastavení je 0.24. Search si ponechává současnou
viditelnost při vzdáleném zoomu; výběr a trasa respektují původní práh hran.

Fyzický telefon/tablet, srovnání screenshotů při DPR 1 a 2 a přesnost
jednotlivých tahů ±0.25 px nebyly měřeny na reálných zařízeních. Pixelové
rozměry, telefonní redukce halo a profily jsou pokryty automatickými testy;
výše uvedené rozměry ovládání jsou ověřeny v nativním DOM. Dlouhodobý
výkon na velkém mobilním vaultu vyžaduje samostatné zařízení.

Lokální main.js je sestavený a načtený v Obsidianu. Číslo verze zůstává
1.10.1; tento krok nevytváří commit ani nepublikuje vydání.

## Iterace 2 – srovnání se screenshotem, 2. listopadu 2026

Uživatel upozornil na výrazný rozdíl vůči konceptu, příliš malé uzly/hrany
a neviditelné státy. Vycházel jsem z přiloženého skutečného snapshotu,
původního konceptu 3 a původní interaktivní vzorkovnice. Nový výsledek
z nativního Obsidianu je na [skutečném screenshotu](iteration-2-native.jpg).

| Oblast | První implementace ve snapshotu | Druhá iterace |
| --- | --- | --- |
| Města | Skoro jen tečky; uložené Globe size 155 % zmenšovalo základní průměr, minimum 2.5 px | Základ 7 px, minimum 5.5 px; jasnější střed a úzký okraj |
| Vztahy | 0.75px tah ztrácel většinu krytí při inward-only AA | 1.25px teplý tah, filtrování s pixelovým přesahem; výběr 1.9 px, trasa 2.2 px |
| Státy | U tohoto staršího layoutu chyběl celý country raster, takže nešlo pouze o slabou barvu | 18 vykreslovacích států podle skutečných podsložek; 1.2px souvislé hranice, opacity 0.82 a kartografické názvy |
| Pevnina | Světlá, vysokofrekvenční důlkovaná textura přehlušovala informace | Teplejší minerální barva, široké výškové vrstvy a směrový reliéf; jemnější grain |
| Pobřeží | 0.9px slabý tah | 1.35px zlatý obrys s opraveným krytím |

Koncept ukazuje jiné rozložení, tvary kontinentů i hustotu vztahů. Tato
iterace slaďuje materiál, měřítko a vizuální hierarchii nad skutečnými daty;
nepřemisťuje poznámky tak, aby napodobily kompozici ilustračního obrázku.
Aktuální hodnoty jsou v tokenech verze 2 a oddílu 26 specifikace.

Starší mapy dostávají cached display-only členění rozrůstající se od
skutečných pozic poznámek. Ořezání hranic používá původní pevninu v
dekorativním workeru. Toto členění se neposílá do výpočtu pobřeží ani do
layoutového solveru a neukládá se. Existující uložené státy mají přednost.
Enklávy mohou odpovídat už existujícím rozptýleným poznámkám stejné složky.

Nativní WebGL kontrola finálního materiálu a satelitních spojů: 0 chybných
programů. Přepnutí hranic ve stejném rendereru ověřilo skrytí i obnovení;
změřená šířka 1.2 px, opacity 0.82, 18 názvů států a minimum města 5.5 px.
Dočasný satelit byl odstraněn, původní snapshot obnoven, počet tagů 0,
testovací globální proměnná odstraněna. Float32 pozice rendereru byly
při testu přesně shodné.

Porovnání souboru data.json před/po potvrdilo stejný snapshotId, 121 cest,
identickou uloženou geografii a žádný dodatečně uložený country raster.
Maximální rozdíl souřadnice byl 1.11e-16 z původní load normalizace;
finální kontrolní otisk je opět
`86002e743162127a9a0f815f1c80f53beaed2b779c33aa46ffcaf186e87acb2b`.
Nové regresní testy navíc porovnávají původní land/beach/coast buffery
bez členění a s ním; všechny zůstávají přesně shodné. Cílený běh:
6 souborů, 33 testů úspěšně.

Finální `npm run check` s `VITEST_MAX_WORKERS=2`: 66 souborů a 409 testů
úspěšně; lint, typová kontrola, produkční build a release validation také
úspěšně. `git diff --check` bez chyb. Fyzická mobilní zařízení nebyla v této
iteraci testována.
