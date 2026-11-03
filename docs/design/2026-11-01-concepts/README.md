# Vizuální průzkum Spherical Graph

Datum: 1. listopadu 2026.

Uživatel následně zvolil **variantu 3 — Živá kartografie**. Pro další práci platí [kompletní grafické zadání](ZIVA_KARTOGRAFIE_SPEC.md) a [barevné a rozměrové tokeny](ziva-kartografie.tokens.json). Níže zůstává původní srovnání všech tří návrhů.

Podklady: místní manifest verze 1.10.1, README, docs/CONTINENT_DESIGN.md, docs/design/DESIGN_SYSTEM.md a screenshoty spherical-graph-globe.png a spherical-graph-route.png. Posouzení vychází ze zdrojů a uložených screenshotů, nikoli z živého testu Obsidianu.

Obrázky jsou generované návrhy vzhledu s ilustrativním demo obsahem. Nejde o implementované změny ani o záruku identického výsledku v reálném čase. Geografie návrhů není přesnou reprodukcí uloženého layoutu.

## Doporučené úpravy

- Posílit objem globusu jemným směrovým světlem a stínováním. Současný procedurální reliéf a vrstevnice již existují; prioritou je jejich čitelnější světelné zpracování, ne přidávání dalšího šumu.
- Ztenčit žlutý pobřežní pás a oddělit tón pobřeží od barvy měst. Kontinenty tak budou méně připomínat ploché barevné výřezy.
- Zpřesnit hierarchii názvů: výrazné názvy kontinentů, klidnější země, lokální kontrast u poznámek a méně souběžných popisků.
- Zjemnit běžné spoje a nechat vyniknout výběr, hledání a trasy. Barevné role musí zůstat rozlišitelné, včetně vínových výsledků hledání.
- Uklidnit panel detailu: čitelný název, cesta, hlavní akce a sousedé se společným odsazením a decentními oddělovači.
- Při interakci lze přidat krátký přechod zvýraznění a jemné natočení kamery. Uložené pozice poznámek zůstávají neměnné.

## 1. Noční atlas

Soubor: 01-nocni-atlas.png

Nejlepší návaznost na stávající identitu. Temný oceán, tlumené zelené a měděné kontinenty, jemná světelná hrana a kontrastní města. Doporučený výchozí směr. Při realizaci bych ještě omezil sílu světelné hrany, žlutého pobřeží a hustotu reliéfu oproti generovanému obrázku.

## 2. Porcelánový glóbus

Soubor: 02-porcelanovy-globus.png

Světlý alternativní motiv: slonová kost, šalvěj, terakota a modrošedá. Vhodný pro light mode. V obrázku je fyzický stín pod glóbusem výraznější, než by byl potřebný v běžném Obsidian panelu. Vyžadoval by úplné světlé barevné role pro UI, oceán, popisky i zvýraznění.

## 3. Živá kartografie

Soubor: 03-ziva-kartografie.png

Nejvýraznější barevný směr. Matný plastický reliéf, petrolejový oceán a teplé barvy pevniny. Hodí se jako volitelný výraznější motiv. Terasy v obrázku jsou výtvarná inspirace; pro implementaci je vhodné napodobit dojem stínováním při zachování sférických pozic měst a hran. Příliš vysoký skutečný reliéf by komplikoval jejich viditelnost.

## Realizovatelnost

Nejprve paleta, tloušťky pobřeží a spojů, kontrast popisků a úprava detailního panelu. Následně jemnější shaderové stínování oceánu a pevniny. Detailní plastický reliéf a světlý motiv jsou větší samostatné změny a potřebují kontrolu výkonu na mobilních profilech.

Návrhy používají stávající typy ovládání a funkcí. Nebyl měněn zdrojový kód pluginu, jeho nastavení ani poznámky vaultu. Přesné prompty jsou v PROMPTS.md; použit byl vestavěný nástroj image_gen.
