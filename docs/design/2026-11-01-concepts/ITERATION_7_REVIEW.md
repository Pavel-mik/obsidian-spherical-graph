# Živá kartografie – iterace podle osmi bodů porovnání

Dokončeno 3. listopadu 2026 v lokálním Spherical Graph 1.10.1.
Podklad: [původní koncept](03-ziva-kartografie.png), [šestá iterace](iteration-6-selection-native.jpg).
Aktuální hodnoty: tokeny schemaVersion 7 a oddíl 31 specifikace.

## Osm bodů: změna a výsledek

| Bod | Implementace | Co je vidět na novém snímku / zbývající rozdíl |
| --- | --- | --- |
| 1. Pravidelný reliéf | Větší podíl středních frekvencí, dvojí deformace pole a mělké stacionární erozní kanálky. Počet pater a výškový limit zůstaly. | Dlouhé hladké křivky se lámou do kratších členitějších záhybů. Předloha stále má větší rozmanitost skalních výběžků a nepravidelných přesahů. |
| 2. Nakreslené vrstevnice | Slabší rovnoměrné ztmavení riseru, silnější směrový lip a kontaktní stín jen na neosvětlené straně paty. Skutečná geometrie a oddělené normály zůstávají. | Povrch působí jako vrstvený materiál, méně jako plochý tisk. Drobné husté vrstvy na spodní části našeho kontinentu stále místy čtou jako rytina; reference má čitelnější větší plošiny. |
| 3. Vyprané barvy | Sytější měděnohnědé a okrové minerály, méně olivového přimíchání, hlubší cavity, méně zesvětlování nížin. | Nová pevnina je zlatohnědá, s výraznějšími tmavými záhyby. Předloha má širší škálu od světlého zlata po rezavé a měděné oblasti. |
| 4. Státy | Zachované country klíče a rastry, RGB násobitel síly 1.0, upravené jemné nádechy. Souvislá základní barva má větší váhu než prostorová minerální textura. | Teplejší střed, tlumenější pravý a zelenější levý stát lze rozeznat. Vliv světla je stále silnější než malé barevné rozdíly; záměrně nejde o nesouvisející výrazné barvy. |
| 5. Hranice | Teplý světlý inkoust 1.45 px / 0.90 a tmavý podkres 3.1 px / 0.58. Inkoust se neutlumuje směrovou lampou. | Hranice se již neztrácejí mezi vrstevnicemi a vztahy. Místy jsou nyní světlejší a rovnoměrnější než jemně proměnlivá linka předlohy. |
| 6. Pobřeží | Mělčina 0.028 rad místo 0.075, slabší vodní příměs. Neprůhledný písek v Solid režimu, zlatá linka a tmavší podkres. | Široký cyanový závoj ustoupil a zlatý okraj lépe odděluje pevninu od vody. Ilustrační pobřeží má stále více drobných stupňů a erodovaných zářezů. |
| 7. Světlo a atmosféra | Nižší ambient, silnější společný klíč shora zleva. Vnitřní lem 1.7 px a měkká vnější záře 8 px s nenulovým světlem po celém obvodu. | Horní levý okraj je zřetelně světlý, pravý/spodní terén tmavší. Reference má tenčí ostřejší zlatozelený lem; náš je měkčí a světlejší. |
| 8. Oceán a graf | Široké protažené optické záhyby oceánu, jemnější zrno. Běžné uzly 9 px / minimum 7.5 px, halo 18 px / 0.17, méně zeslabené u okraje. Tišší dálkové/hub hrany, všechny vztahy zachované. | Voda má velké směrové útvary, uzly lépe vystupují a přehled méně překrývá terén. Voda je místy pravidelněji protažená než reference. Skutečná síť má více vztahů, rozložení a křížení se nepřizpůsobovala ilustraci. |

## Skutečné snímky a celkové porovnání

- [Nový výběr](iteration-7-selection-native.jpg).
- [Nový přehled](iteration-7-overview-native.jpg).
- [Předchozí výběr](iteration-6-selection-native.jpg).
- [Původní vizualizace](03-ziva-kartografie.png).

Nativní Obsidian 1.14.5, Windows, okno 1280 × 672 px. Předloha má
1536 × 1024 px a jiné ilustrační rozmístění území. Nejde o screenshot
upravený generátorem obrázků; artefakty jsou přímé snímky běžícího pluginu.

Největší viditelný posun oproti šesté iteraci je v materiálové členitosti,
kontrastu hranic a přítomnosti atmosférického okraje. Aktuální výsledek je
v těchto bodech předloze bližší. Stále má menší barevnou rozmanitost uvnitř
jednoho kontinentu, hustší místy rytý reliéf a měkčí lem. Reference je výtvarně
bohatší a její větší patra jsou v některých oblastech čitelnější.

Tvary kontinentů, velká mořská oblast nahoře, skutečné polohy měst a počet
vztahů odpovídají uložené mapě. Pro podobnost s ilustrací nebyly přegenerovány.
Předloha uvádí 228 ilustračních vztahů, zde se vykresluje 567 skutečných.

## Ověření funkcí a vykreslování

Nativní QA nad skutečným rendererem:

| Kontrola | Výsledek |
| --- | --- |
| GPU programy při kombinaci tagů, trasy a Search | 0 chybných programů |
| Hover s mapovými popisky | jeden Note-0061, bez title s cestou, tooltip skrytý |
| Vypnuté mapové popisky | jediný náhradní tooltip Note-0061 |
| Tag linky + route + Search společně | aktivní linky i trasa, 2 Search rings |
| Transparent | oceán i písek průhledné, písek nezapisuje hloubku |
| Vypnuté kontinenty | pevnina, stěny i hranice skryté |
| Telefonní nastavení detailu | pevnina/voda 0.35, vnější lem 4 px |
| Vrcholy vykreslované pevniny | 1 070 751 |
| Min./max. poloměr při R = 10 | 10.00250 / 10.22250 |
| Města pod terénem při radiální kontrole | 0 |
| Piny | 2, fialová a58aff |
| Vykreslované vztahy | 567 |
| Pozice Float32 během dočasné QA | přesně shodné |

Hover prošel skutečným PointerEvent řetězcem s čekáním na tooltip. Dočasné
tagy, trasa, Search, filtry a appearance byly obnoveny; diagnostická globální
proměnná odstraněna. Prostorový index zůstává aktivní. Lokální kontrolní měření
20 dotazů zákrytu na jeden vybraný uzel dalo průměr 0.42 ms; nejde o měření
FPS ani záruku výkonu pro jiné mapy nebo hardware.

Hustší eroze zvýšila počet vrcholů proti šesté iteraci (842 532). Generování
odvozené geometrie i BVH běží v existujícím inline workeru; nevznikla nová
závislost nebo trvalá animace. Velké vaulty, fyzický telefon/tablet a samostatné
DPR 1/2 měření nebyly v této iteraci ověřeny.

## Zachování dat a automatické kontroly

- Celý committedLayout je přesně shodný s kopií před iterací, včetně geografie.
- SnapshotId layout-d0bd3911-80b6-43c8-89df-eea373554142, 121 uložených cest.
- Maximální rozdíl souřadnic 0; settings a pinnedNotePaths shodné.
- Nebyl spuštěn Initialize, Refresh nebo Renew; obsah poznámek se neměnil.
- npm run check s VITEST_MAX_WORKERS=2: **434 testů v 73 souborech úspěšně**,
  lint, typy, produkční build a release validation 1.10.1 úspěšně.
- git diff --check bez chyb; testovací timeouty se neměnily.

Nový test chrání determinismus, ohraničení a lokální spojitost erozního pole.
Existující testy chrání společné hrany sítě, stejné výškové kotvy, výběr,
filtrování, trasy/Search, popisky, stabilní RGB států, přesný zákryt a lifecycle.
Test Solid/Transparent nově vyžaduje neprůhledné pobřeží pouze v Solid režimu.

Změněná místa této iterace: terrainSurface, terrainMaterial, nový oceanMaterial,
countryTone, SphereLayer, HorizonGlow, NodeLayer, roadEmphasis, tokeny,
terrainSurface/NodeLayer/SphereLayer testy a designové dokumenty. Rozpracované
změny předchozích iterací zůstaly zachované. Lokální verze je stále 1.10.1;
nevznikl commit, push ani nové publikované vydání.
