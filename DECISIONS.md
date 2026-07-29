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
- Initialize and Renew receive compact directory territory constraints.
  A disjoint outer folder extent is decomposed into overlapping asymmetric
  lobes with per-node centers and varied hard angular limits. This prevents a
  large folder from inheriting the circular silhouette of one uniform cap;
  land masks, coastlines, colors, and texture remain downstream render
  products.
- Same-folder springs retain full strength, cross-folder springs use 14%, and
  root-note edges use 35%. Rendering, selection, and Route Finder always use
  the original graph weights.
- Every linked note under a top-level folder is a continent member regardless
  of degree. Linked root notes are islands; all degree-zero notes stay as cities
  over open water. The degree-one/two island rule was removed because it made
  large vaults visually speckled.
- Lobe initialization uses seeded best-candidate cap samples, and equal-weight
  springs use bounded deterministic target variation. A soft intrinsic
  territory barrier prevents boundary pile-ups while the existing hard clamp
  remains a safety invariant.
- Degree-zero notes use seeded random ocean samples with local separation and
  are hard-fixed during full solves. This deliberately favors an organic ocean
  scatter over globally uniform coverage for nodes with no topology.
- Refresh continuity preserves compatible continent identity and color through
  full-path and relative-path overlap matching. Current folder names always
  determine labels.
- Mixed surface triangles are clipped at the ownership boundary; centroid-only
  triangle acceptance was rejected because it exposes a regular sawtooth
  coastline. Land uses a variably inset ownership mask while a wider,
  independently perturbed sand mask forms an irregular beach around it.
- Land triangles are derived and batched at render time; persistence stores
  semantic geography only. This keeps snapshots compact and lets themes recolor
  the atlas without moving notes. Density, watershed, and cell-ownership arrays
  are temporary analytical data and are not persisted.
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
