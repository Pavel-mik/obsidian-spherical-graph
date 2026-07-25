# Úkol pro Codex: vytvoř samostatný Obsidian plugin „Spherical Graph“

## 1. Pracovní režim

Pracuj jako autonomní seniorní TypeScript/WebGL vývojář. Cílem není pouze analýza, návrh ani technická ukázka, ale kompletní, sestavitelný a otestovaný MVP plugin připravený k ručnímu nainstalování do Obsidianu a k následnému vydání.

Postupuj takto:

1. Nejprve prohlédni celý aktuální repozitář, všechny soubory `AGENTS.md`, existující build konfiguraci, testy, licenci a stav Git working tree.
2. Existující instrukce v repozitáři respektuj. Neměň nesouvisející soubory a nemaž užitečný kód bez důvodu.
3. Je-li repozitář prázdný, založ projekt podle aktuálního oficiálního `obsidian-sample-plugin`. Je-li už založený jako sample plugin, uprav ho.
4. Nevytvářej pouze plán. Vytvoř stručný `IMPLEMENTATION_PLAN.md`, poté plán skutečně celý realizuj a průběžně v něm označuj hotové body.
5. Nezastavuj se u scaffoldu, matematické knihovny nebo statické obrazovky. Dodej funkční plugin od načtení dat z vaultu až po interaktivní 3D vykreslení.
6. Nežádej o upřesnění běžných implementačních detailů. Zvol rozumné výchozí hodnoty, rozhodnutí zdokumentuj v `DECISIONS.md` a pokračuj.
7. Když prostředí neposkytuje GUI Obsidianu, neblokuj se tím. Proveď všechny automatizovatelné testy a sestavení a připrav přesný manuální testovací postup. Netvrď, že proběhl GUI test, pokud neproběhl.
8. Neprováděj publikaci, odeslání do Community Plugins ani push do vzdáleného repozitáře. Připrav pouze release-ready zdrojový kód a artefakty. Lokální commit vytvoř jen tehdy, pokud to vyžaduje prostředí nebo zavedený workflow repozitáře.
9. Na konci zanech pracovní strom čistý, pokud jsi commitoval. Jinak jasně vypiš změněné soubory.
10. V závěrečné zprávě uváděj pouze ověřené výsledky, spuštěné příkazy a známá omezení.

## 2. Název, identita a základní metadata

Výchozí identita pluginu:

- Název: `Spherical Graph`
- ID: `spherical-graph`
- Typ view: `spherical-graph-view`
- Počáteční verze: `0.1.0`
- Licence nového repozitáře: MIT
- Popis: `Explore your vault as a seamless graph laid out intrinsically on a sphere.`
- MVP je desktop-first. Nastav `isDesktopOnly: true`, dokud nebude mobilní verze reálně otestovaná.

Je-li dostupný internet, ověř v aktuálním oficiálním seznamu Community Plugins, zda je ID `spherical-graph` volné. Je-li obsazené, použij `spherical-graph-view` a změnu zdokumentuj. Nepoužívej v ID slovo `obsidian`.

`minAppVersion` určuj podle skutečně použitých veřejných API a aktuálního oficiálního sample pluginu. Nenastavuj jej zbytečně na nejnovější verzi.

## 3. Produktový cíl

Vytvoř nové samostatné zobrazení Obsidianu, které zobrazí síť dokumentů vaultu jako interaktivní graf umístěný na celém povrchu koule, analogicky ke globusu.

Zásadní produktové pravidlo: **pozice dokumentů nejsou živě simulované**. Layoutový solver smí běžet pouze během jedné ze tří explicitně definovaných operací: počáteční `Initialize`, uživatelský `Refresh` nebo uživatelský `Renew`. Po úspěšném dokončení se výsledné souřadnice atomicky uloží a zafixují. Běžná práce s grafem nesmí pozice dokumentů měnit.

Uživatel musí moci:

- otevřít Spherical Graph jako samostatný Obsidian `ItemView`,
- koulí plynule otáčet myší nebo trackpadem,
- zoomovat kolečkem, trackpadem a podporovaným dotykovým gestem,
- najet na uzel a zjistit název dokumentu,
- vybrat uzel a zvýraznit jeho přímé sousedy a hrany,
- otevřít odpovídající dokument,
- vyhledat dokument podle názvu nebo cesty a natočit pohled na něj,
- spustit `Refresh layout`, který zahrne změny vaultu a co nejvíce zachová původní mapu,
- spustit `Renew layout`, který vytvoří zcela nové rozmístění od začátku,
- zrušit právě probíhající výpočet bez poškození posledního uloženého layoutu,
- resetovat kameru,
- zvolit způsob zobrazení povrchu koule,
- zavřít a znovu otevřít view bez ztráty stabilní prostorové mapy.

Plugin nesmí upravovat obsah poznámek. Smí číst metadata vaultu a ukládat pouze vlastní nastavení a vlastní layoutový stav.

### 3.1 Pevný stav po výpočtu

Po dokončení `Initialize`, `Refresh` nebo `Renew` platí:

- všechny pozice uzlů jsou neměnné až do další explicitní layoutové operace,
- solver neběží,
- worker není aktivní,
- rychlosti ani fyzikální stav se neukládají,
- otáčení koule, zoom, hover, výběr, hledání, otevření dokumentu ani změna kamery nesmějí měnit layoutové souřadnice,
- plugin nesmí nabízet drag-and-drop přesouvání jednotlivých uzlů,
- plugin nesmí automaticky spouštět relaxaci po každé změně vaultu.

Kamera nebo kořenová Three.js skupina se mohou otáčet, ale uložené jednotkové vektory uzlů zůstávají beze změny.

### 3.2 `Initialize`

`Initialize` je interní automatická operace, která se spustí pouze tehdy, když pro aktuální vault a zvolený datový filtr neexistuje žádný použitelný uložený layout.

Postup:

1. sestav aktuální graf,
2. deterministicky inicializuj všechny uzly na sféře,
3. spočítej intrinsickou rovnováhu,
4. validuj výsledné pozice,
5. atomicky ulož kompletní layout,
6. ukonči solver a worker,
7. zobraz fixní mapu.

Při prvním výpočtu zobraz progress stav. Mezivýsledné polohy nevykresluj ani při prvním výpočtu; renderer dostane pouze finální validní snapshot.

### 3.3 `Refresh`

`Refresh` je explicitní inkrementální operace určená pro nové, odstraněné nebo přejmenované dokumenty, změněné odkazy a změny datových filtrů.

Musí:

- vycházet z posledních uložených pozic existujících dokumentů,
- inicializovat nové dokumenty poblíž jejich uložených sousedů, případně v málo obsazených částech sféry,
- odstranit neexistující dokumenty,
- zachovat pozici přejmenovaného dokumentu, je-li rename spolehlivě detekovaný,
- nejprve optimalizovat nové uzly při fixovaných starých uzlech,
- následně povolit pouze omezenou relaxaci relevantních starých uzlů,
- použít kotvicí energii a maximální povolený úhlový posun starých uzlů,
- ponechat vzdálené nedotčené uzly zcela fixní, je-li to možné,
- po konvergenci atomicky nahradit starý layout novým,
- po dokončení opět přejít do pevného stavu.

`Refresh` není automatický. Změny vaultu se pouze detekují a zobrazí jako pending stav, například `Changes detected: +7 notes · -2 notes · 11 changed links`. Uživatel rozhodne, kdy výpočet spustí.

### 3.4 `Renew`

`Renew` je explicitní kompletní přegenerování mapy.

Musí:

- ignorovat všechny předchozí pozice jako layoutové kotvy,
- vytvořit novou deterministickou inicializaci z aktuálního grafu,
- spočítat globální rovnováhu bez penalizace vůči starému layoutu,
- upozornit uživatele, že se může změnit celá mentální mapa,
- nahradit uložený layout teprve po úspěšném dokončení a validaci.

Starý layout nesmí být destruktivně smazán před úspěchem `Renew`. Při chybě nebo zrušení musí zůstat použitelný.

### 3.5 Transakční chování výpočtu

Během `Refresh` nebo `Renew` ponech poslední uloženou mapu na obrazovce a interaktivní. Neanimuj průběžný pohyb uzlů. Worker posílá pouze diagnostický progress a jednou finální pozice.

Výsledek commitni jako celek pouze tehdy, když:

- operace doběhla úspěšně,
- délky bufferů odpovídají grafu,
- všechny souřadnice jsou konečné a normalizovatelné,
- maximální chyba jednotkové normy je v toleranci,
- výsledek odpovídá identifikátoru a signatuře vstupu dané operace.

Při `Cancel`, chybě workeru, zavření view během výpočtu nebo neplatném výsledku se poslední committed layout nesmí změnit.

## 4. Nevyjednatelné geometrické požadavky

Tato část má vyšší prioritu než jakékoli zjednodušení.

### 4.1 Skutečný layout na sféře

Každý uzel musí mít interní pozici jako jednotkový 3D vektor

\[
u_i \in \mathbb{R}^3,\qquad \lVert u_i\rVert=1.
\]

Vykreslovaná pozice je

\[
p_i = R u_i
\]

s případným velmi malým čistě renderovacím offsetem proti z-fightingu.

Layout se musí počítat přímo na varietě \(S^2\). Zeměpisná šířka a délka mohou existovat pouze jako odvozené diagnostické hodnoty. Nesmějí být primárním prostorem layoutu.

### 4.2 Bez švu

Nesmí existovat obdélníková mapa s levým a pravým okrajem. Body odpovídající délkám \(+179^\circ\) a \(-179^\circ\) musí být považovány za blízké.

Zakázané přístupy:

- nejprve vytvořit 2D force-directed graf a potom jej equirektangulárně promítnout na kouli,
- „omotat“ rovinný graf kolem válce nebo sféry,
- používat v layoutu rozdíl zeměpisných délek bez periodické geometrie,
- rozříznout sféru v libovolném poledníku,
- používat UV souřadnice jako fyzikální souřadnice layoutu.

### 4.3 Pouze povrch, nikoli objem

Všechny layoutové pozice musí po každém integračním kroku splňovat \(\lVert u_i\rVert=1\) v numerické toleranci. Žádný uzel nesmí být umístěn uvnitř koule podle stupně, centrality ani jiné metriky.

Zakázané je kulové „volume layout“, kde významné uzly leží u středu a ostatní u povrchu.

### 4.4 Hrany po povrchu

Hrany mezi uzly musí být vykreslené jako aproximace nejkratšího geodetického oblouku po sféře. Nesmějí být kreslené jako přímé tětivy procházející vnitřkem koule.

Každý vzorkovaný bod hrany musí po normalizaci ležet na poloměru \(R+\varepsilon\), kde \(\varepsilon\) je pouze malý renderovací offset.

### 4.5 Využití celého povrchu

Samotná podmínka pevného poloměru nestačí. Layout musí obsahovat odpuzování a globální regularizaci pokrytí, aby se graf bez důvodu nesesunul do malé oblasti jedné polokoule.

### 4.6 Realistické omezení

Neslibuj odstranění všech křížení hran. Libovolný neplanární graf se může křížit i na sféře. Cílem je bezšvová kulová mapa, ne zaručeně rovinné vložení každého grafu.

## 5. Technologický základ

Použij:

- TypeScript v přísném režimu,
- veřejné Obsidian Plugin API,
- Three.js pro WebGL vykreslení,
- Dedicated Web Worker pro výpočetně omezené operace `Initialize`, `Refresh` a `Renew`; v běžném pevném stavu žádný worker neběží,
- Vitest nebo aktuální ekvivalentní lehký test runner kompatibilní s projektem,
- ESLint a TypeScript typecheck,
- esbuild podle současného oficiálního sample pluginu.

Nepoužívej React, pokud pro něj nevznikne prokazatelná potřeba. UI view a settings vytvoř idiomaticky pomocí Obsidian API a běžného DOM.

Nepoužívej `d3-force-3d` ani jiný eukleidovský force solver jako finální layout. Lze použít pouze vlastní intrinsický solver na \(S^2\).

Nepoužívej soukromá nebo nezdokumentovaná Obsidian API, interní implementaci core Graph View ani DOM hacky do vestavěného grafu.

Nevytvářej fork jiného graph pluginu a nekopíruj z něj implementaci. Plugin má být samostatná implementace založená na oficiálním sample pluginu. Případné studium cizího projektu smí být pouze koncepční; žádný převzatý kód bez kompatibilní licence, atribuce a jasného zdokumentování.

## 6. Povinná architektura

Zachovej jasné oddělení odpovědností. Přesné názvy lze mírně upravit, ale výsledná struktura musí mít obdobné moduly:

```text
src/
  main.ts
  constants.ts
  types.ts

  settings/
    settings.ts
    SphericalGraphSettingTab.ts

  graph/
    GraphDataService.ts
    GraphChangeTracker.ts
    graphTypes.ts
    graphFilters.ts
    graphSignature.ts
    graphDiff.ts

  geometry/
    vector3.ts
    sphericalGeometry.ts
    geodesicArc.ts
    deterministicHash.ts
    rotationAlignment.ts

  layout/
    layoutTypes.ts
    SphericalSolver.ts
    forces.ts
    initialization.ts
    RefreshPlanner.ts
    anchoring.ts
    spatialHash.ts
    workerProtocol.ts
    worker-entry.ts
    LayoutLifecycleController.ts

  render/
    SphericalGraphRenderer.ts
    NodeLayer.ts
    EdgeLayer.ts
    SphereLayer.ts
    LabelLayer.ts
    PickingController.ts
    renderTypes.ts

  view/
    SphericalGraphView.ts
    ViewToolbar.ts
    SearchController.ts
    LayoutStatusPresenter.ts

  persistence/
    PluginDataStore.ts
    layoutState.ts
    migrations.ts

tests/
  geometry/
  layout/
  graph/
  persistence/
  lifecycle/

scripts/
  generate-test-vault.mjs
  benchmark-layout.mjs
```

Dále vytvoř:

- `AGENTS.md`
- `README.md`
- `ARCHITECTURE.md`
- `ALGORITHM.md`
- `DECISIONS.md`
- `IMPLEMENTATION_PLAN.md`
- `MANUAL_TEST_PLAN.md`
- `VALIDATION.md`
- `CHANGELOG.md`
- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `.github/workflows/ci.yml`
- `manifest.json`
- `versions.json`
- `styles.css`
- `package.json`
- lockfile
- aktuální build, lint a TypeScript konfiguraci.

Nevytvářej jeden monolitický `main.ts`. Matematické jádro, lifecycle, worker, renderer, persistence a Obsidian integrace musí být testovatelné odděleně.

### 6.1 Povinný stavový automat layoutu

`LayoutLifecycleController` musí být jediným vlastníkem přechodů mezi stavy. Minimální model:

```ts
type LayoutLifecycleState =
  | { kind: "no-layout" }
  | { kind: "initializing"; operationId: string }
  | { kind: "fixed-clean"; snapshotId: string }
  | { kind: "fixed-dirty"; snapshotId: string; diff: GraphDiffSummary }
  | { kind: "refreshing"; operationId: string; snapshotId: string }
  | { kind: "renewing"; operationId: string; snapshotId?: string }
  | { kind: "error"; previousSnapshotId?: string; message: string };
```

Přesný typ lze upravit, ale musí platit:

- současně smí běžet nejvýše jedna layoutová operace,
- renderer nesmí přímo spouštět solver,
- vault event nesmí přímo spouštět solver,
- `Refresh` je povolen pouze z pevného stavu s použitelným snapshotem; bez snapshotu se použije `Initialize`,
- `Renew` je povolen z pevného nebo chybového stavu,
- terminální worker message vede buď k atomickému commitu, nebo k návratu k předchozímu pevnému snapshotu,
- stale message se starým `operationId` se ignoruje,
- ve stavu `fixed-clean` ani `fixed-dirty` nesmí existovat aktivní solver ani worker.

### 6.2 Oddělení committed a working stavu

Udržuj dvě jasně oddělené vrstvy:

- **committed snapshot** – poslední validní, uložené a vykreslované pozice,
- **working result** – dočasné buffery právě probíhající operace.

Working buffery se nesmějí průběžně zapisovat do persistence ani do rendereru. Renderer dostane nový layout až jedním atomickým voláním po úspěšném dokončení.

## 7. Datový model grafu

### 7.1 Uzly

Výchozí uzly jsou všechny Markdown soubory vrácené veřejným Obsidian API.

Každý uzel musí obsahovat minimálně:

```ts
interface GraphNode {
  index: number;
  id: string;          // stabilní ID v rámci aktuálního vaultu; výchozí je path
  path: string;
  basename: string;
  degree: number;
  weightedDegree: number;
  exists: true;
}
```

Interní layout používá kompaktní číselné indexy. Cesty a názvy zůstávají v hlavním vlákně a do workeru se neposílají opakovaně.

### 7.2 Hrany

Použij veřejný index vyřešených odkazů Obsidianu. Z jednoho nebo více odkazů vytvoř váženou hranu.

Pro layout kombinuj směry `A -> B` a `B -> A` do jedné neorientované hrany:

```ts
interface GraphEdge {
  source: number;
  target: number;
  weight: number;
  forwardWeight: number;
  backwardWeight: number;
}
```

Požadavky:

- ignoruj self-links,
- sluč duplicitní odkazy,
- zachovej součet počtů odkazů jako váhu,
- nevyřešené odkazy v MVP nezobrazuj,
- žádný skrytý limit uzlů,
- izolované dokumenty lze zobrazit nebo skrýt nastavením,
- výchozí stav izolované dokumenty zobrazuje,
- podporuj seznam prefixů vyloučených složek,
- třídění uzlů musí být deterministické, například podle cesty.

### 7.3 Změny vaultu

Reaguj pouze pomocí veřejných, typovaných eventů na:

- vytvoření Markdown souboru,
- smazání,
- přejmenování,
- změnu metadata cache nebo vyřešených odkazů,
- změnu aktivního souboru.

Eventy z vaultu pouze debouncovaně znovu sestaví nebo přepočítají **datový model a jeho signaturu**. Nesmějí samy spustit layoutový solver.

Zaveď `GraphDiff`, který proti poslednímu committed snapshotu rozliší minimálně:

```ts
interface GraphDiffSummary {
  addedNodeIds: string[];
  removedNodeIds: string[];
  renamedNodes: Array<{ oldPath: string; newPath: string }>;
  addedEdgeCount: number;
  removedEdgeCount: number;
  changedEdgeWeightCount: number;
  filterChanged: boolean;
}
```

Po detekci změny:

- přejdi z `fixed-clean` do `fixed-dirty`,
- zobraz uživateli stručný počet pending změn,
- nespouštěj výpočet,
- zachovej všechny uložené souřadnice,
- změna aktivního dokumentu pouze upraví zvýraznění a nikdy nemění graph signature ani layout.

Při přejmenování přenes uloženou pozici ze staré cesty na novou cestu, pokud event poskytuje spolehlivou starou cestu. Čistý rename bez změny topologie nesmí sám o sobě vyžadovat pohyb uzlu.

Pro zobrazení mezi změnou vaultu a `Refresh` použij následující pravidla:

- aktuální dokument s validní uloženou pozicí lze zobrazit na této pevné pozici,
- nový dokument bez committed pozice zatím nezobrazuj jako běžný uzel; zahrň jej do pending počtu,
- smazaný dokument a jeho incidentní hrany z rendereru odstraň bez pohybu ostatních uzlů,
- přejmenovaný dokument zobraz na původní pozici pod novým názvem,
- odkazy mezi dokumenty, které už mají committed pozice, lze aktualizovat okamžitě bez změny pozic,
- `Refresh` následně přepočítá rovnováhu aktuálního kompletního grafu.

Změny vzniklé během běžícího `Refresh` nebo `Renew` nevyvolají automatický restart. Zachyť novou current signature; dokončený výsledek patří signatuře zachycené na začátku operace a po commitu zůstane stav `fixed-dirty`, pokud mezitím přibyly další změny.

## 8. Matematické jádro

Veškeré následující funkce vytvoř jako čisté funkce s jednotkovými testy.

### 8.1 Geodetická vzdálenost

Použij numericky stabilní úhlovou vzdálenost:

\[
\theta(u,v)=
\operatorname{atan2}
\left(
\lVert u\times v\rVert,
\operatorname{clamp}(u\cdot v,-1,1)
\right).
\]

Nepoužívej jako hlavní vzdálenost délku tětivy \(\lVert u-v\rVert\).

### 8.2 Projekce do tečné roviny

Pro sílu \(f\) v bodě \(u\):

\[
P_u(f)=f-(u\cdot f)u.
\]

Po sečtení všech sil vždy proveď projekci do tečné roviny.

### 8.3 Tečný směr k druhému bodu

\[
t_{u\rightarrow v}
=
\operatorname{normalize}
\left(
v-(u\cdot v)u
\right).
\]

Pro téměř totožné nebo antipodální body implementuj deterministický fallback. Fallback nesmí používat nedeterministické `Math.random()`.

### 8.4 Exponenciální mapa

Pozici aktualizuj přes exponenciální mapu. Pro tečný krok \(\delta\):

\[
u'=
\cos(\lVert\delta\rVert)u+
\sin(\lVert\delta\rVert)\frac{\delta}{\lVert\delta\rVert}.
\]

Pro velmi malý krok použij stabilní aproximaci a výsledek normalizuj.

Pouhé eukleidovské posunutí a normalizace může být nouzová větev pro extrémně malý krok, nikoli základ celého solveru.

### 8.5 Paralelní stabilita rychlosti

Po přesunu reprojektuj rychlost do nové tečné roviny. Není nutné implementovat přesný obecný paralelní transport, ale rychlost nesmí získat radiální složku.

### 8.6 SLERP a geodetický oblouk

Pro běžné body použij:

\[
q(t)=
\frac{\sin((1-t)\theta)}{\sin\theta}u+
\frac{\sin(t\theta)}{\sin\theta}v.
\]

Implementuj tři numerické režimy:

1. běžný SLERP,
2. téměř totožné body: normalizovaná lineární interpolace,
3. téměř antipodální body: deterministicky zvolená ortogonální rovina podle hashů ID obou uzlů.

Všechny vzorky normalizuj. Výsledek musí být deterministický pro stejnou dvojici ID bez ohledu na pořadí obnovy view.

## 9. Intrinsický layoutový solver na \(S^2\)

Implementuj vlastní `SphericalSolver`. Solver je dávkový výpočet, nikoli trvale běžící fyzikální simulace.

Vstupy a pracovní stav drž v typed arrays:

- `Float32Array positions`, délka `3 * n`,
- `Float32Array velocities`, délka `3 * n`, pouze dočasně během jedné operace,
- `Uint32Array edgeEndpoints`, délka `2 * m`,
- `Float32Array edgeWeights`, délka `m`,
- `Uint8Array movableMask` nebo ekvivalent,
- `Float32Array anchorPositions`, je-li režim `refresh`,
- `Float32Array anchorStrengths`, je-li režim `refresh`,
- `Float32Array maxAnchorDistances`, je-li režim `refresh`,
- případně pomocné typed arrays pro síly a prostorové buňky.

Definuj explicitní režim:

```ts
type LayoutOperationMode = "initialize" | "refresh" | "renew";
```

`initialize` a `renew` používají stejnou matematiku úplného layoutu, ale liší se lifecyclem a UX. `initialize` je automatický pouze při chybějícím layoutu; `renew` je explicitní a potvrzený uživatelem.

### 9.1 Inicializace podle režimu

Pořadí uzlů musí být deterministické.

#### `Initialize` a `Renew`

- použij Fibonacciho rozložení na sféře s golden angle,
- aplikuj deterministickou permutaci přiřazení uzlů k Fibonacciho bodům a případný tečný jitter podle efektivního seedu; nespoléhej pouze na globální rotaci, která by nezměnila vnitřní mapu,
- nepoužívej nekontrolované `Math.random()`,
- všechny uzly jsou pohyblivé,
- nepoužívej anchor energy vůči předchozímu layoutu.

#### `Refresh`

- existující uzly inicializuj přesně uloženými a normalizovanými pozicemi,
- nový uzel se známými uloženými sousedy umísti poblíž normalizovaného váženého průměru jejich pozic; je-li součet téměř nulový například kvůli antipodálním sousedům, použij deterministický volný Fibonacciho kandidát,
- přidej malý deterministický tečný jitter, aby více nových uzlů nezačínalo na totožném bodě,
- nový izolovaný uzel nebo uzel bez uloženého souseda umísti na málo obsazený Fibonacciho kandidát,
- chybné, nulové nebo nečíselné uložené pozice odmítni a daný uzel považuj za nový,
- smazané uzly do pracovního grafu nezařazuj.

Speciálně ošetři grafy s 0, 1 a 2 uzly.

### 9.2 Pružiny hran

Pro každou hranu použij geodetickou vzdálenost a tečné směry.

Výchozí cílový úhel odvoď od očekávané rozteče bodů:

\[
\theta_\text{base} \approx c\sqrt{\frac{4\pi}{n}}.
\]

Hodnotu omez rozumným minimem a maximem. Vyšší váha hrany smí cílový úhel mírně zkrátit a sílu zvýšit, ale nesmí vytvořit singularitu.

Síla na uzlu \(i\) má tvar obdobný:

\[
F_i^\text{spring}
=
k_s\,g(w_{ij})\,(\theta_{ij}-\theta_{0,ij})
\,t_{i\rightarrow j}.
\]

Pro druhý uzel použij jeho vlastní tečný směr \(t_{j\rightarrow i}\), ne prostou negaci globálního vektoru.

### 9.3 Odpuzování

Pro malý graf použij přesné párové odpuzování. Výchozí práh může být přibližně 400 uzlů a musí být konstantou nebo pokročilým nastavením.

Vhodná hladká velikost odpuzování je například omezená varianta

\[
k_r \cot\left(\frac{\theta}{2}\right),
\]

která je silná u blízkých uzlů a klesá směrem k antipodům. Ošetři numerickou singularitu a sílu capuj.

Pro větší graf nesmí jedna iterace provádět všechny dvojice. Použij hybrid:

- lokální kolizní odpuzování přes prostorový hash v 3D souřadnicích jednotkové sféry,
- sousední buňky kontroluj podle chord distance odpovídající lokálnímu úhlovému dosahu,
- pro globální odpuzování použij pevný počet deterministicky pseudonáhodných negativních vzorků na pohyblivý uzel,
- výchozí počet může být 16–32 vzorků na pohyblivý uzel,
- sampled režim musí mít počet vyhodnocených párů asymptoticky lineární v počtu pohyblivých uzlů, s výjimkou lokálně přeplněných buněk,
- PRNG musí být seedovaný a reprodukovatelný.

V režimu `refresh` neplýtvej výpočtem sil mezi dvěma hard-fixed uzly, protože jejich pozice se nezmění.

### 9.4 Globální pokrytí povrchu

Implementuj minimálně dvě levné globální regularizace.

Střed:

\[
\mu=\frac{1}{n}\sum_i u_i,
\qquad
E_\mu=\lVert\mu\rVert^2.
\]

Druhý moment:

\[
C=\frac{1}{n}\sum_i u_i u_i^\mathsf{T},
\qquad
E_C=\left\lVert C-\frac{1}{3}I\right\rVert_F^2.
\]

Do sil přidej záporné tečné gradienty odpovídající zmenšování \(E_\mu\) a \(E_C\). Konstanty mohou být absorbované do nastavitelných vah.

Tato regularizace nesmí nahradit lokální odpuzování; obě části jsou povinné. V `refresh` režimu aplikuj globální regularizaci pouze na pohyblivé uzly, ale diagnostiku počítej nad celou aktuální mapou.

### 9.5 Zachování mentální mapy při `Refresh`

`RefreshPlanner` musí z rozdílu grafů vytvořit množinu změnou ovlivněných uzlů.

Za přímo ovlivněné považuj minimálně:

- nové uzly,
- existující sousedy nových uzlů,
- koncové uzly přidaných, odstraněných nebo váhově změněných hran,
- existující sousedy odstraněných uzlů,
- uzly dotčené změnou datového filtru.

Rozšiř množinu o konfigurovatelný počet grafových kroků, výchozí hodnota například 2. Nedotčené staré uzly ponech hard-fixed. Tím se sníží výpočet a zachová stabilita mapy.

`Refresh` proveď minimálně ve dvou fázích:

1. **New-node warm-up** – staré uzly jsou zcela fixní, pohybují se pouze nové uzly.
2. **Anchored local relaxation** – nové a ovlivněné staré uzly se mohou pohybovat; ostatní staré uzly zůstávají hard-fixed.

Pro pohyblivý starý uzel s uloženou kotvou \(a_i\) přidej energii:

\[
E_\text{anchor}
=
\sum_{i\in V_\text{old,movable}}
\lambda_i\,d_{S^2}(u_i,a_i)^2.
\]

Negativní gradient vede po geodetickém směru zpět ke kotvě s velikostí úměrnou \(2\lambda_i\theta_i\).

Požadavky:

- nové uzly nemají anchor penalty,
- přímo ovlivněné staré uzly mohou mít slabší kotvu než uzly na okraji relaxované oblasti,
- každý starý pohyblivý uzel má maximální povolený úhlový posun od své uložené kotvy,
- navrženou pozici za tímto limitem geodeticky clampuj na hranici povoleného kužele,
- počet clampovaných uzlů reportuj,
- výchozí maximální posun volte konzervativně, například 10–15°; nastav jej jako pokročilou volbu,
- `Refresh` bez skutečného diffu je no-op a nesmí vytvářet worker,
- pokud změny překročí konfigurovatelný podíl grafu, například 20 %, zobraz varování, že `Renew` může dát kvalitnější globální výsledek; přesto automaticky nepřepínej režim.

Pokud kvůli velké změně není žádný starý uzel hard-fixed, po dokončení zarovnej nový výsledek k předchozím pozicím pomocí nejlepší vlastní 3D rotace nad společnými uzly, například Kabsch/orthogonal Procrustes bez reflexe. Tato rotace smí změnit pouze globální orientaci, nikoli vnitřní vzdálenosti.

### 9.6 Integrace

Použij tlumenou rychlost v tečné rovině:

1. sečti síly pouze pro pohyblivé uzly,
2. projekce síly do tečné roviny,
3. aktualizace a tlumení rychlosti,
4. omezení maximální úhlové rychlosti,
5. exponenciální mapa,
6. v `refresh` režimu aplikuj geodetický displacement clamp vůči kotvě,
7. reprojekce rychlosti do nové tečné roviny.

Implementuj cooling nebo adaptivní velikost kroku. Každá operace začíná s novým deterministickým pracovním stavem. Neimplementuj dlouhodobé „reheat“ chování ani pokračování běžící fyziky po skončení operace.

Zrušení operace kontroluj mezi omezenými dávkami iterací, aby `Cancel` reagoval bez dlouhého čekání.

### 9.7 Ukončení, validace a zafixování

Solver zastav, když:

- maximální úhlový posun pohyblivých uzlů zůstane pod tolerancí po definovaný počet iterací nebo reportovacích cyklů,
- nebo je dosažen maximální počet iterací,
- nebo přijde `Cancel`.

Před úspěšným výsledkem:

- normalizuj všechny pozice,
- ověř konečnost všech hodnot,
- ověř odpovídající délku bufferu,
- vypočti maximální norm error,
- v `refresh` režimu ověř displacement limit starých uzlů,
- v případě potřeby proveď globální rotační zarovnání,
- vrať finální buffer pouze jednou.

Po commitu:

- zahoď velocities a všechny pracovní buffery,
- ukonči worker,
- nevykonávej žádné další iterace,
- pozice považuj za fixní až do dalšího `Refresh` nebo `Renew`.

Neimplementuj uživatelské `Pause` ani `Resume`. Jediná kontrola běžící dávkové operace je `Cancel`.

### 9.8 Diagnostika

Každý progress report solveru má obsahovat minimálně:

```ts
interface LayoutProgress {
  operationId: string;
  mode: LayoutOperationMode;
  phase: "initial" | "new-node-warmup" | "anchored-relaxation" | "finalizing";
  iteration: number;
  maxAngularDisplacement: number;
  meanVectorNorm: number;
  covarianceDiagonal: [number, number, number];
  evaluatedRepulsionPairs: number;
  movableNodeCount: number;
  anchoredNodeCount: number;
  hardFixedNodeCount: number;
  cappedNodeCount: number;
  maxExistingNodeDisplacement: number;
  elapsedMs: number;
}
```

Diagnostiku zobraz stručně ve statusu view a použij ji v benchmarku. Progress nesmí obsahovat celý position buffer. Nezahlcuj konzoli v běžném režimu.

## 10. Web Worker a build

Layout běží standardně v krátkodobém Dedicated Web Workeru. Worker vzniká pouze při `Initialize`, `Refresh` nebo `Renew` a po terminální zprávě se ukončí. Ve stavu fixní mapy nesmí worker zůstávat aktivní.

### 10.1 Protokol

Definuj typovaný discriminated-union protokol.

Hlavní vlákno → worker:

- `run` – obsahuje `operationId`, `mode`, input graph signature, typed arrays, solver settings a podle režimu anchor data,
- `cancel` – obsahuje `operationId`,
- `dispose` – nouzové ukončení.

Worker → hlavní vlákno:

- `started`,
- `progress` – pouze diagnostika bez pozic,
- `completed` – jednorázově finální position buffer, diagnostika a input signature,
- `cancelled`,
- `error`.

Příklad minimálního výsledku:

```ts
interface LayoutCompletedMessage {
  type: "completed";
  operationId: string;
  mode: LayoutOperationMode;
  graphSignature: string;
  positions: Float32Array;
  diagnostics: LayoutFinalDiagnostics;
}
```

Všechny message handlery musí validovat typ zprávy, `operationId`, signaturu a základní délky bufferů. Stale zprávy ignoruj. Chybu propaguj do UI s uživatelsky srozumitelnou hláškou.

Neimplementuj protokol `pause`, `resume`, `updateGraph` ani průběžnou výměnu živého solver state. Změny grafu během operace se evidují jako nový pending diff pro další explicitní `Refresh`.

### 10.2 Jediný release soubor

Obsidian release standardně pracuje s `main.js`, `manifest.json` a `styles.css`. Worker proto nesmí vyžadovat samostatný soubor, který se do instalace automaticky nedostane.

Uprav esbuild tak, aby:

1. `worker-entry.ts` sestavil jako browser IIFE do paměti,
2. vložil výsledný zdroj workeru jako string do hlavního bundle přes virtuální modul nebo ekvivalentní spolehlivý mechanismus,
3. hlavní vlákno vytvořilo worker z `Blob` URL,
4. po `completed`, `cancelled`, `error`, zavření view nebo unloadu worker ukončilo,
5. Blob URL revokovalo, jakmile už není potřebná.

Nepoužívej runtime `new URL("./worker.js", import.meta.url)`, pokud by build emitoval další soubor.

### 10.3 Přenos výsledků

Progress reportuj nejvýše přibližně 4–10krát za sekundu. Neposílej zprávu při každé mikroiteraci.

Celý position buffer přenes pouze jednou v `completed`. Použij transferable `ArrayBuffer`, protože solver po odeslání končí a pracovní buffer už nepotřebuje. Před transferem proveď finální validaci nebo použij validovanou finální kopii.

Nepoužívej `SharedArrayBuffer`, protože MVP na něm nesmí záviset.

### 10.4 Fallback

Pokud vytvoření workeru selže, použij stejný čistý `SphericalSolver` v hlavním vlákně po malých dávkách s pravidelným yieldem event loopu. Fallback nesmí blokovat UI dlouhou synchronní smyčkou.

Stejně jako worker:

- neposílá rendereru mezivýsledné pozice,
- podporuje `Cancel`,
- commitne pouze finální validní výsledek,
- po dokončení uvolní pracovní buffery.

Zobraz informaci, že běží pomalejší kompatibilní režim.

## 11. Three.js renderer

### 11.1 Životní cyklus

Renderer vznikne až při otevření view, nikoli v `Plugin.onload()`.

Použij:

- `Scene`,
- `PerspectiveCamera`,
- `WebGLRenderer`,
- `Group` pro celý graf,
- `InstancedMesh` pro uzly,
- jeden nebo malý počet `BufferGeometry` objektů pro hrany,
- `Raycaster` pro picking,
- `ArcballControls` jako výchozí ovládání kamery.

Panování vypni. Povol rotaci a zoom. Nastav bezpečné `minDistance` a `maxDistance`.

Použij canvas vytvořený přes `contentEl.ownerDocument`. Nepředpokládej, že view vždy běží v hlavním `window`; musí fungovat i v Obsidian pop-out okně. `requestAnimationFrame`, eventy a rozměry ber z owner window/document, kde je to možné.

### 11.2 Render loop

Použij invalidation-based rendering:

- render při změně kamery,
- render při atomickém načtení nového committed layoutu,
- render při změně hoveru, výběru, viditelné topologie, velikosti nebo theme,
- během animace focusu plánuj další snímek,
- po ustálení kamery nenechávej bezdůvodně běžet permanentní 60fps smyčku.

Během `Refresh` nebo `Renew` renderer nadále zobrazuje poslední committed layout. Progress se mění pouze v DOM statusu. Mezivýsledné solver pozice se nesmějí renderovat.

V pevném stavu musí být možné porovnat position buffer před a po libovolné sérii interakcí a získat identické hodnoty.

### 11.3 Uzly

Použij jeden `InstancedMesh` s nízkopolygonální koulí nebo jinou jednoduchou prostorovou značkou.

Požadavky:

- per-instance transformace,
- per-instance barva,
- velikost volitelně podle logaritmu stupně,
- aktivní, vybraný a hoverovaný uzel musí mít odlišitelné zvýraznění,
- raycasting musí mapovat `instanceId` na `GraphNode`,
- po změně instancí správně nastav `instanceMatrix.needsUpdate` a `instanceColor.needsUpdate`,
- aktualizuj bounding sphere, když je to pro picking/culling potřeba.

### 11.4 Hrany

Vytvoř batched `BufferGeometry` pro `LineSegments`.

Pro každou hranu:

- vypočti geodetický úhel,
- zvol adaptivní počet segmentů podle úhlu, například clamp 2–32,
- vzorkuj geodetický oblouk přes robustní SLERP,
- každý bod vynásob `R + edgeLift`,
- hrany neregeneruj při pouhém pohybu kamery,
- hrany regeneruj po atomickém commitu nového layoutu nebo při změně viditelné topologie mezi uzly, které už mají fixní pozice,
- výchozí hrany jsou jemné a poloprůhledné,
- při výběru uzlu zvýrazni jeho přímé hrany a ostatní ztlum.

Nespoléhej na široké WebGL čáry. Základní šířka 1 px je přijatelná.

### 11.5 Povrch koule

Nabídni tři režimy:

- `solid`: neprůhledný nebo téměř neprůhledný povrch; zadní polokoule je přirozeně skrytá depth testem,
- `transparent`: jemně průhledný „x-ray“ povrch,
- `hidden`: samotná síť bez mesh povrchu.

Povrch je vizuální pomůcka, ne nosič layoutu. Použij jednoduchý materiál kompatibilní se světlým i tmavým tématem.

### 11.6 Labely

Nevytvářej DOM label pro každý uzel.

Implementuj pool omezeného počtu HTML labelů, výchozí maximum přibližně 80. Kandidáti:

1. aktivní uzel,
2. hoverovaný a vybraný uzel,
3. přímí sousedé vybraného uzlu,
4. nejvýznamnější viditelné uzly podle stupně.

Projektuj 3D pozice do obrazovky a skrývej labely zadní polokoule v `solid` režimu. Limit a výchozí viditelnost labelů musí být nastavení.

### 11.7 Theme a resize

Použij `ResizeObserver`. Při změně rozměrů aktualizuj aspect kamery, projection matrix, pixel ratio a velikost rendereru. Pixel ratio capuj, například na 2.

Barvy odvozuj z Obsidian CSS variables přes `getComputedStyle`. Reaguj pouze přes veřejný typovaný event, pokud existuje; jinak použij úzce zaměřený `MutationObserver` na theme class a při dispose jej odpoj.

## 12. Interakce

Povinné chování:

- drag na prázdném prostoru: rotace pohledu kolem středu koule,
- uzly samotné nelze tažením přemisťovat,
- wheel/pinch: zoom,
- hover uzlu: tooltip s basename a úplnou cestou,
- click bez významného drag pohybu: vybrat uzel,
- klik na prázdné místo nebo `Escape`: zrušit výběr,
- double-click nebo `Enter` nad vybraným výsledkem: otevřít soubor,
- `Ctrl/Cmd + click`: otevřít v nové kartě,
- hledání: fuzzy filtr basename i path,
- výběr výsledku hledání: vybrat uzel a plynule natočit kameru tak, aby byl vpředu,
- programatický focus nesmí přepisovat uložené layoutové souřadnice,
- aktivní Markdown soubor v workspace se musí v grafu zvýraznit,
- při drag operaci nesmí omylem dojít k otevření uzlu; použij práh pohybu.

Vytvoř toolbar uvnitř view:

- search,
- `Refresh layout`,
- `Renew layout`,
- `Cancel calculation`, viditelné nebo enabled pouze při běžící operaci,
- `Reset camera`,
- přepínač surface mode,
- stručný status.

Status musí jasně rozlišit minimálně:

- `No saved layout`,
- `Initializing · iteration …`,
- `Up to date · N nodes · M edges`,
- `Changes detected · +N / -N notes · K link changes`,
- `Refreshing · phase … · iteration …`,
- `Renewing · iteration …`,
- `Calculation cancelled`,
- `Layout error · previous map preserved`.

Chování tlačítek:

- `Refresh layout` je při čistém stavu disabled nebo provede bezpečný no-op bez vytvoření workeru,
- `Renew layout` zobrazí potvrzení vysvětlující, že se může změnit celá mapa,
- při běžícím výpočtu nepovol druhý `Refresh` ani `Renew`,
- `Cancel` vrátí UI k poslednímu committed snapshotu,
- při `Refresh` nebo `Renew` se kamera nesmí resetovat,
- po úspěšném atomickém commitu zachovej kameru a pouze aktualizuj geometrii.

Přidej příkazy a ribbon icon:

- `Open Spherical Graph`,
- `Refresh Spherical Graph Layout`,
- `Renew Spherical Graph Layout`,
- `Cancel Spherical Graph Calculation`,
- `Reset Spherical Graph Camera`.

Nepřidávej `Pause`, `Resume`, obecné nejasné `Recompute` ani drag-to-pin funkcionalitu.

Při opakovaném otevření existující leaf pouze aktivuj, nevytvářej nekonečně nové panely.

## 13. Nastavení

Vytvoř typované `SphericalGraphSettings`, defaulty, parser a migrace. Načítání musí být robustní vůči chybějícím nebo neplatným hodnotám.

Minimální nastavení:

### Data

- excluded folder prefixes,
- include orphan notes,
- graph change detection debounce,
- volitelný limit velikosti stručného pending diffu v UI.

Nesmí existovat nastavení `automatic rebuild`, `automatic refresh` ani automatická periodická relaxace.

### Vzhled

- node size,
- size nodes by degree,
- edge opacity,
- show labels,
- maximum labels,
- surface mode,
- surface opacity,
- background follows theme,
- focus animation duration.

### Společný layout

- deterministic base seed,
- spring strength,
- repulsion strength,
- centroid coverage strength,
- covariance/isotropy strength,
- damping,
- initial step or temperature,
- maximum angular velocity,
- maximum iterations,
- convergence tolerance,
- exact repulsion threshold,
- negative samples per movable node,
- progress report interval.

### `Refresh` preservation

- new-node warm-up iterations nebo podíl iteration budgetu,
- affected neighborhood hops,
- anchor strength,
- affected-node anchor multiplier,
- maximum old-node angular displacement in degrees,
- large-change warning ratio.

Běžnému uživateli ukaž bezpečný podmnožinový výběr. Pokročilé parametry seskup do zřetelně označené sekce a přidej tlačítko `Restore defaults`.

Každé číslo validuj a clampuj.

Aplikační pravidla:

- změna čistě vizuálního nastavení se projeví okamžitě a nikdy nespustí solver,
- změna datového filtru znovu sestaví graph diff a přejde do `fixed-dirty`, ale solver nespustí,
- změna layoutového nastavení se použije až při příštím explicitním `Refresh` vyvolaném skutečným pending diffem nebo při `Renew`,
- samotná změna layoutového nastavení nevytváří falešný graph diff a `Refresh` bez datových změn zůstává no-op; pro okamžité kompletní přepočítání použij `Renew`,
- změna layoutového nastavení sama o sobě nesmí pohnout žádným uzlem,
- při obnovení defaultů layoutu se současná mapa nemění, dokud uživatel nespustí relevantní layoutovou operaci.

## 14. Perzistence a stabilita mentální mapy

Ulož:

- schema version,
- algorithm/layout format version,
- settings,
- jeden committed layout snapshot,
- mapu `path -> [x,y,z]`,
- signaturu grafu, pro který byl snapshot vypočítán,
- seznam nebo hash uzlů a hran potřebný pro vytvoření diffu,
- timestamp dokončení operace,
- efektivní seed a úspěšně committed `renewGeneration`,
- stav kamery: position, up a target nebo jiný bezpečně serializovatelný ekvivalent.

Příklad logického tvaru:

```ts
interface PersistedLayoutSnapshot {
  snapshotId: string;
  schemaVersion: number;
  algorithmVersion: number;
  graphSignature: string;
  modeThatCreatedIt: "initialize" | "refresh" | "renew";
  effectiveSeed: number;
  renewGeneration: number;
  completedAt: number;
  positionsByPath: Record<string, [number, number, number]>;
  graphDescriptor: PersistedGraphDescriptor;
}
```

Požadavky:

- každou pozici při načtení validuj a normalizuj,
- odmítni NaN, Infinity a nulové vektory,
- neukládej velocities, temperature ani jiný pokračovací fyzikální stav,
- neukládej při každém progress reportu,
- working result nikdy nezapisuj do committed snapshotu,
- committed snapshot nahraď jediným logickým zápisem až po úspěšné finální validaci,
- při chybě nebo `Cancel` nesmí persistence obsahovat část nového layoutu,
- při přejmenování migruj klíč a odpovídající descriptor,
- odstraň stav neexistujících cest při kontrolovaném prune,
- vytvoř verzované migrace,
- neukládej binární blob, který nelze snadno migrovat,
- mapa se po znovuotevření nesmí svévolně globálně pootočit.

Při otevření view:

1. načti a validuj committed snapshot,
2. sestav aktuální graf,
3. pro aktuální dokumenty s uloženou pozicí použij přesně tuto pozici,
4. nové dokumenty bez pozice označ jako pending a zatím je nezobrazuj jako běžné uzly,
5. smazané dokumenty nezobrazuj,
6. vytvoř graph diff a zvol `fixed-clean` nebo `fixed-dirty`,
7. solver automaticky spusť pouze tehdy, když neexistuje žádný použitelný snapshot.

`Renew` nesmí nejprve mazat snapshot. Starý snapshot drž až do úspěšného commitu nového. Totéž platí pro `Refresh`.

Každý úspěšný `Renew` zvyš `renewGeneration` a odvoď nový efektivní seed například jako deterministický hash `baseSeed + renewGeneration + graphSignature`. Seed musí ovlivnit permutaci uzlů a jitter, ne pouze globální rotaci. Díky tomu další `Renew` skutečně začíná z jiného úplného rozmístění, přitom je konkrétní výpočet reprodukovatelný ze stejného grafu, algorithm version, solver settings a uloženého `effectiveSeed`. Neúspěšný nebo zrušený `Renew` nesmí committed generaci zvýšit.

Kameru ukládej nezávisle na layoutové operaci. Uložení kamery nesmí přepsat nebo rekonstruovat position mapu.

Po uzavření view ukládej pouze změněná nastavení a kameru. Pozice se ukládají při úspěšném commitu, nikoli preventivně při každém `onClose`.

Nepoužívej příkaz `Reset layout`. Produktové operace jsou přesně `Refresh` a `Renew`; `Renew` je bezpečný transakční ekvivalent úplného nového vygenerování.

## 15. Výkon a škálování

Cíl MVP není garantovat konkrétní FPS na každém hardware, ale architektura nesmí obsahovat zjevnou škálovací chybu.

Povinné zásady:

- solver a worker existují pouze během `Initialize`, `Refresh` nebo `Renew`,
- v pevném stavu je výpočetní náročnost layoutu nulová,
- exact \(O(n^2)\) odpuzování pouze pod jasným prahem,
- sampled/hybrid režim nad prahem,
- `Refresh` počítá primárně pouze nové a lokálně ovlivněné uzly,
- síly mezi dvěma hard-fixed uzly se v `Refresh` nevyhodnocují,
- první fáze `Refresh` pohybuje pouze novými uzly,
- worker posílá pouze progress metriky a jednou finální pozice,
- žádná regenerace node/edge geometrie při průběžných iteracích,
- instancované uzly,
- batched hrany,
- omezené labely,
- žádná regenerace geometrií při pouhé rotaci kamery,
- žádné alokace malých `Vector3` objektů v nejvnitřnějších smyčkách solveru; používej čísla nebo znovupoužitelné buffery,
- žádné logování po iteraci v produkčním režimu,
- resize a graph-change detection debouncuj,
- progress report nejvýše 4–10 Hz,
- renderer se vytváří až při otevření view,
- po commitu worker a pracovní buffery okamžitě uvolni.

Přidej `npm run benchmark:layout`, který bez GUI spustí deterministické případy například pro:

- `renew` se 100, 1 000 a 5 000 uzly,
- `refresh` nad uloženým grafem s 1 000 uzly a například 50 novými uzly,
- `refresh` s malou změnou hran mezi existujícími uzly,
- `refresh` s velkou změnou pro ověření warning threshold.

Vypiš:

- režim a fázi,
- počet celkových a pohyblivých uzlů,
- počet iterací nebo pevně omezených kroků,
- elapsed time,
- repulsion pair evaluations,
- mean vector norm,
- covariance eigenvalues nebo srovnatelnou metriku,
- maximum norm error,
- počet hard-fixed a anchored uzlů,
- maximum a průměr posunu starých uzlů,
- počet uzlů omezených displacement capem.

Benchmark nesmí být součástí rychlého unit testu, ale musí být snadno spustitelný. Výsledky nesmějí být prezentované jako univerzální výkonová garance.

## 16. Bezpečnost, soukromí a spolehlivost

- Žádná telemetrie.
- Žádné síťové požadavky za běhu pluginu.
- Žádné externí API klíče.
- Žádné modifikace poznámek.
- Žádný `eval`, dynamické stahování kódu ani vzdálené skripty.
- Žádné používání Node/Electron API mimo to, co je nutné pro desktopový plugin; preferuj standardní browser API.
- Všechny event listenery registruj přes Obsidian lifecycle mechanismy nebo je explicitně odpoj.
- Při `onClose` zruš operaci vlastněnou zavíraným view, pokud není záměrně sdílená s jiným otevřeným view; nikdy ji nenechávej bez vlastníka.
- Při `onunload` vždy pošli cancel/dispose, ukonči worker, odpoj observer, zruš RAF/timery, dispose controls, geometrie, materiály, textury a renderer.
- Po `completed`, `cancelled` nebo `error` nesmí worker zůstat aktivní.
- Ošetři WebGL context lost a zobraz obnovitelnou chybovou vrstvu.
- Chyba progress reportu nesmí poškodit uložený poslední validní stav.
- Neplatný finální position buffer nesmí být commitnut.
- Nepropaguj neošetřená promise rejection.
- Závislosti minimalizuj a zkontroluj jejich licence.
- Nevkládej tajné klíče, lokální cesty ani obsah testovacího vaultu uživatele do repozitáře.
- Před `Renew` zobraz potvrzení; samotné potvrzení nesmí smazat starý snapshot.
- Operace musí používat `operationId`, aby pozdní zpráva z ukončeného workeru nemohla přepsat novější stav.

## 17. Build a skripty

`package.json` musí nabídnout minimálně:

```text
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run check
npm run benchmark:layout
npm run generate:test-vault
```

`npm run check` musí spustit nejméně lint, typecheck, unit testy a production build.

Production build musí vytvořit v kořeni:

- `main.js`
- `manifest.json`
- `styles.css`

`main.js` musí obsahovat i inline zdroj workeru. Nesmí po instalaci vyžadovat další JS chunk. Worker se však instancuje pouze během explicitní layoutové operace.

Commitni lockfile. Nepoužívej široké verze `*`. Verze závislostí zvol podle aktuální kompatibility, nikoli podle zastaralého hardcodovaného zadání.

CI workflow musí na čistém checkoutu instalovat závislosti deterministicky a spustit `npm run check`.

## 18. Automatizované testy

Testy musí být deterministické a bez závislosti na skutečném uživatelském vaultu.

### 18.1 Geometrie

Povinné testy:

1. normalizace a odmítnutí nulového/nečíselného vektoru,
2. tečná projekce má skalární součin s \(u\) přibližně nula,
3. geodetická vzdálenost je symetrická,
4. stejný bod má vzdálenost nula,
5. antipody mají vzdálenost \(\pi\),
6. body na délkách \(+179.5^\circ\) a \(-179.5^\circ\) na rovníku mají vzdálenost přibližně \(1^\circ\), nikoli \(359^\circ\),
7. exponenciální mapa zachovává jednotkovou normu,
8. SLERP vrací správné koncové body,
9. každý SLERP vzorek má jednotkovou normu,
10. antipodální fallback je deterministický,
11. vzorky renderované hrany leží na konstantním poloměru,
12. geodetický clamp vůči kotvě nepřekročí maximální úhel,
13. rotační alignment zachová párové geodetické vzdálenosti a neprovede reflexi.

### 18.2 Solver – společná správnost

Povinné testy:

1. po stovkách nebo tisících kroků je maximální chyba normy pod zvolenou tolerancí, například \(10^{-5}\),
2. každá výsledná síla je tečná,
3. stejný seed a vstup dávají stejné pozice v toleranci,
4. jiný seed změní pouze inicializaci, ne invariantu sféry,
5. rotace všech vstupních pozic zachová layoutovou energii nebo diagnostickou stress metriku v toleranci,
6. graf s jedním uzlem neselže,
7. graf se dvěma uzly neselže,
8. graf bez hran se rozprostře po sféře,
9. pro alespoň 500 izolovaných uzlů po inicializaci/relaxaci platí přibližně:
   - `meanVectorNorm < 0.06`,
   - vlastní čísla druhého momentu nejsou degenerovaná a leží v rozumném intervalu kolem \(1/3\), například 0.25–0.42,
10. testovaný propojený syntetický graf se nesesune do jedné malé oblasti; nastav realistickou, zdokumentovanou metriku,
11. nad exact prahem solver použije sampled režim,
12. pro 5 000 uzlů a pevný počet iterací počet vyhodnocených globálních párů odpovídá \(O(nk)\), nikoli \(O(n^2)\),
13. `completed` výsledek obsahuje pouze konečné normalizované pozice.

### 18.3 `Refresh` preservation

Povinné testy:

1. existující uzly začínají přesně na committed pozicích,
2. nový uzel se sousedy začíná poblíž jejich sférického průměru,
3. nový izolovaný uzel dostane deterministický volný kandidát,
4. warm-up fáze nepohne žádným starým uzlem,
5. nedotčené staré uzly zůstávají hard-fixed bitově nebo v definované numerické toleranci,
6. ovlivněné staré uzly nepřekročí maximální úhlový displacement,
7. anchor energy snižuje drift vůči variantě bez anchoru,
8. `Refresh` bez diffu je no-op a nevytvoří solver ani worker,
9. odstraněné uzly ve výsledku nejsou,
10. přejmenovaný uzel zachová pozici,
11. velká změna vyvolá warning flag, ale automaticky se nepřepne na `renew`,
12. final alignment zachová vzdálenosti a minimalizuje globální rotační drift,
13. výsledek `Refresh` je deterministický pro stejný snapshot, diff, seed a nastavení.

### 18.4 `Renew`

Povinné testy:

- ignoruje anchor positions jako sílu,
- inicializuje celý aktuální graf znovu,
- solver se stejným efektivním seedem a grafem dává stejný výsledek v toleranci,
- dva po sobě úspěšné uživatelské `Renew` odvodí různé efektivní seedy a začnou z odlišného přiřazení uzlů,
- zrušený nebo chybný `Renew` nezvýší committed `renewGeneration`,
- starý snapshot zůstane nezměněný až do úspěšného commitu,
- chyba nebo cancel ponechá starý snapshot,
- úspěšný commit nahradí snapshot jednou transakcí.

### 18.5 Graph data a diff

Povinné testy:

- sestavení uzlů z mock Markdown souborů,
- deduplikace obousměrných hran,
- správný součet vah,
- odstranění self-links,
- filtr složek,
- include/exclude orphan notes,
- deterministické indexy,
- rename migrace,
- detekce přidaných a odstraněných uzlů,
- detekce přidaných, odstraněných a váhově změněných hran,
- změna aktivního souboru nevytvoří graph diff,
- debounced vault event pouze označí `fixed-dirty` a nespustí solver.

### 18.6 Perzistence

Povinné testy:

- defaulty při prázdných datech,
- hluboké sloučení a validace,
- migrace starší schema version,
- odmítnutí NaN/Infinity/nulových pozic,
- normalizace načtené pozice,
- prune neexistujících cest,
- nový dokument bez pozice je pending,
- smazaný dokument se nezobrazí,
- rename přenese pozici,
- progress report nic neukládá,
- cancel nic neukládá,
- neplatný completed result nic neukládá,
- validní completed result provede jediný committed save,
- uložení kamery nemění position mapu,
- debounced save nastavení nebo kamery lze otestovat s fake timers.

### 18.7 Lifecycle, worker a renderer

Kde je to rozumné, použij mocky/spies a ověř:

- povolené a zakázané přechody stavového automatu,
- v `fixed-clean` a `fixed-dirty` není aktivní worker,
- `Initialize` se automaticky spustí pouze bez použitelného snapshotu,
- vault event automaticky nespustí `Refresh`,
- současně nelze spustit dvě layoutové operace,
- progress message neobsahuje position buffer a nemění renderer,
- renderer obdrží pozice jednou až po validním `completed`,
- během výpočtu zůstane starý layout vykreslený,
- cancel vrátí předchozí pevný stav,
- stale `operationId` se ignoruje,
- worker termination po completed/cancelled/error,
- revoke Blob URL,
- disconnect observer,
- cancel pending timers/RAF,
- dispose renderer resources,
- interakce s kamerou, hoverem a search nemění committed position buffer.

Nevyžaduj headless WebGL pro běžné unit testy. Renderer rozděl tak, aby byla většina logiky testovatelná bez GPU.

## 19. Generátor testovacího vaultu

Vytvoř bezpečný CLI skript:

```text
npm run generate:test-vault -- --output ./tmp/test-vault --nodes 500 --edges 1500 --seed 42 --pattern clustered
```

Podporuj alespoň vzory:

- `ring`,
- `star`,
- `clustered`,
- `multi-component`,
- `random`.

Skript:

- generuje Markdown soubory s wikilinky,
- je deterministický,
- nevytváří výstup bez explicitního `--output`,
- odmítne přepsat neprázdný adresář bez `--force`,
- nikdy automaticky necílí na uživatelův skutečný vault,
- vypíše počet vytvořených souborů a hran.

`tmp/` přidej do `.gitignore`.

## 20. Dokumentace

### README.md

Musí obsahovat:

- co plugin dělá,
- čím se liší od běžného 3D volume grafu,
- explicitní vysvětlení, že uzly leží na \(S^2\) a hrany jsou geodetické,
- vysvětlení, že po výpočtu jsou pozice fixní a neběží živá simulace,
- přesný rozdíl mezi `Refresh layout` a `Renew layout`,
- chování pending změn,
- funkce,
- ovládání,
- nastavení,
- ruční instalaci,
- vývojové příkazy,
- privacy statement,
- známá omezení,
- release proces,
- žádný falešný screenshot nebo tvrzení o testu, který neproběhl.

### ALGORITHM.md

Popiš:

- reprezentaci jednotkovými vektory,
- geodetickou vzdálenost,
- tečné síly,
- exponenciální mapu,
- spring, repulsion, centroid a isotropy člen,
- exact a sampled režim,
- SLERP a antipodální případ,
- inicializaci `Initialize`/`Renew`,
- dvoufázový `Refresh`,
- výpočet affected setu,
- hard-fixed uzly,
- anchor energy,
- geodetický displacement cap,
- rotační alignment,
- konvergenci a finální validaci,
- proč po commitu solver končí,
- numerické tolerance,
- proč algoritmus nemá šev.

### ARCHITECTURE.md

Popiš:

- modulární strukturu,
- data flow Obsidian → graph service → diff tracker → lifecycle controller → worker → atomic persistence → renderer,
- stavový automat `no-layout / initializing / fixed-clean / fixed-dirty / refreshing / renewing / error`,
- oddělení committed a working stavu,
- worker protocol,
- persistence a transakční commit,
- lifecycle a cleanup,
- build inline workeru,
- diagram v Mermaid nebo textový diagram.

### MANUAL_TEST_PLAN.md

Připrav přesné kroky pro čistý testovací vault:

1. instalace pluginu,
2. první otevření a automatický `Initialize`,
3. ověření, že po dokončení status ukazuje pevný stav a worker už neběží,
4. rotace o celý obvod bez skoku/švu,
5. zoom,
6. hover/select/open,
7. search/focus,
8. dlouhá série rotací, zoomů a výběrů s ověřením, že se uzly nepohnuly,
9. přidání dokumentu a ověření pending stavu bez automatického pohybu,
10. spuštění `Refresh` a ověření, že stará mapa zůstává viditelná až do atomického přepnutí,
11. ověření, že nový dokument byl přidán a staré uzly se změnily pouze omezeně,
12. změna nebo odstranění odkazu a další `Refresh`,
13. přejmenování dokumentu a zachování pozice,
14. zrušení běžícího `Refresh` a ověření, že stará mapa zůstala beze změny,
15. spuštění `Renew`, potvrzovací dialog a úplně nové rozmístění,
16. zrušení nebo simulace chyby `Renew` a zachování starého snapshotu,
17. restart Obsidianu a kontrola stability layoutu,
18. změna theme,
19. otevření ve splitu a pop-out okně,
20. test tří surface modes,
21. test velkého syntetického vaultu,
22. zavření view během výpočtu a kontrola ukončení workeru,
23. zavření view v pevném stavu a kontrola chyb/leaků v konzoli.

### VALIDATION.md

Po dokončení do něj zapiš:

- datum a prostředí,
- přesné spuštěné příkazy,
- pass/fail výsledky,
- souhrn benchmarku zvlášť pro `renew` a `refresh`,
- maximum a průměr displacementu starých uzlů při testovaném `refresh`,
- ověření, že v pevném stavu neběží worker,
- zda proběhl skutečný Obsidian GUI test,
- neprovedené testy a důvod,
- známá omezení.

Nevymýšlej výsledky. Soubor vytvoř až podle skutečných příkazů.

## 21. Požadovaná UX kvalita

- View vyplní celý obsah panelu.
- Toolbar nesmí překážet rotaci.
- Na světlém i tmavém tématu musí být čitelný.
- Při prvním `Initialize` ukaž progress, nikoli prázdný panel.
- Při 0 uzlech ukaž srozumitelnou empty state.
- Při WebGL/worker chybě ukaž srozumitelný error state a možnost retry nebo `Renew`; existující mapa musí zůstat zachovaná.
- Při `Refresh` a `Renew` zůstane poslední mapa viditelná a interaktivní, dokud není nový výsledek připravený.
- Uzly se nesmějí před uživatelem průběžně přesouvat během výpočtu.
- Úspěšný commit může způsobit jedno atomické přepnutí na nový layout; nepoužívej dlouhou animaci interpolující všechny uzly.
- Při `Refresh` ani `Renew` se nesmí resetovat kamera.
- Při změně velikosti panelu se kamera nesmí svévolně přetočit.
- Pending stav musí jasně říkat, že změny ještě nebyly layoutově zahrnuté.
- `Refresh` a `Renew` musí být názvem i tooltipem jednoznačně odlišené.
- `Renew` vyžaduje potvrzení; `Refresh` nikoli.
- `Cancel` musí být dostupný pouze během výpočtu a musí zanechat starou mapu.
- Aktivní a vybraný uzel musí být rozlišitelné i bez spoléhání jen na podobné odstíny.
- Toolbar buttony musí mít title/aria-label.
- Search musí být ovladatelný klávesnicí.
- Všechny texty UI centralizuj v jednom modulu nebo jednoduchém slovníku; výchozí UI je anglické. Architektura má umožnit budoucí lokalizaci.

## 22. Explicitně odložené funkce

Do MVP nezahrnuj, pokud jsou základní požadavky hotové a nezbývá pouze triviální práce:

- mobilní podporu,
- WebGPU,
- GPU compute layout,
- edge bundling,
- komunitní detekci,
- tagy jako samostatné uzly,
- nevyřešené odkazy jako ghost nodes,
- šipky orientovaných hran,
- export obrázku nebo videa,
- VR/AR,
- synchronizaci layoutu mezi zařízeními,
- nahrazení core Graph View,
- ruční drag-and-drop přesouvání nebo pinování jednotlivých uzlů,
- živou force simulaci po dokončení layoutu,
- automatické background refresh/rebalance po změnách vaultu,
- historii více layout snapshotů a undo/redo mezi nimi,
- plynulou animaci morfování celé mapy mezi starým a novým snapshotem.

Tyto body lze uvést v roadmapě, nesmějí ale ospravedlnit nedokončení MVP.

## 23. Zakázané zkratky a nežádoucí chování

Výsledek nebude přijat, pokud obsahuje některou z těchto zkratek nebo porušení lifecycle:

- rovinný graf následně promítnutý na sféru,
- lat/lon obdélník s periodickým „opravováním“ až po layoutu,
- uzly v kulovém objemu,
- přímé hrany skrz kouli,
- standardní eukleidovský force solver s pouhou normalizací pozic jako finální algoritmus,
- layout na hlavním vlákně bez workeru a bez neblokujícího fallbacku,
- jeden mesh na každý uzel nebo jeden draw call na každou hranu,
- DOM label pro každý uzel,
- samostatný worker chunk, který není v release instalován,
- neveřejné Obsidian internals,
- síťové volání nebo telemetrie,
- modifikace poznámek,
- nedeterministický solver založený na nekontrolovaném `Math.random()`,
- chybějící dispose/cleanup,
- vypnutý TypeScript strict mode,
- `any`, `@ts-ignore` nebo eslint disable bez konkrétního zdůvodnění,
- placeholdery, neimplementovaná tlačítka, produkční `TODO` pro povinné MVP,
- falešné tvrzení, že GUI nebo výkon byl otestovaný,
- trvale běžící solver nebo worker v pevném stavu,
- automatické spuštění layoutu na vault event,
- průběžné renderování mezivýsledných pozic,
- ukládání pozic z progress reportů,
- uživatelská tlačítka `Pause` a `Resume` místo dávkového lifecycle,
- dragování uzlů, které mění committed pozice,
- destruktivní smazání starého snapshotu před úspěchem `Renew`,
- automatický převod `Refresh` na `Renew` bez rozhodnutí uživatele,
- pohyb nedotčených starých uzlů bez anchoru nebo displacement limitu,
- vytvoření workeru při `Refresh` bez pending změn,
- reset kamery jako vedlejší efekt layoutové operace.

## 24. Akceptační kritéria

Plugin je považovaný za hotový pouze tehdy, když jsou splněny všechny body.

### Build a kvalita

- `npm ci` funguje na čistém checkoutu.
- `npm run check` projde bez chyb.
- `npm run build` vytvoří `main.js`, `manifest.json`, `styles.css`.
- Build nevyžaduje další worker JS soubor.
- TypeScript je strict.
- CI workflow odpovídá lokálním kontrolám.
- Nejsou přítomné povinné MVP placeholdery.

### Geometrie

- všechny uložené layoutové pozice jsou jednotkové v toleranci,
- seam test \(+179.5^\circ/-179.5^\circ\) prochází,
- geodetické hrany mají konstantní poloměr,
- antipodální hrana je stabilní a deterministická,
- solver používá pouze tečné síly a intrinsické vzdálenosti,
- rotace celého vstupu nemění energii/stress v toleranci,
- coverage test pro izolované uzly prochází,
- geodetický anchor displacement cap prochází,
- rotační alignment nevytváří reflexi ani nemění párové vzdálenosti.

### Pevný lifecycle

- bez snapshotu se jednou spustí `Initialize`,
- po dokončení je layout fixní,
- v `fixed-clean` ani `fixed-dirty` neběží worker ani solver,
- rotace, zoom, hover, select, search, focus, otevření dokumentu, resize a theme change nemění committed position buffer,
- během výpočtu se rendereru neposílají mezivýsledné pozice,
- starý layout zůstává během `Refresh`/`Renew` viditelný,
- finální layout se aplikuje jedním atomickým commitem,
- cancel nebo chyba ponechá starý snapshot,
- po completed/cancelled/error je worker ukončený.

### `Refresh`

- vault změna pouze vytvoří pending diff a automaticky nespustí layout,
- nový dokument se před `Refresh` nezobrazí na náhodné necommitnuté pozici,
- smazaný dokument se odstraní bez pohybu ostatních,
- rename zachová pozici,
- `Refresh` zahrne aktuální nové dokumenty a topologii,
- warm-up pohybuje pouze novými uzly,
- nedotčené staré uzly zůstanou hard-fixed,
- pohyblivé staré uzly používají anchor energy,
- žádný starý uzel nepřekročí konfigurovaný maximální displacement,
- `Refresh` bez diffu je no-op bez workeru,
- velká změna pouze zobrazí doporučení `Renew`, nepřepne režim automaticky,
- po úspěchu je výsledek uložený a opět fixní.

### `Renew`

- `Renew` vyžaduje potvrzení,
- každý úspěšný `Renew` použije novou committed generaci a nový efektivní seed,
- ignoruje předchozí pozice jako anchor,
- používá aktuální kompletní graf,
- starý snapshot zůstane do úspěšného dokončení zachovaný,
- úspěch atomicky nahradí celý layout,
- zrušení nebo chyba obnoví předchozí pevný stav,
- po úspěchu je nový layout opět fixní.

### Ostatní funkce

- view lze otevřít z ribbonu i command palette,
- graf načte Markdown soubory a vyřešené odkazy,
- lze rotovat a zoomovat,
- hover, select, neighbor highlight a otevření dokumentu fungují,
- search najde dokument a zaměří jej,
- `Refresh`, `Renew`, `Cancel` a `Reset camera` fungují,
- tři surface modes fungují,
- aktivní note se zvýrazní,
- layout se po znovuotevření obnoví ve stejné orientaci,
- změny vizuálních nastavení nepohybují uzly.

### Výkon a lifecycle zdrojů

- nad exact prahem se nepoužívá all-pairs globální odpuzování,
- `Refresh` nepočítá zbytečně síly mezi dvěma hard-fixed uzly,
- UI nezamrzne dlouhou synchronní layoutovou smyčkou,
- uzly jsou instancované,
- hrany jsou batched,
- labely jsou omezené,
- worker a WebGL zdroje se při zavření uvolní,
- nevznikají zjevné opakované listenery po opakovaném otevření view,
- benchmark reportuje samostatně `renew` a inkrementální `refresh`,
- po commitu nedochází k dalším layoutovým výpočtům.

### Dokumentace

- README, ALGORITHM, ARCHITECTURE, MANUAL_TEST_PLAN a VALIDATION jsou úplné,
- dokumentace přesně odpovídá fixnímu lifecycle a rozdílu `Refresh`/`Renew`,
- známá omezení jsou přiznaná,
- release metadata jsou konzistentní,
- licence a third-party notices jsou přítomné.

## 25. Pořadí implementace

Doporučené pořadí; měň jej pouze s dobrým důvodem:

1. scaffold, tooling, manifest a `AGENTS.md`,
2. čistá spherical geometry knihovna a její testy,
3. graph data service, graph signature, graph diff a testy,
4. persistence schema pro committed snapshot a transakční API,
5. `SphericalSolver` pro úplný `initialize/renew` režim v jednom vlákně,
6. exact a sampled repulsion + coverage metriky,
7. `RefreshPlanner`, affected set, hard-fixed mask, anchor energy a displacement cap,
8. testy determinismu a zachování mentální mapy při `refresh`,
9. lifecycle state machine bez workeru,
10. worker protocol s final-only position transferem a inline worker build,
11. cancel, stale operation protection a main-thread fallback,
12. základní Obsidian view a pending change detection,
13. Three.js sphere, instanced nodes a geodetické edges,
14. atomic renderer swap a invalidation-based rendering,
15. picking, labels a ovládání kamery,
16. toolbar, search, `Refresh`, `Renew`, `Cancel`, settings a commands,
17. vault eventy bez automatického solveru a rename migrace,
18. lifecycle cleanup a error states,
19. test vault generator a benchmark pro renew i refresh,
20. dokumentace,
21. kompletní `npm run check`,
22. production build,
23. manuální GUI test, pouze je-li prostředí dostupné,
24. vyplnění `VALIDATION.md`,
25. finální kontrola proti všem akceptačním kritériím.

Po každé větší etapě spusť relevantní testy. Nečekej až na konec.

Nejprve ověř správnost a transakční lifecycle na menších grafech. Optimalizace nesmí předběhnout důkaz, že `Refresh` skutečně zachovává staré polohy a že v pevném stavu neběží žádná simulace.

## 26. Finální výstup Codexu

Závěrečná odpověď musí mít tuto strukturu:

1. **Implemented** – konkrétní dokončené funkce.
2. **Architecture** – stručný popis modulů, stavového automatu a data flow.
3. **Spherical correctness** – jak je prokázáno, že nejde o planar wrap ani volume layout.
4. **Fixed-layout lifecycle** – jak je zajištěno, že po commitu neběží solver a pozice se při běžné interakci nemění.
5. **Refresh preservation** – affected set, warm-up, hard-fixed uzly, anchoring, displacement cap a naměřené posuny starých uzlů.
6. **Renew semantics** – jak je zajištěn úplný nový layout, změna efektivního seedu mezi úspěšnými generacemi a transakční zachování starého snapshotu při chybě.
7. **Validation** – přesné příkazy a jejich výsledky.
8. **Manual testing** – co bylo skutečně otestováno v Obsidianu; při nedostupném GUI to explicitně uveď.
9. **Performance** – skutečné benchmark výsledky zvlášť pro `renew` a `refresh`, bez zobecnění na cizí hardware.
10. **Release artifacts** – umístění `main.js`, `manifest.json`, `styles.css`.
11. **Known limitations** – konkrétní zbývající omezení.
12. **Changed files / Git status** – stručný přehled.

Neukončuj práci větou, že implementace je „připravena k doplnění“. Povinný rozsah výše musí být skutečně implementovaný. Pokud nějaký bod objektivně nešlo ověřit kvůli prostředí, dokonči kód a automatické testy a přesně označ pouze neprovedenou verifikaci, nikoli celý úkol jako nedokončený.
