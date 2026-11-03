# Decisions

## Repository and vault

- The existing `C:\Users\Pavel\Projects\GlobeGraph` vault is the dedicated
  development vault. It was already registered in Obsidian, contained one
  welcome note, and had no third-party plugins when work began.
- The GitHub repository is `Pavel-mik/obsidian-spherical-graph`; it starts
  private and can be made public when the project is ready for Community
  Plugins review.
- The checkout lives directly at
  `.obsidian/plugins/spherical-graph`, so `manifest.json` is at the exact level
  Obsidian expects.

## Identity and compatibility

- The exact Community Plugins catalog contained neither `spherical-graph` nor
  `spherical-graph-view` when checked on 2026-07-23, so the preferred ID
  `spherical-graph` is retained.
- `minAppVersion` is `1.7.2`. The view uses the public `Workspace.revealLeaf`
  API introduced in that release; its scoped search key handling requires only
  the older public `View.scope` API. The minimum is therefore tied to the
  newest API actually used rather than to the current Obsidian release.
- The MVP is desktop-only because its Three.js/WebGL interaction and pop-out
  lifecycle are not yet verified on mobile.

## Product invariants

- Stored node positions are normalized unit vectors, and rendered edges are
  sampled geodesic arcs.
- Layout is a finite transaction. The renderer sees only the previous committed
  snapshot or one fully validated replacement—never iterative working buffers.
- Vault events compute pending graph changes but never start the solver.
- Visual settings and camera state are persisted independently from layout
  positions.
- A restored view waits for the initial public metadata-cache `resolved`
  signal when `resolvedLinks` has not yet covered all Markdown sources. This
  avoids a partial startup graph and false pending-link changes.

## Presentation and interaction corrections (2026-10-07)

- Mobile presentation temporarily hosts the existing graph root in a public
  Obsidian `Modal`, whose history lifecycle handles Android Back. Closing it
  restores the root to its original parent and exits native or CSS fullscreen.
  No private mobile API or global history interception is used.
- Only tablets render an exit button. Desktop provides a three-second Escape
  hint; phones rely on host Back and auto-rotate only during presentation.
- Phone controls remain inside the graph pane, with clearance for Obsidian's
  navigation bar and the device safe area. Tablet spacing is unchanged.
- Automatic rotation uses the globe's fixed north-south axis (world Y).
  Camera position and up rotate together, preserving the viewing latitude and
  roll chosen by the user: the poles remain stationary on screen while the
  surface turns. Camera up is a viewing direction, never the globe's spin axis.
  Atmospheric drift uses the same fixed polar axis with the opposite
  world-space sign, because positive camera orbit makes the planet appear to
  turn in the negative direction. Clouds complete a relative turn every
  7.5 minutes.
- Renew already retains pins through the shared persistence envelope and
  repositions their meshes by note identity. Regression tests cover both
  synced pin changes and reordered nodes; no persistence-format change is needed.

## Visual scale and route navigation

- **Globe size** is a relative visual scale rather than a geometry or camera
  change. A value of 100 preserves the original marker size; doubling it
  halves node discs and the selected-node reticle. This keeps the fixed layout
  and persisted camera invariant while giving large vaults more visual space.
- Node markers are smooth instanced tangent discs. A small shader reduces their
  brightness toward the globe limb from the camera's current view direction,
  strengthening the spherical depth cue without changing picking positions.
- All shortest routes are represented by their union, found with two BFS
  distance fields. This highlights every equal-hop alternative in O(V + E)
  time without enumerating an exponential number of path sequences.
- Route state is local to the open view and intentionally not persisted. It is
  an exploratory overlay, distinct from magenta selection, and never changes
  graph data or committed layout positions.

## Render-only tag orbits

- Tags are metadata-derived satellites, not solver nodes. Adding or removing a
  tag must not mark the committed spherical layout dirty or change any document
  vector.
- Each normalized tag hashes to a deterministic unit direction on an invisible
  concentric sphere. Its validated height above the main globe is adjustable;
  the carrier sphere is never rendered or persisted.
- A note-to-tag link follows a geodesic direction while its radius increases
  linearly from the note surface to the tag orbit. Links are rebuilt only for
  the selected note and the active route-node union.
- All markers and links are batched. Main-globe occlusion is always geometric,
  including in transparent and hidden surface modes. The stricter camera-axis
  fade is an optional appearance preference and defaults to disabled.

## Continents and atlas direction

- Top-level vault folders are authoritative continent owners. This replaces
  inferred graph communities with a stable, explainable mapping users control
  through their existing vault structure.
- Initialize and Renew allocate a fixed connected spherical territory per top-level folder, then connected child-folder countries inside it. The note solver uses the same ownership grid as the rendered boundaries; geographic ownership takes precedence over cross-folder links.
- Same-folder springs retain full strength, cross-folder springs use 14%, and
  root-note edges use 35%. Rendering, selection, and Route Finder always use
  the original graph weights.
- Country-enabled maps include every Markdown note under a top-level folder, including orphans. Immediate child folders own all deeper descendants. Direct notes get a synthetic Common country identified by the parent path; it cannot collide with a real subfolder name. Linked root notes remain islands; all root notes are constrained to the ocean outside continental countries.
- Region initialization and bounded landmark stress still provide topology hints, while country constraints prevent springs, port placement and collision projection from leaving the assigned region.
- Global coverage treats each top-level folder centroid as one sample. This
  prevents a large population from being pulled into a sphere-spanning disc
  while still distributing continent centers over the globe.
- Port cities are selected by relative external-link evidence within their own
  folder and require a coherent destination bearing. Their bearings are
  recomputed from converged real cross-folder neighbors before the coastward
  move. A final marker-aware intrinsic collision projection is separate from
  force convergence and preserves Refresh fixed masks and anchor caps.
- Legacy maps preserve their old orphan placement until Renew. Country-enabled Refresh reuses exact ownership, admits new notes only into existing countries, and rejects geographic moves/new country keys with an actionable Renew message. Same-country renames preserve positions; cross-country moves stay pending rather than appearing in the wrong state.
- Refresh continuity preserves compatible continent identity and color through
  full-path and relative-path overlap matching. Current folder names always
  determine labels.
- Mixed surface triangles are clipped at the ownership boundary; centroid-only
  triangle acceptance was rejected because it exposes a regular sawtooth
  coastline. Land uses a variably inset ownership mask while a wider,
  independently perturbed sand mask forms an irregular beach around it.
- Land triangles are derived and batched in a worker. Snapshots persist continental and country cell ownership, so Sync and reload reproduce the same map. Algorithm 11 remains able to load algorithm 9/10 maps without introducing countries until Renew. Disk and commit validation reject notes outside their country.
- Country frontiers grow only through adjacent unclaimed cells within their parent. Population plus a minimum-area allowance controls growth; every land cell belongs to exactly one country. Borders follow the exact spherical Voronoi dual, clipped to the rendered coast, without smoothing across note markers. The Country borders toggle is independent of graph Edges; smaller names appear on zoom.
- Linked root notes can receive deterministic, density-scaled island polygons
  when there is enough clearance from a continent and another island. Orphan
  notes never seed a polygon.
- A connected ocean targets 52% of the analytical render raster, plus bounded
  compensation for root-island area.
  Expansion proceeds only inward from the existing external ocean and protects
  member cells. A deterministic three-scale spherical bias varies coastal
  erosion pressure to create broad bays and headlands. This explicit visual
  invariant was chosen because one-cell sea seams are analytically connected
  but read as rivers, while an unbiased circular cap reads as a disk.
- Coast detail and terrain texture are deterministic procedural functions of
  the committed snapshot seed and sphere direction. No bitmap texture is
  shipped, fetched, or persisted, and Refresh cannot randomly redraw the map.
- The ocean is a slightly inset depth skin, while land, graticule, roads, and
  cities occupy ordered logical surface layers. This avoids z-fighting without
  changing the unit-vector layout or the visible globe radius.
- Narrow panes preserve horizontal globe framing through a derived vertical
  field of view and use a screen-area label budget. Neither behavior changes
  the camera distance, saved layout, or the user's maximum-label setting.
- **Auto rotate** is an ephemeral camera animation controlled from the bottom
  status rail. It never rotates the graph group or rewrites committed vectors,
  and any manual Arcball gesture stops it. Keeping it out of persisted settings
  makes the control immediate and prevents a reopened view from unexpectedly
  consuming continuous frames.
- The former cyberpunk direction is retired. The active style is an editorial
  scientific atlas: matte navy ocean, muted earth land colors, sand
  coastlines, irregular bays/headlands, gently mottled relief and contours,
  ivory cities, coral selection, amber routes/tags, restrained typography, and
  no additive glow.

## Follow Search

- The user explicitly approved a narrow exception to the public-API-only rule:
  read existing core Search results, without invoking or modifying its engine.
  `SearchResultsAdapter` is the only module that knows the private shape.
  Desktop Obsidian 1.14.5 source has `dom.resultDomLookup` keyed by files,
  `dom.working`, `searchQuery.query/caseSensitive`, `matchingCase`, and
  `queue.queue.items.length`. Missing/changed shapes disable the integration.
- Follow Search is per-view, opt-in and ephemeral. A workspace listener tracks
  the most recently selected Search pane; moving focus to the graph preserves
  that source. Closing the source clears highlights and waits for explicit
  selection of another Search pane. No global prototype hooks or DOM scraping.
- Poll every 250 ms while enabled. Require an idle queue, matching compiled
  query/case setting and two identical completed samples before publishing.
  Pending, cancelled or invalid queries cannot reuse stale results. Empty
  input clears immediately on the next poll. Do not redraw unchanged results.
- Copy file paths only; no file reads, indexing, match excerpts, result limit,
  stored query, layout solver or camera operation. Graph visibility filters
  still apply, and files absent from the saved map are counted but not added.
- A single-row toolbar selects Find a note or Obsidian search. Switching to
  Obsidian search reveals/creates its pane through public Workspace APIs; no
  query or search-engine method is invoked. Switching back stops following,
  clears only Search highlights and preserves the note-finder input. The
  existing focus-search command always reveals and focuses the note finder.
- Search rings and edge ribbons are separate from selection and route.
  Wine red (`#963652`) fits the atlas palette. A subtle rose-tinted halo fades
  smoothly to transparent around the thin edge stroke, without a hard casing.
  Smaller, thin rings no longer crowd note markers.
  Search fills matching node centers; selection, hover and route center colors
  take precedence, while the wine ring continues to mark Search membership.
  Selection and route strokes use the same fine width and shared halo shader.
  Route endpoint double rings retain their distinct colors at a smaller size.
  Selecting a node hides the entire ordinary-edge layer; incident ribbons,
  route and Search overlays provide the meaningful connections independently.
  The Globe Edges control persists appearance.showEdges (default true) and only
  controls ordinary edges. Selection and route overlays retain their zoom threshold.
  An edge qualifies only when both note endpoints match. Search ribbons reuse
  cached geodesic geometry and remain visible while rotating or zoomed out.
  The clear icon disables following without editing core Search. The query
  button then offers Show search results to explicitly resume following.

- Country terrain uses monotone geodesic growth around each actual allocated continent seed. The previous tangent-plane radius decreased beyond the horizon and a seed displaced by separation could draw a thin neck back toward its old preferred center; both behaviors are incompatible with readable country areas.


## Živá kartografie rendering

- The approved design JSON is bundled at build time and supplies scene roles.
  CSS carries the corresponding scoped DOM roles; a contract test guards drift.
- Relief changes normals and light only. Territory raster, geometry ownership,
  committed position buffers and layout/solver parameters are not migrated.
- Roads and borders use depth-tested clip-space ribbons in CSS pixels. City
  cores/halos use batched screen-space markers; world-space picking proxies
  follow the same centers, camera orientation and scale.
- Node center priority is selection, route endpoints, route, Search, active,
  neighbor, directory, kind. Hover affects the ring/light without replacing
  semantic center colors. Search has an independent outer ring. Roads use
  exclusive priority to prevent multiple competing cores.
- Local transitions finish in 120–180ms; reduced motion settles immediately.
  No continuous animation loop is added for light, and no bloom pass is needed.
- Keep existing Search visibility at wide zoom and all saved filters/orbit
  heights. Do not silently overwrite persisted edge opacity; only the default
  for fresh settings becomes 0.24.
- Inspector framing reserves the actual rail/sheet size using viewport/FOV,
  without rotating the camera or moving the committed map.
- Hover tooltips use the canvas owner window's timer and cancel on leave/dispose.
- The design remains a fixed dark cartographic skin within the plugin view;
  application-level themes and unrelated panes are untouched.
- Allocate city instance colours before the initial shader compilation, including
  initially empty highlight layers; native WebGL QA caught the missing attribute
  variant before first selection. Keep the regression test alongside state tests.
- Touch controls and menu sizes use view-relative container units. Native DOM QA
  covers 360/600/900/1440px, with phone/tablet CSS profiles, while physical-device
  GPU and DPR comparison remain separately identified validation limits.
- Screenshot iteration 2 restores pixel coverage outside nominal ribbons and
  city discs. Previous inward-only antialiasing consumed most subpixel ink.
  Increase city minima, road widths and coast/border contrast in token revision 2.
- The reviewed legacy map has no persisted country raster. Derive a cached,
  display-only subdivision from actual directory paths and frozen city seeds.
  Pass it separately to the decorative land worker for borders only; never feed
  it into land support, committed ownership, persistence, or the layout solver.
  Existing persisted countries remain authoritative. Tests compare original
  land, beach and coastline buffers byte-for-byte with/without this overlay.
- Use broad hypsometric/terraced fields and directional normals instead of the
  previous high-frequency pitted terrain. Shared state priorities and saved
  appearance preferences retain their meaning.
- Point-by-point iteration 3 models cut terrace walls/lips and short static
  camera-relative ledge shadows. Two extra height samples fade in with detail;
  phone detail never enables them. A static backdrop adds depth without bloom
  or an idle animation loop. All geographic and position buffers stay physical.
- Selected cities have a larger lit bead, hotspot and coral local halo; labels
  choose a side or above/below position so the marker remains the focal point.
  Selected roads become gold; wine Search membership and priority stay intact.
- Round geographic ink in a bounded angular envelope, preserve junctions and
  veto corners near cities or outside the original land. Keep the raw coast
  buffer; export a separate smoothed coast-ink buffer from the decorative worker.
  Dark geographic underlays draw before document roads and share their toggles
  and lifecycle. The smoothing does not migrate stored country ownership.
- The user asked for all visual findings, while the earlier saved-layout
  requirement remains in force: macro coast shapes, islands and city placement
  are retained. We do not invent decorative land to match the illustration.

- Iteration 4 separates continuous macro slopes, cut terraces and bounded fine
  material relief. Directional face lighting replaces uniform bright outlines.
  Country tint is a read-only geometry attribute sampled from the authoritative
  saved country raster (or the existing legacy display overlay), not new ownership.
- Ordinary road context receives a positive per-segment opacity factor based on
  locality, length and degree. No edge or segment is dropped, persisted opacity
  is retained, and selection/hover/Search/route ribbons remain full strength.
- A filled 17px coral city and 42px halo lead selection. Only its primary ring
  is reduced to 40%; wine Search keeps its independent ring/soft halo. Ordinary
  limb beads fade to 40%, while semantic highlights stay visible.
- Explicit Find/Focus uses the saved territory area centroid, not the mean of
  coastal city positions. The camera target shift is capped at 0.24 rad; regular
  select/hover does not move the camera and no committed coordinate is written.
- Progressive inspector disclosure previews four neighbors and can reveal all.
  The Open/Pin action row retains native accessible labels and pin semantics.
  Country labels receive local feathered contrast instead of broad overlays.
- Native iteration 4 QA checks all 567 visible edge records, satellite shaders,
  layer toggles, 360/600/900/1440px DOM widths and exact geography preservation.
  Actual screenshots and the remaining gap to the artistic concept are recorded
  in docs/design/2026-11-01-concepts/ITERATION_4_REVIEW.md.

- Iteration 5 implements the user's explicit approval for true low-relief display
  geometry. Intrinsic positions and saved territory remain authoritative; no
  solver runs for these changes. Raw land/beach/coast buffers remain available.
  The decorative worker returns separate raised positions, normals, elevations,
  coastal skirts and elevated geographic strokes.
- A shared TerrainSurface derives height from the same land support and seed as
  the frozen map, with stable ridges/terraces and calm city neighborhoods. The
  sampler is cached per prepared snapshot with a bounded 65,536-entry height
  cache. Cities, pins, labels, roads and satellite starts share it. Surface and
  continent toggles also update these anchors; tag orbit height is retained.
- Material hue varies independently of elevation and illumination, with three
  mineral accents per continental family. Country tones blend related hues.
  All geographic physical materials share an upper-left camera-space key.
  Static optical ocean detail and true-coast shallows replace a smooth fill.
- A cheap depth-tested screen-space HorizonGlow supplies the soft external
  atmosphere independently of the existing cloud shell. It adds no idle loop.
- Roads use deterministic, reversible intrinsic bends with an unrelated-city
  veto, and clearance checks between samples. All highlight layers reuse the
  same paths and retain their existing priorities and zoom behavior.
- Picking and DOM label visibility test the actual raised land/skirt geometry.
  Height and normal/cavity shading do not claim real-time global cast shadows.
- Persistent pin heads are violet with ivory shafts and larger physical heads;
  city colour/selection never recolours a pin. Existing pin identities remain.

- Iteration 6 uses broad domain-warped terrain with 16 finer strata, narrow
  risers and mostly flat plateaus. Refine source triangles conformingly, then
  cut at strata entry/exit levels. Plateau normals and riser face normals are
  separate. Coarse meshes use one globally consistent cut stride to avoid cracks.
- Preserve all raw buffers and committed geography. Additional material arrays
  follow the new derived vertex count and are transferred with the inline worker.
  The same height sampler still anchors cities, pins, labels and all connections.
- Build a packed triangle BVH in the land worker. Native QA found that brute-force
  occlusion was too slow on the denser mesh. The index uses exact front-face
  intersections, matches Three.js segment raycasts in tests, and is released with
  the land geometry. It adds no dependency or persisted layout data.
- Give countries stable directory-key RGB hue multipliers with similar luminance,
  rather than only selecting a lighter/darker mineral. Saved/display country
  rasters remain authoritative and unchanged.
- Suppress a node tooltip when its map label is visible, including a pending
  timer after late label placement. If map labels are disabled/clipped, retain
  a basename-only tooltip. Remove path titles from city labels. Tag tooltips,
  selection, keyboard opening and touch picking keep their existing behavior.


- Iteration 7 follows the eight concept-comparison findings. Keep 16 real strata,
  the height bound and shared anchoring; add stationary mid-frequency erosion
  rather than more geometric bands or layout changes. Refined land is built
  in the worker and uses the existing packed BVH.
- Separate terrace light and narrow directional foot shadows from contour ink.
  Restrict olive patches and enrich copper/ochre families so coherent country
  RGB multipliers remain readable without introducing unrelated saturated colours.
- Country border ink keeps its warm brightness independent of the terrain key.
  Narrow the true-coast shallow field and make the sand apron opaque in Solid
  mode. Transparent/Hidden behavior and saved geographic boundaries are preserved.
- Give the atmospheric silhouette a continuous dim baseline plus an upper-left
  highlight. Use broad elongated optical bathymetry, with expensive samples
  disabled on the phone profile. No animation, network, texture asset or dependency.
- Increase ordinary city minima/halo and limb visibility; attenuate long/hub
  context roads while retaining every relationship and all explicit highlights.
