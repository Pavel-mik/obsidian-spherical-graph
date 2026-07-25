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
