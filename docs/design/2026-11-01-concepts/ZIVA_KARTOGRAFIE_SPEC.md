# Spherical Graph — grafické zadání Živá kartografie

Verze zadání 1.6 · 3. listopadu 2026. Korekce podle nativních snapshotů
jsou v oddílech 26–31; novější oddíl a tokeny mají přednost před staršími tabulkami.

Živá kartografie převádí existující atlas do podoby matného plastického glóbusu: hluboký petrolejový oceán, barevná minerální pevnina, teplá světelná města a stříbrné satelity. Světlo a reliéf mají vytvořit dojem hmatatelného předmětu, zatímco poznámky, vztahy a ovládání zůstanou čitelné.

Zvoleným výtvarným podkladem je [návrh 3](03-ziva-kartografie.png). Tento dokument určuje cílové provedení; kde se obrázek a číselné hodnoty liší, platí hodnoty a pravidla tohoto zadání. [Strojově čitelné tokeny](ziva-kartografie.tokens.json) obsahují výchozí hodnoty. Zadání je implementační referencí schváleného směru. Přehled aktuálního provedení je v DESIGN_SYSTEM.md a zachované geografické principy v CONTINENT_DESIGN.md. Ověření skutečné implementace je oddělené od tohoto výtvarného zadání.

## 1. Charakter a pořadí pozornosti

Pocit: současná reliéfní kartografie, teplé minerály a opracovaná keramika. Povrchy jsou matné; světlo je měkké. Barvy pevniny mohou být výraznější než dosud, ale význam interakce se nesmí ztratit v dekoraci.

Pořadí vizuální důležitosti: vybraná poznámka nebo aktivní trasa → výsledky hledání → přímí sousedé a související satelity → ostatní města a názvy → hranice a reliéf → dekorace oceánu. Při kolizi ustupuje nižší vrstva. Vybraný uzel a jeho popisek mají zůstat dohledatelné i v husté části mapy.

Globální bloom, blikání, běžící částice na všech hranách, animované orbitální kružnice a trvalé pulzování měst nejsou součástí směru. Záře je lokální, barevná a omezená na několik pixelů kolem konkrétního objektu.

## 2. Neměnné produktové vlastnosti

- Poznámky zůstávají na skutečném povrchu sféry; hrany mezi poznámkami sledují povrchové geodetiky. Satelity tagů jsou samostatná vnější vrstva.
- Nové materiály ani optický reliéf nesmějí posunout uložené pozice, změnit vlastnictví země nebo spustit solver. Initialize, Refresh a Renew si zachovají svůj stávající význam.
- Pozice a barvy kontinentů se nemění při hoveru, výběru, hledání ani otočení kamery. Při změně vzhledu není nutné Renew.
- Výběr, aktivní poznámka, hledání a Route Finder zůstávají nezávislé stavy. Vypnutí běžných hran nevypíná jejich zvýraznění; zachovat existující filtry a práh zoomu hran.
- Tagy, přílohy, nevyřešené odkazy a připnuté poznámky nemění význam. Nezavádět nové datové kategorie jen kvůli grafice.
- Vzhled zůstává lokální a offline, bez vzdálených fontů, textur či služeb. Grafika se aplikuje pouze uvnitř view pluginu a jeho vlastních ovládacích prvků.

## 3. Jednotky a reprodukovatelné měření

Veškeré rozměry `px` znamenají CSS pixely. Šířka čáry je **celá viditelná šířka**, nikoli poloviční šířka ribbonu. Hodnoty se nesmějí podruhé násobit DPR po převodu framebufferu. Referenční scéna má průměr glóbusu 700 CSS px při DPR 1, globus je vidět celý, uživatelská hodnota Globe size je 100.

Barvy jsou sRGB HEX; opacity je číslo 0–1. Barva s opacity není nová HEX barva: nejprve určit barvu, potom aplikovat alfa kompozici. Výpočty materiálového světla provádět v lineárním prostoru, výstup převést do sRGB.

Velikost měst při změně zoomu navazuje na dosavadní vztah Globe size a fyzické velikosti markeru. Pro vizuální kalibraci použít `s = clamp(D / 700, 0.70, 1.60)`, kde D je promítnutý průměr glóbusu. Průměry jader a halo násobit s; tloušťky obrysů a mezer mezi obrysy zůstávají v CSS px. Jádro běžné poznámky neklesne pod 2,5 px, interaktivně zdůrazněné pod 5 px. Je to cíl vykreslení, nikoli změna souřadnic nebo požadavek na nové rozložení.

## 4. Základní paleta menu a povrchů

| Role | HEX | Použití |
| --- | --- | --- |
| Pozadí view | `#081D21` | Okraj prostoru kolem glóbusu |
| Prostor za glóbusem | `#102D31` | Velmi jemné zesvětlení středu scény |
| Menu a detail | `#10282D` | Neprůsvitná hlavní plocha panelu |
| Vstupy a zvýšená plocha | `#17343A` | Search, dropdown, sekundární tlačítka |
| Hover ovládání | `#21454B` | Řádek menu nebo tlačítko pod kurzorem |
| Aktivní plocha | `#28555B` | Vybraný tab nebo zapnutý přepínač |
| Jemná linka UI | `#35575D` | Oddělovače, rámečky panelů |
| Silnější obrys UI | `#56777C` | Hover rámeček a důležité hranice |
| Hlavní text | `#F4EBD8` | Názvy, ovládání, hodnoty |
| Vedlejší text | `#BBC9C5` | Cesta poznámky, popisy |
| Tlumený čitelný text | `#B2C4BE` | Placeholdery, metadata, stav; čitelný i na aktivní ploše |
| Neaktivní obsah | `#6E8584` | Pouze skutečně disabled položky |
| Klávesnicový focus | `#A4DED2` | Obrys ovládaného prvku |
| Hlavní akce | `#D9AE69` | Např. Open note nebo Refresh |
| Text na hlavní akci | `#152B2E` | Tmavý text na zlaté ploše |
| Hover hlavní akce | `#E8BF7C` | Lehké zesvětlení |
| Stisk hlavní akce | `#C99B54` | Ztmavení během stisku |
| Úspěch | `#9EC8AC` | Stav Up to date |
| Čekající změny / varování | `#EDC478` | Pending změny, potvrzení Renew |
| Chyba / destruktivní akce | `#F49D90` | Chyby a jejich vysvětlení |

Akcent hlavní akce se nepoužívá na každý obrys. Běžná tlačítka mají petrolejovou plochu a slonovinový text. Barevné stavy vždy doplnit názvem, symbolem, tvarem nebo vzorem.

Tento směr je samostatný tmavý atlas i v případě světlého Obsidian theme. Režim se musí pojmenovat a respektovat explicitní volbu uživatele. Dokud nebude vytvořen plnohodnotný světlý protějšek, neinvertovat scénu ani neprohlašovat tento návrh za světlý motiv. Stávající volbu následování theme zachovat jako kompatibilní alternativu k tomuto explicitnímu vizuálnímu profilu.

## 5. Barvy kontinentů a zemí

| Varianta | Základ | Stín | Osvětlená plocha |
| --- | --- | --- | --- |
| Okr | `#BC873F` | `#7A542D` | `#E3B467` |
| Jadeit | `#5E9080` | `#365F59` | `#9FBE9D` |
| Terakota | `#AB7060` | `#694B45` | `#D7A18B` |
| Břidlice | `#658893` | `#3D5866` | `#A2BBC0` |
| Šalvěj | `#909A6C` | `#5B694E` | `#BCC59A` |
| Tlumená růže | `#A4797F` | `#694F60` | `#CFABB0` |
| Pískovec | `#B29A6D` | `#776642` | `#D9C6A0` |
| Mech | `#6F9076` | `#435F50` | `#AAC6A0` |

Základ, stín a světlo jsou meze materiálové palety, nikoli tři pruhy, které mají být najednou silně viditelné. Jemná výšková textura může základ ztmavit či zesvětlit přibližně o 18 %; nesmí překročit meze tak, aby plocha vypadala kovově nebo bíle vypáleně.

Použít existující stabilní `colorIndex` kontinentu. Současných šest indexů zachovat v pořadí; další dvě barvy jsou rozšíření pro nové přiřazení. Případné opakování palety u většího počtu složek je přípustné, nesmí však vyvolat přebarvování již uložených kontinentů. Země uvnitř kontinentu používají stejnou rodinu barvy, s deterministickou odchylkou jasu maximálně ±6 %. Země nejsou samostatná duhová mozaika.

Po vypnutí kontinentů zmizí pevnina, pobřeží a geografické názvy společně podle dosavadní funkce; města a jejich významové barvy zůstávají. Kořenové ostrovy převzít ze současné geografie. Grafický redesign nevyrábí novou pevninu z uzlů.

## 6. Oceán, materiály a nasvícení

Oceán: základ `#10343E`, tmavé oblasti `#0B252F`, světlejší mělký tón `#1B4B53`. Jemná směrově spojitá textura s amplitudou přibližně 3,5 %; žádné fotografické vlny, lesklé odlesky ani viditelné opakování dlaždic. Pobřežní mělká voda může být mírně světlejší v pásu maximálně 2–4 referenčních px, s velmi měkkým přechodem.

Materiál pevniny odpovídá matnému minerálu. Při použití PBR je výchozí roughness 0,92 a metalness 0; u současného ShaderMaterial jsou tyto hodnoty jen výtvarný ekvivalent, nikoli existující uniformy. Plochy nemají kovový lesk ani mokrý povrch.

Světlo přichází zleva shora vůči kameře. Směr před normalizací: `(-0.45, 0.65, 0.60)` v soustavě s +X doprava, +Y nahoru a +Z směrem k pozorovateli. Pevnina má ambientní příspěvek 0,68 a směrový 0,32; oceán 0,82 a 0,18. Osvětlení drží obraz čitelný při libovolném otočení. Nevytvářet temnou noční polokouli. Města ani zvýrazněné hrany tímto materiálovým světlem neztmavovat.

Světelný lem glóbusu: `#A7C8BD`, celá šířka 1,25 px, maximální opacity 0,16 na osvětlené části obvodu; na opačné straně fade na nulu. Lem je mnohem slabší než svit vybraného města. Volitelná atmosféra používá `#D8E4DA`, opacity v jasné části nejvýše 0,06; nikdy nesmí zakrýt popisky a města. Zachovat dosavadní vazbu atmosféry na zoom, autorotaci a mobilní profil.

## 7. Reliéf, pobřeží a hranice

Plastické terasy z návrhu realizovat nejprve pomocí procedurálního výškového pole, odvozených normál a směrového stínování. **Výchozí geometrický displacement je nula.** Tím zůstane společný povrch pro města, cesty a picking. Města nemají mizet za horami a cesty se nesmějí vizuálně zařezávat do vyvýšené geometrie.

Výškové pole má být hladké, deterministické, spojité přes celou sféru a nezávislé na kameře. Doporučené výchozí členění: široký reliéf 65 %, střední 30 %, jemný 5 %; 5–7 optických výškových pásem s vyhlazenými přechody. Nejde o metriku počtu poznámek nebo centrality. Vrstevnice a pahorky jsou čistě výtvarné.

| Prvek | Barva | Celá šířka | Opacity | Vzor |
| --- | --- | --- | --- | --- |
| Pobřeží | `#D9BB7C` | 0,90 px | 0,80 | Souvislé, organické |
| Stín pod pobřežím | `#745C3D` | nejvýše 1,50 px | 0,20 | Měkký, pouze místní |
| Hranice zemí | `#F4EBD8` | 0,65 px | 0,34 | 3 px čára / 4 px mezera |
| Rovnoběžky a poledníky | `#6F989C` | 0,55 px | 0,12 | 2 px čára / 6 px mezera |
| Světlé vrstevnice | `#F0D7A1` | 0,45 px | 0,12 | Jemné, bez pravidelného rastru |
| Tmavé vrstevnice | `#3B4438` | 0,45 px | 0,10 | Lokálně podle světla |

Vrstevnice nesmějí na malém glóbusu tvořit moaré. Pod průměrem 500 px jemné pásy plynule utlumit; pod 350 px jemné vrstevnice vypnout. Mikrograin má opacity 0,018, bez časové animace. Hraniční čáry vykreslit odděleně od grafových hran, aby přepínač hranic zemí ovládal pouze geografii.

## 8. Města a ostatní uzly

Základní poznámka je malý teple slonovinový disk: jádro `#F6DEAA`, maličký světelný střed `#FFF3D0`. Udržovat dojem světla bez bílé přepálené skvrny. Jádro je neprůsvitné; okraj je antialiasovaný. Oddělení od světlé pevniny zajistí jemná tmavá podkresba `#263F3D`, 0,60 px, opacity 0,55.

Referenční průměr je 3,5 px. Při zapnutém Size nodes by degree použít cílovou kalibraci `d = 3.5 × (1 + min(0.45, 0.08 × log2(degree + 1)))`, tedy maximálně přibližně 5,1 px před interakcí. Při vypnuté volbě mají města stejný průměr. Základní d se násobí stavovým koeficientem: běžný/soused/stejná podsložka 1,00; aktivní/trasa/hledání 1,15; hover 1,20; výběr a endpoint 1,35. Minimální průměr po zoomu je 2,5 px pro běžný/soused/stejná podsložka, 4 px pro aktivní/trasu/hledání a 5 px pro hover/výběr/endpoint. Při souběhu se použije největší příslušná velikost, nikoli součin. Velikost neurčuje důležitost jiným způsobem než dosavadní volba podle stupně.

| Stav | Barva jádra | Halo: celkový průměr / vrchol opacity | Obrys |
| --- | --- | --- | --- |
| Běžná poznámka | `#F6DEAA` | 10 px / 0,08 | Bez stavového prstence |
| Přímý soused výběru | `#FFF0C9` | 11 px / 0,10 | Bez prstence |
| Stejná podsložka | `#A8CBB3` | 10 px / 0,05 | Bez prstence |
| Aktivní otevřená poznámka | `#9FD8CD` | 13 px / 0,14 | 1 px, mezera od jádra 2 px |
| Hover | Zachovat významovou barvu | 16 px / 0,18 | `#FFF4D6`, 1 px, mezera 2 px |
| Vybraná poznámka | `#FF866A` | 20 px / 0,24 | Korálový 1,5 px, mezera 3 px |
| Vnitřní uzel trasy | `#F3C66B` | 14 px / 0,15 | Bez prstence |
| Začátek trasy | `#A7D9B7` | 16 px / 0,18 | 1,25 px, mezera 2 px; označení S |
| Konec trasy | `#9FCAD9` | 16 px / 0,18 | 1,25 px, mezera 2 px; označení E |
| Výsledek hledání | `#963652` | 15 px / 0,16; halo `#D982A0` | Vnější vínový/rose 1,25 px |

Příloha: `#B9C8CF`, drobný zaoblený čtverec, bez běžného halo. Nevyřešený odkaz: prázdný kroužek `#839A99`, obrys 1 px, tmavý vnitřek a bez halo. Orphan poznámka zůstává kruhovým městem; nepřidělovat jí další výstražnou barvu. Připnutí označit malým symbolem špendlíku `#EAD5A1` vedle města nebo v jeho popisku, nikoli další velkou kružnicí. Ve scéně může být jednoduchý datový marker; v DOM použít ikonu Obsidian/Lucide.

Tvar kategorie zachovat i při změně barvy. Výběr přílohy tedy zůstává čtvercový. U nevyřešeného odkazu zůstává zřejmý prázdný střed.

## 9. Jak přesně mají uzly svítit

Halo je hladký radiální alfa disk za jádrem. Výchozí funkce: `alpha(r) = peak × (1 − smoothstep(0, haloRadius, r))²`. `peak` je hodnota z tabulky, `haloRadius` je polovina celkového uvedeného průměru. Jde o geometricky omezenou záři s průhledným okrajem; nepoužívat tvrdý rozmazaný obrys. Jádro překrývá nejjasnější střed halo.

Použít běžné alfa míchání, nikoli additive blending; světlá města se při překryvu nesmějí slít do bílé skvrny. Halo má `depthTest=true`, `depthWrite=false`. Jádro respektuje hloubku glóbusu. Žádná záře ani prstenec nejsou vidět přes odvrácenou stranu. Místní zvýraznění není skutečný světelný zdroj a nebarví velkou plochu pevniny.

V klidu žádné pulzování. Hover zvýší svit během 120 ms, po odjetí jej během 180 ms vrátí. Výběr přejde do svého stavu během 180 ms a pak je zcela statický. Není potřeba nepřetržitý render jen kvůli halo. Při hustém shluku tlumit nejprve halo obyčejných měst, nikoli jejich jádra nebo zvýraznění hledání.

## 10. Souběh stavů a jejich priorita

Barva jádra má tuto prioritu: **výběr → začátek trasy → konec trasy → vnitřní uzel trasy → hledání → aktivní poznámka → přímý soused → stejná podsložka → základ kategorie**. Jedna poznámka má vždy jen jedno jádro a jedno halo. Ze současně aktivních stavů se pro halo použije vyšší opacity a větší průměr, nikoli součet.

Hover nemění významovou barvu jádra. Přidá světlý obrys; pokud již existuje primární prstenec výběru, endpointu nebo aktivní poznámky, pouze jej zesvětlí a zvětší jeho vnější průměr o 1 px. Nepřidává třetí kruh.

Hledání je nezávislý vnější prstenec. U obyčejného výsledku má jádro vínovou barvu a prstenec navazuje s mezerou 2 px. Při souběhu s výběrem nebo trasou ponechat jejich jádro a hlavní prstenec; search prstenec dát ještě o 2 px za jeho vnější okraj. Jádro prstence je vínové `#963652`, měkké okolí rose `#D982A0`, bez tvrdé bílé kontury. Na obrazovce smějí být maximálně dva soustředné stavové prstence.

Aktivní poznámka při překrytí vyšším stavem zůstává označena textem Active v detailu/popisku. Endpoint při současném výběru neztrácí označení S nebo E, které se zobrazí v připojeném krátkém popisku. Příznak připnutí je samostatná drobná ikona. Filtr vyloučené uzly nevrací do scény žádným zvýrazněním.

Příklady: vybraná poznámka nalezená hledáním má korálové jádro, korálový hlavní prstenec a vnější vínový prstenec; uzel trasy nalezený hledáním má jantarové jádro a vínový prstenec; hover nad začátkem trasy ponechá zelené jádro a zvýrazní jeho endpointový obrys.

## 11. Hrany mezi poznámkami

Hrany mají působit jako jemné cesty na povrchu. Bez směrových šipek, pokud je současná funkce nevyžaduje. Běžné hrany jsou nenápadné; nepřidávat do klidu barevný halo ani časovou animaci.

| Stav | Barva jádra hrany | Celá šířka | Opacity jádra | Celá šířka halo | Vrchol opacity halo |
| --- | --- | --- | --- | --- | --- |
| Běžná | `#B8C5B5` | 0,75 px | 0,24 | 0 | 0 |
| Související s hoverem | `#B8C5B5` | 1,00 px | 0,60 | 0 | 0 |
| Spoj vybraného uzlu | `#F29A78` | 1,35 px | 0,92 | 4,50 px | 0,16 |
| Trasa | `#F3C66B` | 1,65 px | 0,98 | 5,50 px | 0,20 |
| Spoj výsledků hledání | `#963652` | 1,25 px | 1,00 | 4,75 px | 0,20; rose `#D982A0` |

Halo se směrem kolmo od hrany ztrácí kvadratickým alfa přechodem, obdobně jako uzlové halo. Uvedená šířka zahrnuje celé halo včetně prostoru pod jádrem. Konce spojů mají jemné zaoblení, navazující segmenty nesmějí vytvářet mezery nebo světlé uzlíky.

Běžná hrana má při potřebě oddělení od světlého reliéfu podkresbu `#12313A`, celková šířka nejvýše 1,50 px, opacity 0,18. Podkresba není další barevný význam a na tmavém oceánu se může vynechat. Váha vztahu automaticky nezvětšuje čáru; zachovat jednotnou tloušťku podle stavu.

Na jedné hraně nekreslit nad sebou několik barevných jader. Priorita: **trasa → výběr → hledání → hover → běžná**. Při souběhu trasy a hledání je hrana jantarová a search význam zůstává na prstencích koncových měst. Použít nejvýše jedno halo vítězného stavu. Trasa vykreslí všechny skutečně nalezené nejkratší alternativy stejným stylem.

Při výběru zmizí nesouvisející běžné hrany tak jako nyní. Search hrany vznikají pouze mezi dvěma nalezenými poznámkami, pokud mezi nimi skutečně existuje odkaz. Hledání nesmí spojovat všechny výsledky novými cestami. Zachovat současné clear/resume chování, filtry a práh zoomu; vypnutí Edges se vztahuje na běžnou vrstvu.

## 12. Satelity tagů

Satelity tvoří **stříbrnou**, nikoli jantarovou rodinu. Jantar patří trasám a teplá slonovina městům. Tvar: drobný matný osmistěn, v promítnutí čitelný jako kosočtverec. Nevytvářet velké koule ani planetky s realistickými texturami.

| Prvek/stav | Hodnota |
| --- | --- |
| Základní ploška | `#D9E2E7` |
| Světlá ploška | `#F5FAFC` |
| Tmavá ploška | `#7E969D` |
| Související satelit | `#A8D1CB` |
| Vybraný satelit | `#F5FAFC`, obrys `#A8D1CB` |
| Referenční velikost | Běžný 7 px; související 8 px; vybraný 9 px přes nejdelší úhlopříčku |
| Záře | V klidu žádná; hover/výběr 18 px, vrchol opacity 0,10 |
| Obrys výběru | 1 px, mezera 3 px od siluety |
| Popisek | `#D9E2E7`, 12 px, UI font, prefix `#` |

U obyčejného satelitu nevykreslovat plošnou svítící mlhu. Odlesk je stabilní světlejší ploška, ne animovaný specular. Satelity se samy netočí ani neobíhají. Otáčení view se řídí dosavadní kamerou, ne animací dat.

Zachovat uloženou výšku oběžné vrstvy. Výchozí hodnota zůstává 100/3 % poloměru nad povrchem, tedy vzdálenost 4R/3 od středu; redesign ji nesnižuje kvůli lepší kompozici. Kamerové rámování a přepínač ochrany výhledu musí respektovat vnější vrstvu. Occlusion a picking satelitů zůstávají propojené: co je schované glóbusem, nesmí být klikatelné.

Popisky satelitů se zobrazují podle přiblížení, priority vztahu a rozpočtu popisků; v přehledu přednostně související/vybraný tag. Stříbrný marker může být vidět i bez jména. Názvy nesmějí být vykresleny skrz glóbus.

## 13. Spoje měst se satelity

Tyto spoje jsou jediná část grafiky, která oprávněně opouští povrch glóbusu. Zachovat existující plynulou prostorovou křivku město–tag; neplést ji s povrchovou cestou mezi poznámkami.

| Stav | Barva | Šířka | Opacity | Halo |
| --- | --- | --- | --- | --- |
| Kontext vybrané poznámky / trasy | `#B7C8CE` | 0,70 px | 0,26 | Žádné |
| Vybraný satelit a jeho členové | `#DCEAED` | 1,10 px | 0,64 | 3,50 px, vrchol 0,08 |

V klidu bez vybraného města, trasy nebo tagu nekreslit všechny tagové spoje. Při výběru poznámky ukázat jen její skutečné vazby; při výběru tagu jeho skutečné členy. Nezkracovat počet vztahů tiše kvůli vzhledu. Při velmi mnoha spojích lze snížit základní opacity, ale vztahy ponechat dostupné v detailu a zachovat jejich pravdivost. Žádné pulzující pakety, šipky ani celé ozdobné orbitální kružnice.

## 14. Popisky a typografie

| Obsah | Font | Velikost / řádkování | Provedení |
| --- | --- | --- | --- |
| Běžné UI | Obsidian interface font / system-ui | 13 px / 1,4 | Regular, důležité položky medium |
| Metadata, status | Stejný UI font | 12 px / 1,4 | Vedlejší text, čitelný kontrast |
| Název poznámky v detailu | Stejný UI font | 18 px / 1,3 | Medium, max. 2 řádky |
| Kontinent | Georgia, Cambria, serif | 17–22 px / 1,2 | Small caps, tracking 0,12 em |
| Země | Georgia, Cambria, serif | 12–14 px / 1,25 | Jemná kurzíva, běžné psaní názvu |
| Město / tooltip | UI font | 12 px / 1,35 | Běžné psaní, bez kurzívy |
| Tag | UI font | 12 px / 1,35 | Prefix #, stříbrný text |

Velikosti textu se nemají mechanicky zmenšovat se zoomem pod uvedené minimum. Méně důležité popisky se skryjí. Názvy měst vždy vodorovně vůči obrazovce. Kontinentové názvy zachovat kartograficky usazené; maximální optické natočení vůči horizontále 12°, nikdy vzhůru nohama.

Text mapy: `#F4EBD8`, jemný tmavý stín `#08252B`, opacity 0,75, blur 2 px. Pokud lokální reliéf snižuje kontrast, nejprve zesílit tmavou podkresbu textu nebo zobrazit kompaktní tooltip, nikoli zvýšit jas celé pevniny. Na mapě nevytvářet kolem každého názvu velkou kartu.

Kolizní priorita popisků: vybraný/hover → endpointy trasy → výsledky hledání → související tag → kontinent → země → ostatní města → ostatní tagy. Odstup obdélníků alespoň 6 px; od ovládání 12 px. Název poznámky se nesmí překrýt jejím jádrem ani detailem. Vybraný popisek má plné jméno dostupné v detailu; běžné dlouhé názvy lze zkrátit.

## 15. Skladba view a responzivita

Mřížka používá odstupy 4, 8, 12, 16, 20, 24 a 32 px. Horní lišta má 52 px, boční padding 12 px, mezery 8 px. Dole je stavová lišta 32 px. Zbytek prostoru patří glóbusu. Search zabírá dostupnou šířku s cílem 360–560 px; Map controls zůstává jasně dosažitelné vpravo.

Pravý detail má šířku 288 px, padding 20 px a vnější odsazení 12 px. Při otevření detailu kamera nesmí náhle změnit orientaci. Glóbus lze plynule přerámovat bez změny jeho otočení a bez přepočtu layoutu. Zavřený detail nenechává prázdnou rezervovanou plochu.

Při prvním přehledu se do dostupné oblasti vejde celá viditelná vnější vrstva satelitů s alespoň 16px rezervou, pokud uživatel sám nepřiblížil. Vzhled nesmí vynucovat velikost sféry z obrázku na každé rozlišení. Na širokém view zůstává glóbus těžištěm kompozice a detail klidným doprovodem.

Pod šířkou view 900 px detail zúžit na 256 px jen pokud zbývá alespoň 480 px pro scénu. Jinak přejít na skládací spodní detail s maximální výškou 42 % dostupného view. Pod 600 px je search pružný, volba režimu může být kompaktní ikonou se zachovaným přístupným názvem. Žádné horizontální rolování nebo překryv primárních akcí. Mobilní pravidla vyhodnocovat podle runtime profilu i šířky panelu, ne jen šířky celé obrazovky.

## 16. Menu Map controls

Menu je jeden neprůsvitný panel `#10282D`, šířka 320 px, radius 8 px, rámeček 1 px `#35575D`, stín `0 12px 32px rgba(0,12,16,0.28)`. Padding 12 px, řádek nejméně 36 px, skupiny oddělené mezerou 16 px a jemnou horizontální linkou. Nepoužívat vnořené karty.

Respektovat současné skupiny a existující akce v `ViewToolbar.ts`. Doporučené vizuální členění je Globe, Explore a Layout; nepřidávat volby, které plugin neumí. U Globe patří Edges, Country borders, Labels, Tags, Continents a Atmosphere podle aktuálně dostupných voleb. Explore obsahuje stávající Find route a související akce. Layout seskupuje Refresh layout, Renew layout a existující správu mapy. Pokud se současné pojmenování liší, při implementaci sjednotit text s reálnou funkcí a i18n.

Řádek: ikona 16 px, mezera 8 px, název vlevo a hodnota/přepínač vpravo. Ikony Obsidian/Lucide, stroke 1,5 px. Hover plocha `#21454B`, pressed `#28555B`; bez změny rozměru řádku. Zvolená sekce má petrolejovou plochu a malou 2px mentolovou značku. Section label 12 px medium, běžná sentence case, bez technických zkratek v UI.

Na telefonu šířka `min(320px, dostupná šířka − 24px)`, řádky minimálně 44 px, editovatelný text nejméně 16 px. Menu má vlastní svislý scroll a stále dostupné zavření. Spodní hrana končí nad navigací Obsidianu a safe-area insetem. Fullscreen a autorotace zůstávají dostupné podle současného mobilního profilu.

## 17. Tlačítka, vstupy, přepínače a focus

Ovládací prvek na desktopu: výška 36 px, radius 6 px, vodorovný padding 12 px, mezera ikona–text 8 px, rámeček 1 px. Sekundární tlačítko a vstup mají `#17343A`, rámeček `#35575D`, text `#F4EBD8`. Hover rámeček `#56777C`, hover plocha `#21454B`. Primární akce používá zlatou plochu a tmavý text z palety; v jednom panelu má tuto váhu pouze jedna hlavní akce.

Focus-visible: vnější obrys 2 px `#A4DED2` s odsazením 2 px. Stisk nesmí vypnout focus. Disabled obsah má vlastní atribut disabled a ztlumenou barvu, bez hover efektu; nespoléhat jen na nižší opacity celého panelu. Touch target alespoň 44 × 44 CSS px, i když ikona zůstane 16 px.

Desktopový switch: stopa 30 × 18 px, jezdec 12 px, inset 3 px. Vypnuto stopa `#17343A`, obrys `#56777C`, jezdec `#92AAA8`; zapnuto stopa `#28555B`, obrys `#A4DED2`, jezdec `#F4EBD8`. Label a přepínač tvoří jeden klikací řádek. Součástí stavu je sémantická hodnota, nikoli samotná barva.

Slider: stopa 3 px `#35575D`, aktivní část `#91C8BD`, kruhový jezdec 12 px `#F4EBD8` s tmavým obrysem 1 px. Viditelná hodnota má jednotku a nemění šířku rozložení při tažení. Nativní klávesnicové ovládání zachovat.

## 18. Search a seznam výsledků

Find a note a Follow Search zachovat jako dvě existující funkce. Kompaktní search nepřidává marketingové texty ani novou navigaci. Aktivní follow stav ukazuje dotaz, počet skutečně nalezených poznámek na mapě a zřetelné × pro vyčištění podle současné funkce.

Výsledkový dropdown používá menu plochu, radius 6 px, rámeček 1 px a řádek 40 px na desktopu / 48 px na dotyku. Název 13 px, cesta 12 px, aktivní klávesnicový řádek `#28555B`. Shodu textu zvýraznit váhou nebo podtržením, bez dalšího barevného akcentu. Vedle počtu výsledků může být malý vínový bod s rose lemem, ale samotné číslo zůstává světlé.

Mapová highlight barva hledání zůstává `#963652`. Rose halo zlepšuje její oddělení od jadeitu i terakoty. Hledání nesmí přebarvit celý kontinent, potlačit výběr, změnit kameru v režimu Follow Search nebo přidat do mapy nové uzly.

## 19. Detail výběru, tooltip a kontextové akce

Detail je jedna souvislá petrolejová plocha. Pořadí: záhlaví Selection details se sbalením → název poznámky → cesta a stavové příznaky → Open note a připnutí → skuteční sousedé/tagy → Route sekce, pokud je aktivní. Sekce odděluje mezera 16 px a linka `#35575D`.

Vybraný typ uzlu má u názvu malý odpovídající tvar a barvu. Název 18 px, cesta 12 px. Seznam sousedů má řádky 32 px na desktopu / 44 px na dotyku, přirozený hover a celé jméno dostupné při zkrácení. Jedna hlavní akce Open note může být přes šířku panelu. Akce připnutí zůstává sekundární; při ukládání nezmizí ikona ani se neposune text.

Tooltip: plocha `#F2E7CF`, text `#153239`, jemný obrys `#D3C5A8`, radius 5 px, padding 6 × 8 px, stín `0 4px 12px rgba(0,12,16,0.20)`, text 12 px, max. šířka 240 px. Odsazení od markeru 10 px. Hover delay 280 ms, zobrazení 120 ms, skrytí 100 ms. Krátký tooltip může ukázat název a cestu; obsahuje-li akce, použít skutečný popover s odpovídajícím focusem. Na telefonu dostupnost detailu nesmí záviset na hoveru.

## 20. Stavová lišta, načítání a chyby

Stavová lišta má výšku 32 px, pozadí hlavního view, horní linku 1 px `#35575D`, text 12 px. Vlevo malý stavový bod 5 px a text/counts, vpravo Auto rotate, pokud je dostupné. Příklad pravdivého stavu: `Up to date · 150 notes · 228 links · 4 continents`. Nepřidávat falešné skóre zdraví mapy.

Up to date: zelený bod; pending změny: jantarový bod, konkrétní delta a dostupný Refresh; chyba: korálový bod, srozumitelný popis a existující možnost nápravy. Stav není určen jen barvou. Varování Renew musí jasně říct, že se změní rozložení celé mapy, a nabídnout Cancel.

Initialize: jednoduchý klidný stav s názvem probíhající operace. Refresh/Renew: stará committed mapa zůstává plně viditelná, nahoře či ve stavu kompaktní progress, a Cancel do chvíle, kdy jej současná transakční logika dovoluje. Progress stopa 3 px, petrolejová, výplň zlatá bez glow. Nepoužívat smyšlená procenta, pokud worker reportuje jen fázi. Žádné průběžně se přesouvající uzly nebo celoplošné rozostření.

Prázdná mapa nebo žádný výsledek: jedna věcná zpráva a reálná dostupná akce, bez ilustrace zakrývající scénu. Při chybě WebGL nabídnout existující chybový stav; netvrdit, že graf je vykreslen. Modaly používají stejnou paletu, zachovají klávesnici, focus a Escape podle významu akce.

## 21. Animace a práce s kamerou

| Přechod | Trvání |
| --- | --- |
| Hover města nebo tlačítka | 120 ms |
| Výběr / návrat ze zvýraznění | 180 ms |
| Otevření a zavření panelu | 160 ms |
| Fade popisků při zoomu | 180 ms |
| Explicitní focus kamery | 450 ms |
| Easing | `cubic-bezier(0.2, 0.7, 0.2, 1)` |

Změny opacity a velikosti markerů jsou krátké a bez pružinového přestřelení. Změna barvy probíhá plynule, ale nesmí po celou animaci míchat dvě nesouvisející sémantické barvy do matoucí třetí. Žádné animované přesuny jednotlivých měst. Hover ani pouhý výběr automaticky neotáčejí kameru; focus pouze na existující explicitní akci.

Auto rotate zachovává pevnou světovou osu, uživatelův náklon kamery, přerušení při manipulaci a současné obnovení po interakci. Nový vzhled k tomu nepřidává druhé otáčení glóbusu nebo satelitů. `prefers-reduced-motion` vypíná nepodstatné přechody, při běžném výběru nesmí být vnucený pohyb; explicitní uživatelská volba Auto rotate zůstává oddělená a výslovná.

## 22. Zoom, hustota a mobilní profil

Při odzoomování zmizí nejprve mikrograin, jemné vrstevnice a běžné názvy měst; zůstanou kontinenty, města a aktivní významová zvýraznění. Hrany a popisky respektují současné prahy v nastavení. Jejich fade může být plynulý, ale nesmí obejít volbu uživatele. Po přiblížení se země a města postupně doplní, bez skoku měřítka nebo přepočtu pozic.

Výchozí maximální rozpočty současně viditelných popisků napříč mapou: desktop 64, tablet 36, telefon 20, včetně jmen tagů. Rezervovat přednost vybranému názvu a endpointům trasy. Jde o výchozí cíle v rámci runtime profilu; respektovat přísnější uživatelský limit a vyšší prioritu interaktivního stavu. Po dosažení rozpočtu nevytvářet překryvy jen proto, aby byl vyčerpán celý limit.

Při touch gestu dočasně skrýt běžné popisky a základní cesty podle současného profilu; významové zvýraznění zachovat. Telefon: běžná města bez halo, halo výběru/hledání/trasy 75 % desktopové opacity, bez světelného lemu sféry a bez nejjemnějšího reliéfu. Nesnižovat čitelnost jádra a nezaměňovat významové barvy. Tablet může mít jemnější reliéf než telefon. Touch cíl města rozšířit nezávisle na viditelném průměru; při hustém grafu vybrat nejbližší skutečně viditelný marker.

Scéna v klidu nevykresluje nekonečné framy kvůli záři. Žádný full-scene bloom pass, dynamické shadow mapy ani externí textury jako podmínka tohoto směru. Zachovat existující adaptivní GPU profily a antialiasing. Obnova tématu nebo změna velikosti view nesmí znovu spouštět geografii.

## 23. Implementační návaznost na současný kód

| Oblast | Současné místo | Požadovaná práce |
| --- | --- | --- |
| UI role a rozměry | `styles.css` | Zavést pojmenované tokeny a odstranit konfliktní starší barevné override v rámci příslušných pravidel |
| Přenos barev do WebGL | `src/render/SphericalGraphRenderer.ts`, `renderTypes.ts` | Sjednotit UI a scene paletu; nerozmístit HEX hodnoty do mnoha tříd |
| Oceán a pevnina | `src/render/SphereLayer.ts` | Jemnější materiálové světlo, relief normals, paleta a pobřeží |
| Zemní geometrie | `src/render/landGeometry.ts` | Zachovat raster vlastnictví; nový efekt nesmí přepsat geografii |
| Města a prstence | `src/render/NodeLayer.ts` | Jádro, místní halo, řízená priorita a nejvýše dva stavové kruhy |
| Metrika markerů | `src/geometry/nodeMarkerMetrics.ts` | Zachovat společný význam měřítka pro renderer a budoucí explicitní layout; žádné tiché přepočty committed mapy |
| Cesty a halo | `src/render/EdgeLayer.ts`, `edgeHalo.ts` | Šířky podle CSS px, bez skládání více jader na jedné hraně |
| Hledání | `src/render/searchHighlight.ts` | Zachovat vínové jádro `#963652`, doplnit čitelný rose přechod a nezávislé prstence |
| Satelity a jejich vazby | `src/render/TagLayer.ts`, `tagGeometry.ts` | Stříbrné role přes společné tokeny; zachovat orbit height, occlusion a vazby |
| Popisky | `src/render/LabelLayer.ts`, `labelVisibility.ts` | Typografie, lokální kontrast, kolizní priority a rozpočty |
| Připnutí | `src/render/PinLayer.ts` | Jednotný drobný marker, bez velké rušivé ozdoby |
| Atmosféra | `src/render/AtmosphereLayer.ts` | Snížený kontrast, stejná pravidla viditelnosti a osy |
| Ovládání | `src/view/ViewToolbar.ts`, `GraphSearchControl.ts` | Skin současných funkcí, rozměry a dostupné stavy |
| Detail | `src/view/SelectionDetailsPanel.ts` | Hierarchie, spacing, typ uzlu a stavové příznaky |
| Progress a mobil | `LayoutStatusPresenter.ts`, `MobilePresentationModal.ts`, `src/platform` | Stejná vizuální rodina, safe areas a úspornější profil |

Poznámky k převodu: současné zvýrazněné hrany používají ribbon geometrii s šířkou ve world units. Čísla 1,35 nebo 1,65 z tohoto zadání do ní nelze dosadit přímo. Použít screen-space rozšíření ribbonu nebo korektní převod podle kamery a velikosti viewportu. U shaderu pracujícího s drawing bufferem převést CSS px přes skutečný pixel ratio právě jednou. Zajistit stabilní šířku i mimo střed glóbusu a za obvyklých úhlů pohledu; nestačí kalibrace jen jedním fixním world-space číslem.

Obdobně halo uzlů nelze nastavit jen pomocí CSS box-shadow, protože města jsou WebGL objekty. Zachovat instancing, oddělenou depth-tested halo vrstvu a řádné dispose materiálů. Textury, pole výšek ani geometrii neregenerovat při každém hoveru.

`TagLayer.ts` nyní volí stříbro uvnitř třídy, zatímco starší obecné tag tokeny stále obsahují jantar. Při realizaci má existovat jediný zdroj stříbrných tokenů i pro DOM detail, nikoli souběh dvou různých palet. Hover se v nové specifikaci přesouvá z přebarvení jádra na obrys; to je záměrná změna pravidel vizuálního stavu, nikoli ztráta funkce.

## 24. Postup realizace a hotovostní kritéria

Doporučené pořadí: společné barvy a UI tokeny → města a priorita stavů → hrany a satelity → menu a detail → světlo a materiály → popisky a mobilní ladění. Po každé vrstvě je možné smysluplně posoudit výsledek bez čekání na dokončení celého reliéfu.

Hotové provedení má splnit následující vizuální a funkční kontrolu:

1. Stejný uložený demo layout pro před/po: overview, detail zemí, výběr, hledání, souběh hledání s výběrem, trasa s alternativami a tag se svými členy.
2. Při D = 700 px odpovídají tloušťky přibližně ±0,25 px a města ±0,5 px referenci. Záře končí přibližně v určeném průměru, není z ní velká mlha.
3. Běžné město je rozeznatelné na okru, jadeitu, terakotě i oceánu. Vybraný uzel, route endpoint a search ring lze od sebe odlišit i bez rozpoznání samotného odstínu, pomocí tvaru, prstence a textu.
4. Hledání nepřepíše výběr, trasa nepřepíše nezávislý search prstenec a stejná hrana nemá několik konkurujících jader. Jedna poznámka nemá více než dva velké stavové prstence.
5. Při otočení se žádné město, halo, tag ani jméno neobjevuje skrz neprůhledný glóbus. Klikatelná oblast odpovídá viditelné scéně.
6. Menu, tooltip, detail i search odpovídají jedné paletě; primary text nemá opacity snižující kontrast. Cílový kontrast běžného UI textu vůči jeho skutečné ploše je alespoň 4,5 : 1, focus a důležité hranice alespoň 3 : 1. Mapové značky ověřit nad konkrétním materiálem, nikoli jen nad jednobarevnou vzorkovnicí.
7. View šířky 360, 600, 900 a 1440 px nevytváří horizontální scroll ani zakryté ovládání. Ověřit DPR 1 a 2, alespoň jeden telefonní a tabletový profil, dlouhé názvy a prázdný výsledek.
8. Otevření, zavření, otočení, změna tématu, search a výběr nemění committed positions ani nespouští solver. Bez animace a vstupu se rendering vrátí do klidu.
9. Ověřit Edges off se zapnutou trasou, Country borders off s viditelnými městy, Labels off bez osiřelých DOM popisků, satelity ve výšce z uživatelského nastavení a zachování načtené mapy.
10. Při skutečné implementaci spustit `npm run check`, následně vizuální QA v Obsidianu. Kontroly této specifikace samy o sobě nejsou důkazem shody hotového rendereru.

## 25. Soubory předávané k implementaci

- `ZIVA_KARTOGRAFIE_SPEC.md`: toto úplné zadání, pravidla významu a souběhu stavů.
- `ziva-kartografie.tokens.json`: výchozí barvy, číselné rozměry a limity; podklad k budoucímu převodu na typované tokeny.
- `03-ziva-kartografie.png`: výtvarná reference materiálů a kompozice; není bitmapou použitou jako UI.

Při ladění je možné upravit sílu jemného reliéfu a hustotu běžných popisků podle reálného GPU a vaultu. Významové barvy, priority stavů, screen-space rozměry a zachování committed mapy tvoří stabilní část zadání. Každou odchylku od nich zaznamenat jako konkrétní změnu tohoto dokumentu a odpovídajících tokenů.

## 26. Iterace 2 podle skutečného snapshotu

Uživatel 2. listopadu požádal o další iteraci: skutečné uzly a hrany byly
proti vizualizaci příliš malé a státy nebyly čitelné. Tato korekce nahrazuje
odpovídající číselné hodnoty v původních tabulkách; úplná aktuální sada je
v JSON tokenech se schemaVersion 2.

| Role | Upravené provedení |
| --- | --- |
| Běžné město | Základní průměr 7 px při D = 700 px; čitelné minimum 5.5 px i při uloženém zvětšení Globe size |
| Soused / aktivní / hover | Minimální průměry 6.5 / 8 / 8 px |
| Výběr / trasa / endpoint / Search | Minimální průměry 9 / 7.5 / 9 / 7.5 px |
| Lokální halo | Průměry 16 px běžné, 28 px výběr; ostatní stavy podle JSON. Nadále bez bloom a pulzování |
| Běžná hrana | 1.25 px, teplá slonová kost #E8CCA0; uloženou opacity respektovat |
| Hover / výběr / trasa / Search hrana | 1.55 / 1.9 / 2.2 / 1.75 px; významové barvy a priority zachovat |
| Pobřeží | 1.35 px, opacity 0.92 |
| Hranice států | Souvislé 1.2px krémové čáry, opacity 0.82; jemnější než hlavní zvýrazněné vztahy |
| Reliéf | Širší barevné vrstevnice a směrové světlo; výrazně méně vysokofrekvenčního důlkování a grain |

Vyhlazování má přidat jeden pixel přesahující jmenovitý tah, nikoli celé
vyhlazení vtěsnat dovnitř tenké čáry. Krytí odpovídá průniku pixelu s tahem;
čára o šířce okolo jednoho pixelu tak neztratí většinu své opacity.
U měst ponechat plné čitelné jádro a jemnou přechodovou hranu.

Starší uložené mapy bez country rasteru dostanou pouze vykreslovací
členění. Zárodky tvoří skutečné pozice poznámek a skutečné podsložky;
členění se rozrůstá uvnitř původního kontinentového rasteru a ořezává se
podle původní pevniny. Může mít enklávy, pokud je už má rozmístění starých
poznámek. Nevymýšlet dekorativní státy ani nic neukládat do committed
geografie. U existujícího country rasteru vždy zachovat jeho hranice.
Country borders přepíná hranice i jejich názvy. Názvy států lze doplnit
od zoomu 45 %, pokud projdou společným kolizním a početním rozpočtem.

## 27. Iterace 3 – implementace vizuálních nálezů bod po bodu

Uživatel požádal zpracovat všechny rozdíly z následného porovnání s konceptem.
Aktuální strojové hodnoty mají schemaVersion 3.

1. **Reliéf:** osm širších řezaných výškových pater, tmavší stěny a osvětlené
   horní hrany. Dva krátké statické vzorky výškového pole ve směru světla
   simulují stín pod vyšší hranou. U telefonního profilu se tyto dva vzorky
   vynechávají; při zoomu se účinek plynule doplňuje. Jde o optický materiál,
   nikoli změnu fyzických/saved souřadnic nebo vlastnictví.
2. **Světlo:** ambient 0.46, key 0.64, výraznější rozdíl horního levého světla
   a protilehlého svahu. Směr světla je kamerový; jeho převod do souřadnic
   terénního pole drží ledge shadows ve stejném směru při otáčení.
3. **Barvy:** sytější okr, hlubší jadeit a měděná hlína; širší rozsah světlých
   nížin a tmavších plošin uvnitř jedné barevné rodiny. Rodiny a colorIndex
   se nepřidělují znovu; přesné base/shadow/highlight barvy jsou v JSON.
4. **Města a výběr:** základ 8 px, běžné minimum 6.5 px, výběr minimálně
   14 px. Jádro má jemné osvětlení korálku; výběr má světlý hotspot,
   korálový stavový prstenec a 38px lokální halo s vrcholem 0.46.
   Popisek se umístí vedle uzlu nebo nad/pod něj, nikoli přes jeho jádro.
5. **Vztahy:** vybrané spojnice #F5CE76, 2 px, s měkkým lokálním halo.
   Korálová zůstává významem samotného vybraného města; Search zůstává
   vínové a nezávislé. Hrany mají vizuální přednost před geografickou kresbou.
6. **Státy:** teplá linka #DDC99F, 1.1 px / 0.72, tmavší podklad 2.7 px / 0.42.
   Kresba se zaobluje v obálce nejvýše 0.004 rad (cca 1.4 px při D=700).
   Zachovat spojení a junctions, ořezání na původní pevninu a bezpečné okolí
   měst 0.018 rad. Uložený country raster se nemění.
7. **Oceán a pobřeží:** hlubší modropetrolejový gradient a směrové světlo,
   jemná statická textura, klidná záře pozadí. Pobřeží má zlatou linku
   1.5 px / 0.94 a tmavší 3.4px podkresbu. Jemné zaoblení pouze kresby
   pobřeží je omezené na 0.001 rad, původní coast buffer zůstává dostupný.
8. **Typografie a detail:** kontinent 15–19 px s klidnější vahou, země 13px
   kurzíva, řádky sousedů 38 px na desktopu a 44 px na touch. Větší mezery
   v detailu; Open note je orámované petrolejové tlačítko s ikonou a mint focus.
9. **Kompozice:** ponechat skutečné uložené kontinenty, státy, mořské mezery
   a polohy měst. Vyšší počet ostrovů nebo jiné rozložení oceánu z ilustračního
   konceptu se nesmí doplnit falešnou geografií. Ladí se rámování, světlo a
   grafická hierarchie nad aktuálními daty; nová makrogeografie náleží Renew.

## 28. Iterace 4 – materiál, čitelnost a klidnější přehled

Aktuální strojové hodnoty mají schemaVersion 4. Implementace a skutečné
snímky jsou v [kontrolním reportu](ITERATION_4_REVIEW.md).

1. **Materiál pevniny:** šest širších pater nad spojitým výškovým polem.
   Váhy prostorových frekvencí 3.4/6.8/13.6/27.2 jsou 0.70/0.22/0.065/0.015;
   vysoké frekvence nesmějí stejně silně ovlivňovat normály jako makro svahy.
   Spojitý povrch se míchá s terasami v poměru 45:55. Jemný materiálový
   reliéf má amplitudu 0.007, odchylka zrnitosti 0.016. Fyzický displacement 0.
2. **Světlo hran pater:** tmavá stěna má sílu nejvýše 0.07 na odvrácené
   straně, horní lip nejvýše 0.15 násobené druhou mocninou směrového světla.
   Krátký stín má opacity 0.26. Ponechat kamerové světlo a telefonní omezení
   detailFade na 0.35, pod prahem dodatečných dvou vzorků stínu.
3. **Státy:** přidat lokální plošný odstín skutečného country rasteru.
   Pořadí v jedné kontinentové rodině používá cyklus
   0 / −0.11 / +0.09 / −0.055 / +0.045 / +0.12; míchá se stávající shadow
   nebo highlight stejné rodiny. Hranice zůstává 1.1 px / 0.72 s 2.7px
   podkresbou. Rozlišovací plocha nesmí změnit vlastnictví ani tvar státu.
4. **Vybrané město:** minimum 17 px, vyplněná korálová barva #FF866A,
   teplý hotspot s příměsí 0.18, halo 42 px / 0.60. Prstenec 1.1 px,
   mezera 1.5 px, jeho opacity je 40 % původní síly. Search má vlastní
   nezávislý vínový prstenec/halo a tuto redukci nepřebírá.
5. **Běžné vztahy:** zachovat každou viditelnou hranu i uloženou edgeOpacity.
   Jen běžná kresba dostane koeficient 0.28–1 podle lokálnosti, délky a stupně
   uzlů. Stejný adresář má základ 1, kontinent 0.82, mezikontinentální vztah
   0.56. Vybrané, hovered, Search a route tahy mají stále plnou stavovou sílu.
6. **Oceán a pobřeží:** hluboká voda #081F28, světlá #16434A, matná statická
   textura. Souřadnicová síť 0.65 px / 0.28, čárkování 3/5 px. Je nad
   oceánem, pod pevninou. Pobřežní a country ink modulovat směrovým světlem
   v rozsahu 0.58–1. Běžná města u obzoru ztlumit plynule až na 40 %;
   vybraná, Search, trasa, aktivní a hovered města ponechat plně čitelná.
7. **Paleta a rámování:** sage base/shadow/highlight jsou
   #A09253 / #625C36 / #D4C68B. Původní colorIndex zůstává zachován.
   Pouze explicitní Find/Focus posouvá cíl kamery směrem k plošnému středu
   uloženého kontinentového území: 35 % úhlové vzdálenosti, nejvýše 0.24 rad.
   Samotné vybrání/hover kameru neotáčí; souřadnice měst se nikdy nepřepočítají.
8. **Popisky a detail:** geografické názvy mají lokální měkké ztmavení,
   nikoli panel přes velkou část mapy. Open note a ikonový Pin jsou v jednom
   řádku; Pin zachovává přístupný název, pressed a busy stav. První čtyři
   sousedé tvoří náhled, Show all N zpřístupní všechny. Stav rozbalení se
   obnoví při změně vybraného města. Tlačítka mají 36 px desktop / 44 px touch.

## 29. Iterace 5 – tři kroky k prostorovému atlasu

Uživatel výslovně schválil skutečný prostorový reliéf. Tento oddíl a tokeny
schemaVersion 5 nahrazují dřívější omezení geometricDisplacement = 0.
Uložené jednotkové směry, raster vlastnictví a layoutový solver se nemění.

1. **Materiál a světlo:** každá kontinentová rodina má základ, shadow,
   highlight a tři další minerální odstíny. Velké nepravidelné barevné oblasti
   vycházejí ze samostatného pole, nikoli pouze z výšky či osvětlení. Country
   tints míchají až 30 % příbuzného minerálního odstínu podle skutečného rasteru.
   Společný kamerový key je normalize(−0.60, 0.76, 0.38), ambient 0.38,
   key 1.0. Jemný optický normálový detail má sílu 0.035 a mizí s oddálením.
2. **Voda a atmosféra:** statický drobný optický reliéf vody, světlejší
   petrolejové mělčiny odvozené od vzdálenosti skutečného pobřeží. Dva dražší
   vzorky vodního pole jsou na telefonu vypnuté. Atmosféra má 1.2px vnitřní
   světlo a měkkou 6px vnější záři, na telefonu 4 px. Je statická, směrová,
   depth-tested, oddělená od existující volitelné mrakové vrstvy.
3. **Geometrie:** jeden deterministický height sampler používá skutečnou
   podporu pevniny. Pobřežní plošina je až 0.45 % R, vlastní reliéf až 1.75 % R,
   celkem nejvýše přibližně 2.2 % R. Deset měkce řezaných pater kombinuje
   velké svahy, deformované hřbety a drobnější nepravidelnosti. Těsně pod městy
   je pole zklidněné. Původní buffery se zachovávají, worker vrací samostatné
   odvozené pozice, normály, výšky a pobřežní stěny.
4. **Pobřežní přechod:** oceán → mělčina → spodní písečný pás → skutečná
   boční stěna zvýšené pevniny. Stěna sdílí světlo a má kontaktní ztmavení
   u paty. Zmírnit grafický dojem souvislého zlatého obrysu; světlo sleduje
   natočení povrchu, samotná hranice uloženého území se neposouvá.
5. **Kotvení a viditelnost:** města, piny, hranice, názvy a počátky satelitních
   spojů vycházejí ze stejného sampleru. Grafické cesty mají bezpečnou výšku
   nad terénem i mezi vzorky. Picking a DOM popisky kontrolují skutečnou
   geometrii, takže nelze vybrat město skryté vyvýšenou pevninou. Přepnutí
   kontinenty/surface modes se promítá i do výškových kotev.
6. **Zakřivené vztahy:** boční odchylka po S² má maximum 3.5 % úhlové délky,
   nejvýše 0.025 rad. Na koncích je nulová, uvnitř plynulá. Kanonická dvojice
   ID dává stejnou cestu při obrácení vztahu a při otáčení/zoomu kamery.
   Blízkost cizího města 0.018 rad vetuje ohyb. Výběr, hover, Search a trasa
   přebírají tutéž geometrii; vztahy se neodstraňují.
7. **Špendlíky:** hlavička #A58AFF, světlá nožka #F5FAFC. Barvy jsou nezávislé
   na běžném i vybraném městě. Poloměr fyzické hlavičky 0.10 před existujícím
   škálováním Globe size. Počet i identita uložených pinů zůstávají zachované.

Normály a jemné kontaktní/cavity stínování nejsou globální shadow mapou.
Fyzický reliéf ovlivňuje siluetu a okluzi, světlo se vyhodnocuje v místním
materiálu. Fyzická mobilní zařízení a velmi velké vaulty vyžadují samostatné
výkonnostní měření. Výsledky této iterace patří do ITERATION_5_REVIEW.md.

## 30. Iterace 6 – jemnější ostré vrstvy, státy a jediný hover popisek

Tokeny schemaVersion 6 nahrazují starší hodnoty reliéfu a country tints.

- **Výškové pole:** dlouhé nepravidelně deformované tvary místo izolovaných
  vysokofrekvenčních hrbolků. Frekvence 3.8 / 7.6 / 15.2 / 30.4 mají váhy
  0.70 / 0.22 / 0.07 / 0.01; prostorová deformace pole má amplitudu 0.9.
- **Patra:** 16 jemnějších pater, 94 % terasové složky a 6 % spojitého svahu.
  Přechod stěny zabírá fázi 0.41–0.59, zbytek má převážně plochý charakter.
  Celková výška a společné kotvení zůstávají jako v oddílu 29.
- **Síť:** jedno zjemnění trojúhelníků v přechodech, shodné dělení společných
  hran a další řezy přímo na hranách pater. Plošiny mají hladké radiální
  normály, úzké stěny vlastní normály skutečné plochy. Hrubší zdrojové sítě
  vynechávají společně každý druhý/čtvrtý geometrický řez, nikoli náhodně po
  trojúhelnících. Tím nevznikají vnitřní T-junction trhliny.
- **Zákryt:** prostorový BVH index se sestaví ve workeru nad skutečnými
  trojúhelníky. Zachovává přesné front-face testy a bezpečnou vzdálenost od
  koncového bodu; hustší síť nevyžaduje plošné procházení všech trojúhelníků.
- **Materiál:** jemné normálové zrno 0.012. Směrové ztmavení stěny nejvýše
  0.24, světlo horního lipu nejvýše 0.08, filtrování podle velikosti pixelu
  a zoomu. Úroveň detailu se řídí skutečným promítnutým průměrem glóbusu.
- **Státy:** vlastní RGB násobitel pro každý uložený/display country klíč,
  stabilní při změně pořadí klíčů. Teplý, olivový, chladnější či tlumený
  růžový nádech má podobný jas a používá sílu 0.90 z malých barevných odchylek.
  Barva zůstává uvnitř kontinentové rodiny; nejde o přidělení nových států.
- **Hover:** pokud je vidět mapový popisek uzlu, samostatný tooltip se
  nezobrazí. Po umístění popisků se zruší i případný čekající druhý tooltip.
  Při vypnutých nebo neumístěných mapových popiscích zůstává náhradní tooltip
  pouze s basename. Městské mapové popisky nemají title s adresářovou cestou.
  Tagové tooltipy a otevírání/výběr poznámek se zachovávají.

Uložený layout a raster se nemigrují; žádná z těchto změn nespouští solver.
Nativní výsledky, testy a porovnání patří do ITERATION_6_REVIEW.md.

## 31. Iterace 7 – osm bodů porovnání s konceptem

Tokeny schemaVersion 7 nahrazují předchozí výtvarné hodnoty. Geografie,
uložené jednotkové vektory, seed a ownership se nepřegenerují.

1. **Nepravidelný reliéf:** frekvence 3.8 / 7.6 / 15.2 / 30.4 mají váhy
   0.58 / 0.25 / 0.13 / 0.04; deformace 1.1 plus detail 23 / 0.28.
   Jemné kanálky frekvence 24 mají omezenou hloubku 0.045 v signálu.
   Stále jeden společný height sampler, 16 pater a stejný výškový limit.
2. **Prostorové stupně:** skutečné normály stěn, směrový stín 0.16 a lip
   0.18; kontaktní stín paty nejvýše 0.17 pouze na neosvětlené straně.
   Zrno normál 0.025. Detail se filtruje podle pixelů, ne jako souvislý inkoust.
3. **Minerální barvy:** bohatší měděnohnědá/okrová rodina, méně olivových
   příměsí (0.16), základ kontinentu tvoří 48 % směsi. Hlubší lokální cavity,
   stacionární jemné odštěpky; žádná animace nebo externí textura.
4. **Státy:** stejné country rastry a stabilní klíče. RGB nádech má sílu 1.0
   z jemných multiplikátorů se stejnou luminancí; drobná plošná textura
   nezastírá souvislou barevnou identitu jednotlivých podadresářů.
5. **Hranice:** teplá #F3D6A0, 1.45 px / 0.90; tmavý podkres 3.1 px / 0.58.
   Barevný inkoust hranic se už neutlumuje nasvícením terénu.
6. **Pobřeží:** mělčina má šířku 0.028 rad, slabou vodní příměs 0.18.
   Písek je v Solid režimu neprůhledný a zapisuje hloubku; Transparent
   zachovává svou původní průhlednost. Zlatá linka #E4BA70, 1.6 px, tmavý
   podkres 3.6 px / 0.64. Původní pobřežní obrys se neposouvá.
7. **Světlo:** jednotná kamera-space směrová lampa [-0.62, 0.70, 0.34],
   ambient 0.27 / key 1.12. Lem #DEE6CB, vnitřní 1.7 px / 0.68,
   vnější 8 px / 0.32; dolní strana má 42 % základní síly. Telefon 4 px.
8. **Oceán a graf:** široké protažené batymetrické záhyby s optickými
   normálami, bez lesku a pohybu. Telefon vynechává dražší vzorky.
   Běžná města 9 px v referenční velikosti, minimum 7.5 px, halo 18 px / 0.17.
   Limb fade začíná na 0.55. Běžné vztahy 1.1 px; vzdálené/hub vztahy
   mají tišší kontext, ale všechny segmenty i explicitní zvýraznění zůstávají.

Nativní výsledky a přetrvávající rozdíly jsou v ITERATION_7_REVIEW.md.
