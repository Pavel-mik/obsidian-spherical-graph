# Validation

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
