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

- Geography has a strict one-way dependency on the committed layout. Initialize
  and Renew first run the ordinary deterministic full-sphere solver; Refresh
  first completes its bounded positional update. Only after the final position
  buffer is validated and fixed may the atlas pipeline inspect it.
- Geographic state never enters initialization, the worker payload, force
  evaluation, integration, or displacement constraints. Pre-layout continent
  caps were rejected because they produced circular, self-confirming regions
  and could pull semantically related but spatially distant notes into the
  wrong landmass.
- Post-layout analysis samples the fixed note positions on an intrinsic
  subdivided-icosahedron grid. Grid resolution and compact fine/coarse density
  kernels adapt to measured global and local note spacing instead of assuming
  one continent radius.
- Deterministic multiresolution CPM consensus, conductance, compactness, and
  stability remain useful as a **soft prior**. The prior can support a spatial
  basin or make a watershed merge slightly more permissive, but it can never
  move a note, override final surface ownership, or turn a geographically
  disconnected footprint into one continent.
- Density-gradient watershed basins are reconciled at their saddles. Final
  surface ownership is exclusive, neighboring continent owners are separated
  by explicit sea cells, and ocean reconciliation preserves one connected
  ocean component rather than overlapping translucent landmasses.
- Continent acceptance combines spatial size and prominence with optional graph
  support. Final membership comes from the owning grid cell at each fixed note
  position. Only degree-three-or-higher notes can support or join continental
  land; degree-one/two notes are island candidates, while orphan notes stay as
  cities over open water. This prevents sparse graph appendices from inflating
  a landmass while keeping every note interactive.
- Refresh continuity preserves matched continent identity, label, and color
  through deterministic overlap matching. Centers and diagnostic extents are
  always rederived from the current fixed positions; a persisted extent is
  descriptive metadata, never a layout or rendering constraint.
- Mixed surface triangles are clipped at the ownership boundary; centroid-only
  triangle acceptance was rejected because it exposes a regular sawtooth
  coastline. Land uses a variably inset ownership mask while a wider,
  independently perturbed sand mask forms an irregular beach around it.
- Land triangles are derived and batched at render time; persistence stores
  semantic geography only. This keeps snapshots compact and lets themes recolor
  the atlas without moving notes. Density, watershed, and cell-ownership arrays
  are temporary analytical data and are not persisted.
- Degree-one/two notes can receive deterministic, density-scaled island
  polygons when there is enough clearance from a continent and another island.
  Orphan notes never seed a polygon. A hard representative budget was rejected
  because it hid useful sparse islands; geometric clearance and decreasing
  radius bound overlap without turning the ocean into confetti.
- A connected ocean must occupy at least 34% of the analytical render raster,
  increasing by 2.5 percentage points per additional continent up to 46%.
  Expansion proceeds only inward from the existing external ocean and protects
  member cells. This explicit visual invariant was chosen because one-cell sea
  seams are analytically connected but read as rivers rather than oceans.
- Coast detail and terrain texture are deterministic procedural functions of
  the committed snapshot seed and sphere direction. No bitmap texture is
  shipped, fetched, or persisted, and Refresh cannot randomly redraw the map.
- The ocean is a slightly inset depth skin, while land, graticule, roads, and
  cities occupy ordered logical surface layers. This avoids z-fighting without
  changing the unit-vector layout or the visible globe radius.
- Narrow panes preserve horizontal globe framing through a derived vertical
  field of view and use a screen-area label budget. Neither behavior changes
  the camera distance, saved layout, or the user's maximum-label setting.
- The former cyberpunk direction is retired. The active style is an editorial
  scientific atlas: matte navy ocean, muted earth land colors, sand
  coastlines, irregular bays/headlands, gently mottled relief and contours,
  ivory cities, coral selection, amber routes/tags, restrained typography, and
  no additive glow.
