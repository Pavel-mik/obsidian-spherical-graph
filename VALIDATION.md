# Validation

## Directory geography release validation (1.4.0)

- Date: 2026-07-29
- Environment: Windows 11 x64, Node.js 24.12.0, npm 11.6.2
- `npm run check`: PASS
- ESLint and strict TypeScript: PASS
- Vitest: PASS; 42 files, 221 tests
- Production build and release metadata validation: PASS
- `git diff --check`: PASS; only Windows line-ending notices

The automated fixtures verify one deterministic, persistent continent per
linked vault-root folder, hard intrinsic S² territory boundaries with ocean
between folders, linked root notes initialized as islands outside those
territories, and orphan notes without land. Render tests cover the additional
same-subfolder selection highlight, while settings tests and type checking
cover the public-API folder exclusion picker and existing subtree filtering.

This turn did not run a full Obsidian GUI session. The plugin has no
browser-served QA target in the repository, so browser automation could not
exercise the Electron-only view; the relevant visual and interaction checks
remain listed in `MANUAL_TEST_PLAN.md`.

### Release artifacts (1.4.0)

- `main.js`: 854,295 bytes;
  SHA-256 `A3DA9544CBC076C86853BA81787FD1C56342A7C55697F5D3C49D9F84E52D7A32`
- `manifest.json`: 356 bytes, plugin 1.4.0;
  SHA-256 `23B867BC02FDE2DC2CEA1A63B0FE522948E5BDA0C4C8FAD1DB02899292825C2A`
- `styles.css`: 47,733 bytes;
  SHA-256 `FE26CC845D40C2B3F811513C56B99AA56B0EEF8B3657AEB4028BC4E5B0F68AE6`

## Environment

- Date: 2026-07-24
- OS: Windows 11, x64
- Vault: dedicated disposable `GlobeGraph` development vault
- Obsidian: 1.12.7, Electron 39.6.0, Chrome 142
- Plugin: 1.0.0, ID `spherical-graph`, desktop-only
- GUI viewport checks: 1280 × 672, compact 760 × 760, and narrow 520 × 760
- Browser automation: Playwright over the Obsidian Electron CDP endpoint;
  the Codex Browser plugin was not available

## Automated commands

| Command | Result |
| --- | --- |
| `npm ci` | PASS with npm 10.9.4; 379 packages installed from the lockfile |
| `npm audit --omit=dev --audit-level=moderate` | PASS; 0 vulnerabilities reported |
| `npm run check` | PASS |
| `npm run lint` | PASS, no warnings or errors |
| `npm run typecheck` | PASS |
| `npm test` | PASS; 33 files, 155 tests |
| `npm run build` | PASS; production `main.js` generated |
| `RELEASE_TAG=1.0.0 npm run validate:release` | PASS; release tag and metadata agree |
| `npm run benchmark:layout` | PASS |
| `git diff --check` | PASS; only line-ending notices from Git on Windows |
| `npm run generate:test-vault -- --output "C:\Users\Pavel\Projects\GlobeGraph\SphericalGraphFixture" --nodes 80 --edges 180 --pattern clustered --seed 42` | PASS; 80 files and 180 undirected edges |

The first clean-install attempt exposed an esbuild peer mismatch inherited from
the sample/tooling combination. The project was updated from esbuild 0.25.5 to
0.28.1, the lockfile was regenerated, and the final `npm ci` and complete
quality chain passed.

The full development-tree audit reports a high-severity denial-of-service
advisory in `brace-expansion` through the ESLint/Obsidian lint toolchain. npm
currently reports no nonbreaking fix for that transitive development-only
path. It is not included in `main.js`; the production-only audit reports zero
vulnerabilities.

## Publication-readiness audit

- `manifest.json`, `package.json`, and the current `versions.json` entry agree
  on version 1.0.0; the manifest declares minimum Obsidian 1.7.2.
- TypeScript compiles against the exact `obsidian` 1.7.2 package.
- The current `eslint-plugin-obsidianmd` recommended rules pass with zero
  warnings; `--max-warnings=0` makes future warnings fail CI.
- Command IDs do not repeat the plugin ID, user-facing command names use
  sentence case, runtime initialization waits for workspace layout readiness,
  and custom views are resolved from workspace leaves instead of retained in a
  separate reference collection.
- The production bundle is minified, contains no source-map footer, and the
  source contains no telemetry, updater, runtime network request, debug console
  call, Node/Electron import, HTML injection, or API key requirement.
- The GitHub release workflow validates the tag, runs the complete quality
  chain, attests the release files, and prepares a draft release containing
  exactly `main.js`, `manifest.json`, and `styles.css`.
- On 2026-07-24 the official Community Plugins catalog contained no matching
  `spherical-graph` ID or `Spherical Graph` name.
- The GitHub repository was still private during this audit. Public visibility,
  the `1.0.0` tag/release, and the Community Plugins submission remain external
  publication steps.

## Test coverage summary

The 165 automated tests cover:

- stable spherical distance, tangent projection/direction, exponential map,
  SLERP/geodesic arcs, antipodal fallback, rotations, and deterministic PRNG;
- full and incremental initialization, exact/sampled repulsion, unit norms,
  coverage, deterministic solves, Refresh warm-up, hard-fixed nodes, anchors,
  alignment, and displacement caps;
- graph extraction, filtering, weights, self-link removal, signatures, diffs,
  rename handling, active-file isolation, and debounced change tracking;
- migrations, malformed-data rejection, normalized persistence, atomic commits,
  camera/settings saves, rename/prune reconciliation, and pending nodes;
- lifecycle transitions, single-operation ownership, final-only renderer
  updates, stale messages, cancellation/error rollback, worker disposal, Blob
  URL revocation, and synchronous-callback races;
- renderer buffer validation, geodesic edges, instance colors, view status,
  search ranking, Renew confirmation state, and safe test-vault generation.
- smooth tangent node discs, Globe-size/reticle scaling, label zoom mapping,
  bright selected/route ribbons, and the union of all unweighted shortest
  routes, including equal-length alternatives and disconnected endpoints.
- dashed graticule/link material separation, distinct route endpoint roles and
  double rings, direct-neighbor selection details, and route-detail endpoint
  and node-union models.
- tag normalization without layout-signature changes, metadata-only renderer
  observations, deterministic unit tag directions, linearly expanding
  spherical spirals, adjustable orbit radius, main-globe segment occlusion,
  default-off camera-axis shaders, instanced satellite placement, and
  selected/route-only batched tag links.
- render-only tag, attachment, unresolved-link, and orphan filtering across
  nodes, edges, labels, picking, route candidates, and snapshot integration;
- derived attachment/unresolved positions that leave the committed layout
  signature unchanged;
- common zoom-driven note/tag label opacity and scale curves;
- deterministic tag-orbit anchoring and intrinsic packing from final committed
  note positions, including single-note tags and collision separation.

## Layout benchmark

These are local single-process synchronous measurements, not performance
guarantees. The benchmark intentionally uses fixed iteration caps:
Renew 100 = 40, Renew 1,000 = 28, Renew 5,000 = 14, Refresh new-node case = 28
with 8 warm-up iterations, and Refresh link-change cases = 20.

| Case | Time | Repulsion | Evaluated pairs | Max norm error |
| --- | ---: | --- | ---: | ---: |
| Renew 100 nodes / 292 edges | 68.98 ms | exact | 198,000 | 4.6121e-8 |
| Renew 1,000 / 2,992 | 276.31 ms | sampled | 494,290 | 4.0510e-8 |
| Renew 5,000 / 14,992 | 951.97 ms | sampled | 2,918,115 | 5.0084e-8 |
| Refresh 1,000 + 50 / 3,141 | 191.49 ms | sampled | 209,446 | 4.9085e-8 |
| Refresh small link change | 88.86 ms | sampled | 65,395 | 4.3290e-8 |
| Refresh large change | 210.79 ms | sampled | 351,884 | 5.3786e-8 |

Refresh preservation measurements:

| Case | Movable / hard-fixed / anchored | Max old displacement | Mean old displacement | Warning |
| --- | --- | ---: | ---: | --- |
| 1,000 + 50 nodes | 472 / 578 / 422 | 12.000° | 2.809° | yes |
| Small link change | 146 / 854 / 146 | 12.000° | 0.860° | no |
| Large change | 1,000 / 0 / 1,000 | 12.000° | 8.709° | yes |

For 5,000 nodes the sampled run evaluated 2,918,115 pairs, consistent with the
configured sampled rather than all-pairs global repulsion path.

## Actual Obsidian GUI test

A real GUI/WebGL test was performed in the desktop Obsidian application.
Playwright connected to the running Electron renderer; screenshots were saved
outside the repository as QA evidence.

Verified:

- the plugin was enabled and loaded, its open command was registered, and the
  dedicated `spherical-graph-view` became the active leaf;
- the view rendered a visible WebGL canvas with 81, then 82, nodes and no
  relevant console warning, page error, framework overlay, or error state;
- toolbar controls, keyboard search, selection/focus, Escape containment, and
  the shared Renew confirmation modal worked;
- `Ctrl` + double-clicking a search result opened
  `SphericalGraphFixture/Note-0001.md` in a new leaf while retaining the graph;
- adding `Note-0081.md` produced exactly
  `Changes detected · +1 / -0 notes · 2 link changes` without starting a
  layout; explicit Refresh then committed 82 nodes / 182 edges;
- a confirmed Renew changed the snapshot ID, incremented
  `renewGeneration` from 1 to 2, and moved all 82 tested node vectors;
- after rotation, zoom, search/focus, theme toggles, and two resizes, the
  committed position JSON and renderer position buffer were bitwise unchanged,
  while the camera changed as expected;
- after a full Obsidian restart the view restored as `fixed-clean` with
  82 nodes / 182 edges and no false startup diff;
- in the restored fixed state the plugin's lifecycle reported
  `activeWorkerCount: 0`;
- light and dark theme colors were legible; a renderer regression discovered
  during this check (black instance-colored nodes) was fixed and covered by a
  unit test;
- the compact 900 × 720 desktop viewport wrapped the toolbar to two rows
  without overlap and retained a visible 691 × 506 canvas.
- tangent node discs compiled as valid `CircleGeometry` / `ShaderMaterial`
  instances with no WebGL shader diagnostics; an invalid shader declaration
  found during QA was fixed before the final build;
- selected links used a separate bright magenta ribbon layer, while a
  four-hop route from `Note-0007` to `Note-0064` highlighted the union of 13
  nodes and 17 edges in a distinct acid green;
- the globe graticule rendered as a muted `#284650` dashed material at 0.14
  opacity while note links remained continuous cyan at 0.28 opacity;
- the route origin and destination used separate green/amber treatments,
  endpoint-aware `Start`/`Dest` labels, and four endpoint ring instances;
- the responsive **Selection details** panel listed all four direct neighbors
  of `Note-0007`, listed both endpoints and all 13 route-union nodes, and
  `Ctrl`-click opened `Note-0004` in a new tab;
- at the compact 760 × 760 viewport the panel became a 500 × 225 bottom drawer
  and retained its own scroll region without covering the globe center;
- the **Selection details** header collapsed the panel from 475px to 39px,
  changed `aria-expanded` from `true` to `false`, preserved its state through
  route selection, and became a bottom rail in a 520px-wide viewport;
- the disposable fixture exposed five unique tags from four real tagged notes
  through the public metadata-cache pipeline; no note was modified during this
  validation pass;
- the tag layer rendered five batched violet octahedral satellites. Selecting
  tagged `Note-0016` produced 120 spiral vertices for its two tags;
- **Tag orbit height** now uses a percentage of the globe radius. The new
  default is 30% (radius 13 on the radius-10 globe); the render-layer test
  confirmed that 50% produces radius 15 without touching layout positions;
- **Protect globe view from tags** was confirmed disabled by default. Toggling
  it changed the marker shader uniform from 0 to 1 and back to 0; a tag aligned
  directly with the camera remained visible while disabled and faded while
  enabled;
- the same aligned tag and its label were visible in front of the globe and
  absent when moved behind it. The absence remained correct in Solid,
  Transparent, and Hidden surface modes; marker and link shaders produced no
  WebGL diagnostics;
- changing **Globe size** from 100 to 200 halved the selected reticle scale,
  and a label threshold of 80 hid all labels at camera distance 27 before 11
  labels reappeared after zooming to distance 13.59;
- the complete route, selection, setting changes, zoom, and reset sequence
  changed 0 of 246 committed position-buffer values.
- a follow-up Browser QA harness using the production `ViewToolbar`,
  `SphericalGraphRenderer`, picking controller, tag layer, selection panel,
  and stylesheet confirmed the new on-screen **Tags** toggle hides and restores
  the entire tag layer;
- clicking `#cybernetics` selected the satellite, drew its three violet spiral
  links, and opened a tag detail containing clickable Atlas, Beacon, and
  Cipher entries. The detail remained collapsible, and a clean harness load
  produced no console warnings or errors;
- unit tests cover the 30% orbit default, legacy scene-unit migration, selected
  tag link generation, and bounded automatic Globe-size scaling. Initialize
  and Renew opt into automatic sizing; Refresh explicitly preserves the
  current value.

The separate lifecycle tests verify that Refresh/Renew progress never sends
working position buffers to the renderer and that the previous snapshot is
replaced only by a valid terminal completion.

## Version 1.1.0 update validation

On 2026-07-27 the release candidate passed:

- `npm run check` (ESLint, TypeScript, 35 test files / 165 tests, production
  build, and release validation);
- `RELEASE_TAG=1.1.0 npm run validate:release`;
- `npm audit --omit=dev` with 0 vulnerabilities;
- `git diff --check` with no whitespace errors.

A browser QA harness loaded the production `SphericalGraphRenderer`,
`ViewToolbar`, `SelectionDetailsPanel`, and release stylesheet against a
deterministic 72-note graph. The generated screenshots are committed in
`docs/screenshots/`.

Verified:

- the only persistent top-bar control besides the disclosure was
  **Find a note…**; opening **Graph controls** exposed separate Actions,
  Filters, and Appearance sections;
- enabling **Attachments** changed the authoritative checkbox state and
  immediately added all three attachment labels and incident render edges
  without a layout operation;
- note and tag labels shared the same zoom response. For the measured
  `Research Atlas` / `#atlas` pair, the rendered scale changed from 0.974 to
  0.895 while opacity faded from 1 to 0.56 at an intermediate zoom-out;
- the route scenario displayed distinct magenta selection links, acid-green
  shortest-route links, Start/Dest endpoint labels, tag satellites, and the
  clickable Selection details panel together;
- the default globe, route, and open-filter scenarios produced no browser
  console warnings or errors.

## Unreleased continental-atlas update validation

On 2026-07-27 the complete local quality chain passed:

- `npm run check`;
- ESLint with zero warnings, TypeScript type checking, 39 test files / 184
  tests, production build, and release-artifact validation;
- focused geography/render regression tests for community detection,
  continent-aware placement, solver cap constraints, land ownership,
  responsive camera framing, and viewport label budgets.

A disposable browser QA page imported the production
`SphericalGraphRenderer` and release stylesheet directly. It rendered a
deterministic 65-note, 98-link world with five continents, five islands, and
seven tag satellites. The QA wrapper supplied only Obsidian-like DOM chrome
and synthetic public graph data; it did not replace or mock the WebGL
renderer. The generated desktop screenshots replaced the previous
cyberpunk-era images in `docs/screenshots/`.

Verified at 1536 × 1024:

- the page identity was `Spherical Graph · Atlas QA`, one non-empty 1536 × 937
  WebGL canvas loaded, five cartographic continent labels rendered, and there
  was no horizontal page overflow;
- matte ocean, disjoint earth-tone landmasses, explicit sea gaps, city discs,
  subdued surface roads, coral selection, amber tags, and serif region labels
  remained visually distinct;
- opening **Map** exposed Actions, Filters, and Appearance with
  **Continents** checked;
- toggling **Continents** off changed the authoritative state to `false`,
  removed every land/coast layer and all continent labels, and produced no
  renderer error; toggling it on restored all five labels without a layout
  operation;
- the route scenario displayed amber route roads and explicit `Start` /
  `Dest` labels while keeping coral selection roads visually separate;
- no browser console warning/error, framework error overlay, or renderer error
  was present after the complete interaction sequence.

Verified at a 430 × 800 narrow-pane breakpoint:

- the derived camera field of view kept the complete globe width in frame;
- the responsive display budget reduced note-label density while leaving the
  configured `maxLabels` value untouched;
- the Selection details panel became a bottom drawer and the document had zero
  horizontal overflow.

The first browser render exposed depth-buffer interference between the ocean
and land skins, visible as false triangular holes. The final implementation
uses an inset ocean depth skin, ordered logical surface layers, and a tighter
camera clip range. Repeated final renders showed continuous land with no
console or WebGL errors. This harness validation supplements, but does not
claim to replace, an actual Obsidian desktop GUI pass for the unreleased
update.

### Organic-coast visual follow-up

The accepted 1536 × 1024 atlas concept and the production-renderer screenshot
were compared side by side before this pass. A new disposable 65-note browser
scene then exercised the production `SphericalGraphRenderer` at each geometry
iteration. It exposed and resolved two visible approximation defects:

1. low icosphere subdivision made the first coastline visibly polygonal;
2. increasing subdivision alone revealed regular teeth because a complete
   triangle inherited its centroid's land owner.

The final renderer uses a finer source surface plus ownership-boundary
clipping. Browser inspection confirmed continuous irregular coves and
headlands, mottled land relief, subtle contour/grain detail, independent ocean
texture, irregular islands, and a continuous sand coastline. **Map →
Continents** was toggled off and on: land, coastlines, and region labels were
removed and restored without a layout change. A page-level collector for
`error`, unhandled rejection, and `console.error` remained empty through the
complete interaction. Updated globe, route, and open-Map screenshots were
written to `docs/screenshots/`.

### Large-vault island-density regression

The reported failure case was reproduced with the production renderer using a
deterministic 636-note, 3,390-link scene containing two accepted continents
and 600 semantic island nodes. Before the fix, the former one-land-patch-per-
free-note rule covered the globe with hundreds of overlapping polygons.

The regression test and disposable browser scene now verify that:

- the complete `npm run check` chain passes with 39 test files / 185 tests,
  production build, and release-artifact validation for version 1.2.1;
- the complete semantic island set is retained while rendered island land is
  deterministically limited to 24 spatially separated representatives;
- island radius at 636 notes is less than half its 82-note size;
- two continent labels, ocean, cities, and roads remain legible;
- **Map → Continents** removes and restores land, coastlines, islands, and
  labels without recomputing layout; and
- the browser console remains free of warnings and errors through the toggle
  sequence.

### Large-vault continent-rescue regression

The follow-up failure was reproduced by the default detector with a
deterministic 636-note graph. It contained five planted cohesive regions with
40, 36, 18, 15, and 12 notes plus 515 free notes. The former automatic
24-note floor retained only the first two regions.

The revised detector and production-renderer QA verify that:

- the complete version 1.2.2 release gate passes with 39 test files / 188
  tests, production build, and release-artifact validation;
- all five planted regions are accepted in deterministic size order;
- the 18-note region passes the ordinary sublinear threshold, while the
  exceptionally stable and low-conductance 15- and 12-note regions use the
  guarded rescue path;
- a separate 15-note sparse chain in a 636-note graph produces zero
  continents;
- an explicit 24-note minimum still produces exactly the original 40- and
  36-note continents;
- the renderer reports five continents while retaining the 24-of-515
  representative-island land budget; and
- **Map → Continents** removes and restores all visible land and labels with
  an empty page error collector and no browser console warnings or errors.

The detector runs only during a layout operation. Version 1.2.2 deliberately
does not invalidate or move an existing committed map; **Renew layout** applies
the revised classification to an unchanged vault.

### Topology-supported coastline regression

The reported version 1.2.2 failure was traced to a mismatch between semantic
membership and rendering. Although each continent persisted its complete
`nodeIndices`, the old land owner test ignored them and classified the surface
only by distance from the continent center versus a noisy radial cap. It
therefore filled unsupported gaps, crossed visually empty boundaries, and
could exclude a legitimate outer member where a procedural cove shortened the
radius.

Version 1.2.3 replaces that render-only test with density-aware support from
member cities and short internal roads. Foreign continent/island sites carve
sea, competing support retains a water margin, and long graph edges do not
create land corridors.

Automated regressions verify that:

- the complete version 1.2.3 release gate passes with 40 test files / 191
  tests, lint, type checking, production build, and artifact validation;
- every continent member classifies as its semantic land owner;
- a foreign node inside the old radial cap remains outside that continent;
- an unsupported point inside the old cap remains sea;
- a short internal road joins nearby city kernels; and
- a long internal road leaves its midpoint as open water.

A disposable browser scene imported the production
`SphericalGraphRenderer` and release stylesheet directly. Its deterministic
636-note, 525-link world contained one irregular three-lobed 80-note continent,
100 densely packed foreign nodes next to it, and 456 other free notes. Browser
inspection reported `members on land: 80/80`, `foreign covered: 0/100`, and
`empty gulf: sea`. The visible coast followed the three member/road lobes
without filling the neighboring dense region. **Map → Continents** removed and
restored the land and label, and a fresh browser run produced no console
warnings or errors.

This correction changes only derived render geometry. It preserves committed
node vectors and persisted continent membership, and therefore applies
immediately without **Renew layout**.

### Multiscale community recovery and lake suppression

The five reported version 1.2.3 screenshots exposed two independent failures.
The detector previously built one consensus across all CPM resolutions. A
hub-and-spoke region that was stable at a coarse scale but subdivided at a fine
scale therefore lost too many consensus edges to become a candidate. The same
mechanism could strand a legitimate boundary note. Separately, every
unassigned note was treated as a foreign territory site by the renderer, so
one stranded note could cut a circular lake from otherwise continuous land.

Version 1.2.4 forms candidates inside each resolution, reconciles nested and
partial variants, and measures stability at the candidate's best scale. A
two-hop/redundant-edge cohesion gate distinguishes compact stars from sparse
paths. After disjoint selection, a bounded affinity pass adds an unassigned
node only when at least two member neighbors give one continent a dominant
majority of its incident link weight. The renderer now reserves sea influence
for accepted competing continents or locally linked and spatially coherent
free-node groups; one isolated free note no longer punches a lake.

Automated regressions cover:

- the complete version 1.2.4 release gate with 40 test files / 196 tests,
  lint, strict type checking, production build, and artifact validation;
- a 24-note hub community inside a 636-note vault;
- simultaneous 24- and 18-note stars plus a 20-note dense region;
- rejection of a similarly sized sparse chain;
- a boundary note excluded at high CPM resolution and recovered from two
  unambiguous internal neighbors;
- complete land ownership for every semantic continent member;
- no lake around one isolated free note; and
- preserved sea around an accepted competing continent and a coherent
  three-note free community.

A disposable browser scene imported the production detector, geography
planner, renderer, and release stylesheet. Its deterministic 636-note,
249-link graph contained two stars, one dense core with a recovered boundary
node, a sparse chain, and unrelated free notes. The production UI reported
three continents of sizes `24/21/18`, `members 63/63`, the boundary node
assigned, and `isolated free no lake`. All three landmasses were continuous
and visually separated; the sparse chain remained ocean. **Map → Continents**
removed and restored all three landmasses and labels, with no browser console
warnings or errors.

The detector change is applied by **Renew layout**. The isolated-lake rendering
correction applies immediately to an existing committed map.

### Post-layout spatial-cartography regression

The reported circular and semantically drifting continents were reproduced as
an architectural feedback loop: graph communities selected circular caps
before the solve, those caps constrained node positions, and the renderer then
treated the same cap-derived result as geographic evidence. A second failure
allowed small unsupported watershed basins to transitively merge otherwise
distinct regions. Finally, every note in a selected basin was seeded as land,
so a wide basin could absorb a dispersed background.

Version 1.3.0 removes geography from initialization, worker messages, forces,
integration, and displacement constraints. Geography now consumes only the
validated final unit vectors. An intrinsic grid, adaptive fine/coarse density,
watershed with aggregate component state, supported core seeds, exclusive
ownership, and one connected ocean derive the semantic map afterward. CPM
communities are marker priors only.

Automated regressions verify that:

- the complete suite passes with 41 test files / 216 tests, strict type
  checking, ESLint, production build, and release validation;
- dense clusters remain separated after the ordinary full-sphere solve without
  an orientation- or absolute-radius-dependent assertion;
- one graph prior can split across two distant spatial regions, conflicting
  priors can merge across a shallow spatial saddle, a density-only region can
  form without links, and one graph prior cannot cover a uniform globe;
- ownership is exclusive, the ocean has exactly one component, completed
  positions remain bit-for-bit unchanged, and algorithm-2 snapshots are
  rejected in favor of algorithm version 3;
- long or structurally suspicious graph bridges do not paint land;
- one dense circular fixture receives a deterministic irregular coast while
  its interior remains continuous; and
- the 636-node render-support fixture completes in 861 ms after reversing the
  hot loop from cell-to-global-support queries to anchor-to-nearby-cell
  accumulation. The previous path measured 4,458 ms under the full suite.

A separate deterministic 636-note, 2,944-link geography benchmark planted five
large spatial communities among a uniform loose background. It produced
exactly five landmasses, included all 490 planted community notes, retained 116
islands, assigned only five to seven physically adjacent loose notes to each
landmass, used 18.8% of analytical grid cells as land, completed in 781 ms, and
left the fixed position buffer bitwise unchanged.

A disposable desktop browser atlas imported the production
`SphericalGraphRenderer`, release stylesheet, and post-layout geography
directly. Its 153-city, 478-road scene reported three continents, 35 islands,
and fixed positions preserved. The rendered landmasses were spatially
separated, visibly non-circular, bordered by an irregular sand band, and free
of accidental interior holes. The Continents control removed and restored
land without changing the canvas; drag rotation and camera reset both worked.
The browser console remained free of warnings and errors. This was a production
renderer harness, not a full Obsidian-shell session.

### Broad-ocean and weak-node regression (1.3.1)

The large-vault screenshot was reproduced as a render-support saturation
problem: 636 fixed cities split among three semantic continents covered 10,241
of 10,242 analytical raster cells. The ocean was technically connected, but
its 520 externally connected cells occupied only 5.077% of the surface and
therefore read as narrow rivers.

Version 1.3.1 separates cartographic roles by current graph degree without
changing any committed vector:

- degree-three-or-higher notes contribute continental spacing, density,
  watershed population, membership, and render support;
- degree-one/two notes remain eligible for individual island patches; and
- degree-zero orphan notes remain interactive cities over water and create no
  land.

The renderer also expands only the already connected external ocean, one weak
coastal raster ring at a time, while protecting actual continent-member cells.
The deterministic target is 34% for one continent, plus 2.5 percentage points
per additional continent, capped at 46%. Because the expansion front always
starts in the connected ocean, it cannot create a new inland lake.

Automated validation verifies that:

- the complete release gate passes with 41 test files / 220 tests, ESLint,
  strict type checking, production build, and release validation;
- the saturated three-continent fixture now contains 3,995 connected-ocean
  cells out of 10,242, or 39.006%, with 6,247 land cells and every protected
  member cell retained;
- adding loose orphan notes leaves the adaptive density array bit-for-bit
  unchanged;
- legacy continent membership is filtered from live degree data, so stored
  degree-one/two members become island candidates and degree-zero members do
  not seed land; and
- persisted geography may intentionally omit orphan nodes and still validates
  and round-trips, while omission of any linked node is rejected as corrupt.

A disposable 1440 × 940 desktop atlas imported the production
`SphericalGraphRenderer`, release stylesheet, and degree-aware land renderer.
Its fixed 96-city scene contained three continents, 12 degree-one/two islands,
and 12 orphan cities over water. The three landmasses were separated by broad
open seas with irregular sand coasts. **Hide continents** and
**Show continents** both worked, and the renderer's position buffer remained
bit-for-bit stable. The browser console contained no warnings or errors.

The Codex in-app browser was attempted first but rejected all local aliases
(`127.0.0.1`, `localhost`, and a local DNS alias) with
`ERR_BLOCKED_BY_CLIENT`. Visual QA therefore used the documented fallback:
Playwright connected over CDP to the installed headless Edge. This was a
production-renderer harness, not a full Obsidian-shell session.

## Release artifacts (1.3.1)

- `main.js`: 856,099 bytes
- `manifest.json`: 356 bytes; plugin 1.3.1
- `styles.css`: 45,676 bytes
- no separate worker JavaScript file is required or present

SHA-256 values from the final production build:

- `main.js`: `310086467580BB9354D78C303F0A49ACD0A0F5B8FE076B7F52A0BC05EFC837D8`
- `manifest.json`: `6D32BA2B63D0C5D356B1C93D6883E1ECB376A7F01DBD72DFEA572DC2BA3AEF4D`
- `styles.css`: `91F52E4A52064852993BBE71AB995CFC2C18C7DF9B6103144FEADAA552027D5B`

## Release artifacts (1.3.0)

- `main.js`: 853,702 bytes
- `manifest.json`: 356 bytes; plugin 1.3.0
- `styles.css`: 45,676 bytes
- no separate worker JavaScript file is required or present

SHA-256 values from the final production build:

- `main.js`: `B0E8EFE3D9E90B09706418D2A65CE0A3175DDD73D1AFD194046241FE3F725655`
- `manifest.json`: `A7DD066A532F9E9202997ADA0B1E01D6243F90A0120509B0DD46774A5A2DCC78`
- `styles.css`: `91F52E4A52064852993BBE71AB995CFC2C18C7DF9B6103144FEADAA552027D5B`

## Not manually exercised

These remain covered only partially by automated tests or by the manual plan:

- a deliberately long GUI Cancel operation and injected worker/WebGL failure;
- pop-out-window ownership and ten repeated open/close memory measurements;
- WebGL context loss/restoration;
- a complete human visual comparison of all three surface modes beyond the
  automated tag-occlusion check;
- an actual 1,000- or 5,000-note WebGL vault (the solver benchmark covers those
  sizes, not complete Obsidian rendering);
- mobile, which is explicitly outside the desktop-only MVP.

See `MANUAL_TEST_PLAN.md` for the complete follow-up matrix.

## Release artifacts (1.1.0)

- `main.js`: 795,263 bytes after the final production build
- `manifest.json`: plugin 1.1.0, minimum Obsidian 1.7.2
- `styles.css`: 35,452 bytes
- no separate worker JavaScript file is required or present

SHA-256 values from the final build:

- `main.js`: `72E0B878BDAD258DDF134CFF153824A9EC801DF856292460FFB9814BB3C58A87`
- `manifest.json`: `77D53541E250B9CAA3642718F6EABCD0B996A4C014C64BEF9E32FA5E6D2E5788`
- `styles.css`: `2AE79536251378C02CA7C78DEA7B9F40124F91CE919F7680E885861862979441`
