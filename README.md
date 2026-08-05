# Spherical Graph

[![CI](https://github.com/Pavel-mik/obsidian-spherical-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/Pavel-mik/obsidian-spherical-graph/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Pavel-mik/obsidian-spherical-graph?label=release)](https://github.com/Pavel-mik/obsidian-spherical-graph/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)

Turn your Obsidian vault into an explorable world. Each top-level vault folder
becomes its own continent, notes become cities, links become roads across the
surface, and tags orbit overhead as satellites. Linked notes stored directly
in the vault root become islands; orphan notes remain cities over open water.
The cartography reserves approximately half the globe for ocean. A
territory-first spherical allocator gives every folder one connected,
non-overlapping landmass before cities are relaxed, so even densely
cross-linked vaults cannot pull continents into interwoven ribbons. Route
Finder reveals every shortest path between distant notes.

Spherical Graph is designed as a stable spatial map: a finite layout operation
computes positions, validates and saves one complete snapshot, and then stops.
Normal reading, search, filtering, selection, rotation, zoom, theme changes,
and resizing do not move notes.

Initialize and Renew first grow deterministic folder territories on an
intrinsic icosphere raster. Area quotas follow folder size, simultaneous growth
keeps every region connected, and a permanent water buffer separates different
owners. Cities are then seeded across their own land with an irregular
blue-noise distribution and relaxed without crossing the fixed coast. Sparse
graph-distance stress arranges internal roads, while cross-folder links mostly
influence macro orientation and relative coastal-port placement. The renderer
adds multi-scale shoreline detail and beaches to that committed raster; it no
longer invents corridors between cities after layout.

## See your vault as a world

![Spherical Graph globe with note cities and tag satellites](docs/screenshots/spherical-graph-globe.png)

![Route Finder highlighting shortest paths across the globe](docs/screenshots/spherical-graph-route.png)

![Compact graph controls with render-only filters](docs/screenshots/spherical-graph-filters.png)

## Requirements

- Obsidian 1.7.2 or later.
- Desktop app. The renderer, worker lifecycle, and resource profile are not
  supported on mobile.
- No account, API key, internet connection, or paid service is required.

## Why a sphere?

This is not a conventional 3D force graph with important notes near the center
and other notes floating in a volume. Every node is represented internally by
a unit vector \(u \in S^2\), and its rendered point is \(R u\). The solver uses
geodesic angular distance, tangent-plane forces, and exponential-map updates
directly on the sphere. Edges are sampled as shortest geodesic arcs on the
surface rather than drawn as straight chords through the globe.

The result has no left/right map seam. Notes near longitudes \(+180^\circ\) and
\(-180^\circ\) are genuinely close because longitude is not a layout
coordinate.

## Fixed-layout lifecycle

Spherical Graph has three finite layout operations:

- **Initialize** runs only after an explicit **Generate/Renew layout** action.
  Opening Obsidian or the graph view first loads the last saved map and never
  scans or regenerates the vault automatically.
- **Refresh layout** incorporates pending vault changes while preserving the
  existing mental map. New nodes warm up while old nodes are fixed; then only a
  local affected set may relax under geodesic anchors and a maximum angular
  displacement. It is also the explicit way to scan for changes made while
  Obsidian was closed; when topology is unchanged, metadata is refreshed and
  no layout operation starts.
- **Renew layout** is an explicit, confirmed, whole-map regeneration. It uses a
  new deterministic effective seed and does not use old positions as anchors.

While Refresh or Renew runs, the last committed map remains visible and
interactive. Progress messages contain diagnostics only. The renderer receives
new coordinates once, after the complete result passes operation-ID, graph
signature, length, finiteness, unit-norm, and Refresh-displacement checks. A
validated final buffer becomes immutable input to the post-layout geographic
analysis before the complete snapshot is saved atomically. A cancelled, stale,
invalid, or failed operation leaves the previous snapshot untouched.

Vault changes never start a solver automatically. Instead the view reports a
pending state such as:

```text
Changes detected · +7 / -2 notes · 11 link changes
```

New notes without committed positions remain pending; deleted notes disappear;
and a reliable rename keeps the old position under the new path. Select
**Refresh layout** when you want to incorporate the pending graph.

## Features

- Dedicated `Spherical Graph` ItemView, ribbon action, and command-palette
  commands.
- Intrinsic, seam-free spherical layout with deterministic exact and sampled
  repulsion modes.
- Territory-first Initialize/Renew placement directly on \(S^2\): every
  non-orphan top-level folder receives a connected irregular raster region,
  different owners remain separated by sea, and approximately 52% of the
  surface remains ocean.
- Cities use deterministic farthest-point/blue-noise seeding across their
  territory. Internal links retain full spring weight; cross-folder links are
  reduced to a weak macro/port influence and cannot manufacture land arms.
- Bounded graph-distance landmark stress breaks hub rings, while a final
  marker-aware S² collision projection prevents visible node overlap without
  moving hard-fixed Refresh nodes.
- Relatively strong, directionally coherent inter-continent endpoints become
  port cities and can reach the coastline on the side of their strongest roads.
- Post-layout cartography consumes the committed owner raster directly and
  only adds sub-cell coast detail, relief, beaches, and root-note islands.
- Degree-zero notes stay as cities over water. Degree-one/two folder notes
  remain on their continent; only linked root notes receive island patches.
- Membership matching preserves stable continent identity and color across
  compatible Refreshes and multi-note top-level folder renames.
- Incremental Refresh with a new-node warm-up, graph-neighborhood affected set,
  hard-fixed remote nodes, anchors, and a displacement cap.
- Transactional committed snapshot, schema migrations, stable camera state,
  saved graph metadata, exact continent territory raster, tags, auxiliary nodes, pins, and safe
  rename/prune handling. The complete `data.json` map can be carried by
  Obsidian Sync and restored with **Load map** without a vault scan.
- Short-lived inline Web Workers isolate layout solving, live-vault graph
  indexing, post-layout continental analysis, and detailed land meshing from
  Obsidian's UI thread. Large maps use an adaptive land-detail ceiling.
- Three.js rendering with a matte ocean, batched topology-derived land,
  deterministic organic coastlines supported by actual member cities and
  short internal roads, an irregular sand beach band, sea carved by neighboring
  regions, islands, cartographic region labels, instanced tangent city markers,
  batched geodesic roads, a restrained dashed graticule, smoothly fading
  labels, responsive narrow-pane framing, and invalidation-based frames.
- Hover details, selection, linked-neighbor and same-subfolder emphasis,
  active-note emphasis,
  search/focus, open-note actions, camera reset, keyboard controls, and a
  translucent selection panel with clickable direct neighbors.
- A persistent **Auto rotate** switch in the bottom rail starts or stops a
  slow camera orbit. Manual camera interaction pauses it and resumes it three
  seconds after the last adjustment without clearing the switch.
- A procedural cloud atmosphere appears only at wider zoom levels while Auto
  rotate is enabled. The cloud-only shell has an irregular limb, rotates once
  every ten minutes relative to the globe, and can be hidden independently.
- Persistent map pins mark favourite note cities. Pins, the committed layout,
  camera, and settings share one versioned plugin-data envelope with automatic
  and explicit **Save map** persistence.
- A control-free **Fullscreen** presentation mode forces atmosphere and Auto
  rotate on temporarily, then restores the previous rotation state on exit.
- Searchable excluded-folder picker in settings. Selecting a folder excludes
  its entire subtree after an explicit Refresh without moving the current map
  immediately.
- Offline route finding that highlights every shortest path between two notes
  over the existing links, including all equally short alternatives, explicit
  `Start` and `Dest` markers, and clickable route details.
- Intrinsically packed, polished-silver tag satellites on an adjustable,
  invisible concentric orbit. Their size and contrast recede with perspective,
  and their positions are anchored to the final locations of the notes that
  carry them.
  Thin silver spherical spirals connect tags to the selected note, every note
  in the active shortest-path union, or every note carrying a selected tag.
  Satellites and link segments hidden behind the globe are culled geometrically.
- Configurable zoom thresholds independently reveal labels and roads only when
  the camera is close enough, reducing clutter in large vaults.
- Solid, transparent, and hidden sphere-surface modes.
- Render-only visibility filters for tags, attachments, unresolved links, and
  orphan notes. Filters hide markers and incident links without moving the map.
- Theme-aware colors, resize handling, pop-out owner-window awareness, and
  explicit resource cleanup.
- No telemetry, runtime network calls, external keys, or note-content writes.

## Controls

| Action | Control |
| --- | --- |
| Rotate | Drag empty canvas space |
| Start or stop automatic rotation | Toggle **Auto rotate** in the bottom status rail |
| Zoom | Wheel or supported pinch gesture |
| Inspect | Hover a node |
| Select | Click a node |
| Pin or unpin a favourite city | Select a note, then use **Pin note** / **Unpin note** in Selection details |
| Select a tag and show its links | Click a silver tag satellite |
| Clear selection | Click empty canvas space or press `Escape` |
| Open note | Double-click a node or press `Enter` on a selected search result |
| Open in new tab | `Ctrl`/`Cmd` + click |
| Open from selection details | Click a selected, linked, endpoint, or route note; hold `Ctrl`/`Cmd` for a new tab |
| Hide or show selection details | Select the **Selection details** header |
| Find and focus | Type in **Find a note or tag…** and choose a result |
| Find all shortest routes | Select an origin, open **Map**, choose **Find route**, then select a destination |
| Clear a route | Choose **Clear route** in **Map** |
| Hide categories without moving the map | Use **Filters** in **Map** |
| Hide or show geography | Toggle **Continents** in **Map → Appearance** |
| Hide or show the cloud layer | Toggle **Atmosphere** in **Map → Appearance** |
| Save the complete map state now | Choose **Save map** in **Map** |
| Reload the last saved or synced map | Choose **Load map** in **Map** |
| Enter the control-free presentation globe | Choose **Fullscreen** in **Map**; press `Escape` to exit |
| Change globe surface | Use **Appearance** in **Map** |
| Include pending changes | Choose **Refresh layout** in **Map** |
| Build a new world | Choose **Renew layout** in **Map**, then confirm |
| Stop a calculation | Choose **Cancel calculation** in **Map** |
| Restore view | Choose **Reset camera** in **Map** |

Manual or automatic rotation changes only the camera and never a node position.

## Settings

### Data

- searchable excluded-folder picker with subtree semantics and removable paths
- graph-change debounce
- pending-diff detail limit

### Appearance

- relative **Globe size** and degree scaling; a larger Globe value makes city
  markers and the coral selection frame smaller without moving the layout.
  Initialize and Renew automatically choose this value from the vault's note
  count; Refresh preserves the current value
- tag-orbit height as a percentage of the globe radius (one third by default),
  plus an optional camera-axis protection guard, disabled by default
- edge opacity and an independent zoom-in visibility threshold (50% by
  default)
- labels, maximum pooled labels, and a zoom-in threshold (80% by default);
  note and tag labels fade and scale smoothly around that threshold
- continent, coastline, island, cartographic-label, and atmosphere visibility;
  atmosphere height is expressed as a percentage of the globe radius
- sphere surface mode and opacity
- theme-following background
- focus-animation duration

### Layout

- deterministic base seed
- spring, repulsion, centroid, and isotropy strengths
- damping, step, angular-speed cap, convergence, and iteration budget
- exact-repulsion threshold and sampled negative count
- progress-report interval

### Refresh preservation

- new-node warm-up budget
- affected graph-neighborhood depth
- anchor strength and directly affected multiplier
- maximum old-node angular displacement
- large-change warning ratio

Visual settings apply without running a solver. The graph-menu filters for
tags, attachments, unresolved links, and orphan notes are also render-only.
Data exclusions can create pending changes. Layout settings apply to the next
relevant explicit operation; changing them alone does not move the current
map.

## Saving and Obsidian Sync

Completed layouts are saved automatically. Camera changes and settings are
debounced; pin changes are committed immediately. **Map → Save map** flushes
the current camera, settings, and pins into the same complete state on demand.

The only authoritative state file is Obsidian's standard
`.obsidian/plugins/spherical-graph/data.json`. To carry the same layout and
pins between devices, enable community-plugin data in
[Obsidian Sync settings](https://obsidian.md/help/sync/settings) for the vault.
No extra file is written into the vault root. If Sync updates plugin data while
Obsidian is already running, reload the plugin or restart Obsidian before
judging the restored map.

## Installation

After publication, install **Spherical Graph** from **Settings → Community
plugins → Browse**.

For a manual or beta installation:

1. Build the plugin or download a release.
2. Place these files directly in
   `<vault>/.obsidian/plugins/spherical-graph/`:

   - `main.js`
   - `manifest.json`
   - `styles.css`

3. Restart or reload Obsidian after the first install or an ID/manifest change.
4. Open **Settings → Community plugins**, enable **Spherical Graph**, and run
   **Spherical Graph: Open graph** from the command palette.

Do not create an extra nested repository directory; `manifest.json` must be
directly inside `.obsidian/plugins/spherical-graph/`.

## Development

Use a dedicated disposable development vault.

```powershell
npm ci
npm run dev
```

Quality and utility commands:

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run validate:release
npm run check
npm run benchmark:layout
npm run generate:test-vault -- --output ./tmp/test-vault --nodes 500 --edges 1500 --seed 42 --pattern clustered

# Stress continent allocation with many root folders and cross-folder roads
npm run generate:test-vault -- --output ./tmp/territory-vault --nodes 480 --edges 2800 --seed 20260805 --pattern territories --folders 24
```

The production build writes the release artifacts to the repository root. The
layout worker source is embedded into `main.js`; no separate worker file is
required.

See [ARCHITECTURE.md](ARCHITECTURE.md), [ALGORITHM.md](ALGORITHM.md),
[MANUAL_TEST_PLAN.md](MANUAL_TEST_PLAN.md), and [VALIDATION.md](VALIDATION.md).
The complete implementation specification is preserved in
[docs/CODEX_TASK.md](docs/CODEX_TASK.md).

## Privacy and safety

Spherical Graph is designed for private, offline vault use:

- It reads Markdown file metadata, tags, and Obsidian's resolved-link index.
- It never modifies note contents and never accesses files outside the vault.
- It stores plugin settings, vault-relative note paths, normalized layout
  positions, graph descriptors, post-layout continent membership, diagnostic
  centers/extents, camera state, and pinned-note paths through Obsidian's
  plugin-data API. Tag satellites, atmosphere clouds, and analytical
  spherical-grid cells are derived at runtime and are not persisted.
- It performs no runtime network requests, telemetry, remote-code loading,
  advertising, or automatic plugin updates.
- It requires no account, payment, external key, or remote service.

## Support and security

- Report bugs and request features through
  [GitHub Issues](https://github.com/Pavel-mik/obsidian-spherical-graph/issues).
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.
- Report security problems using the private process in
  [SECURITY.md](SECURITY.md), not a public issue.

## Known limitations

- Desktop only; mobile interaction and resource behavior are not validated.
- Arbitrary non-planar graphs can still have crossing edges on a sphere.
- Labels are intentionally capped and fade with zoom, so not every visible
  note is labelled at every camera distance. Narrow panes can lower the
  on-screen label budget further without changing the configured maximum.
- Every tag has an instanced satellite marker, while visible tag text labels
  are capped at 96. Tags behind the globe are hidden; optional camera-axis
  fading can additionally protect the center of the view.
- Route highlighting shows the union of all shortest paths. When alternatives
  overlap, their shared sections are intentionally drawn once.
- Very large graphs use deterministic sampled global repulsion; this is an
  approximation rather than exact all-pairs force evaluation.
- The plugin stores one committed layout snapshot and has no layout undo
  history, edge bundling, overlapping/fuzzy continent membership, manual
  country editing, ghost nodes, or image export.
- Actual GUI verification performed for a release is recorded in
  [VALIDATION.md](VALIDATION.md); automated checks do not imply a manual GUI
  pass.

## Release

1. Run `npm ci` and `npm run check` from a clean checkout.
2. Update `manifest.json`, `package.json`, `versions.json`, and
   [CHANGELOG.md](CHANGELOG.md).
3. Push a tag exactly equal to the manifest version, without a leading `v`.
   The release workflow repeats the full check, verifies the tag/version,
   attests the build, and creates a draft release containing `main.js`,
   `manifest.json`, and `styles.css`.
4. Review and publish the draft GitHub release.
5. For the first directory submission, make the repository public, link GitHub
   at [community.obsidian.md](https://community.obsidian.md), choose
   **Plugins → New plugin**, and submit the repository URL.

The complete maintainer procedure is in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## License

[MIT](LICENSE). Third-party attributions are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
