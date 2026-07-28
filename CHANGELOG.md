# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.3] - 2026-07-28

### Fixed

- Continent coastlines now follow the actual member cities and their short
  internal roads instead of filling one broad radial cap around the persisted
  continent center.
- Empty gaps and neighboring foreign or island cities carve visible sea from a
  landmass, while every accepted member city seeds its own land support.
- Long internal links no longer create implausible land bridges across open
  water. The new render-only territory calculation preserves all committed
  node positions and applies immediately without **Renew layout**.

## [1.2.2] - 2026-07-27

### Fixed

- Large vaults no longer discard compact, unmistakable regions solely because
  they contain fewer than 24 notes. The automatic detector now uses a
  sublinear ordinary size threshold and a lower rescue threshold reserved for
  exceptionally stable communities with very few outward links.
- Sparse chains and loose archipelagos remain islands, explicit detection
  minimums remain absolute, and the seven-continent cap is unchanged.

### Notes

- Existing committed layouts remain fixed after updating. Use **Renew layout**
  to classify and place continents with the revised detector.

## [1.2.1] - 2026-07-27

### Fixed

- Large vaults no longer turn every note outside an accepted continent into a
  full land patch. The renderer now draws a deterministic, density-aware,
  spatially separated sample of at most 24 representative islands while all
  remaining notes stay visible as cities over open water.
- Representative islands shrink as vault size grows, avoid continent
  coastlines, and inherit the nearest continent palette, preserving readable
  oceans and coherent geography without changing layout, picking, routes, or
  persisted continent membership.

## [1.2.0] - 2026-07-27

### Added

- Topology-derived continents using deterministic multiresolution CPM
  consensus, stability and conductance filtering, disjoint selection, and
  explicit island nodes.
- Continent-aware Initialize/Renew placement, Refresh geography matching,
  compact worker constraints, and persisted semantic geography.
- Batched organic land, coastlines, islands, cartographic labels, a continent
  count in the status rail, and a render-only **Map → Continents** toggle.

### Changed

- Replaced the retired cyberpunk presentation with a restrained editorial
  atlas palette and removed additive selection/road glow.
- The toolbar disclosure is now named **Map**, and graph roads, graticule,
  ocean, land, coastlines, cities, routes, and tag satellites have deliberately
  distinct visual roles.
- Continents now use clipped multi-scale coast profiles with localized bays and
  headlands, irregular shelf islands, and offline procedural terrain, strata,
  and grain. The ocean has a separate subtle procedural depth texture.
- Narrow panes preserve the globe's horizontal framing and apply a
  viewport-area label budget below the user's `maxLabels` ceiling.

### Fixed

- Separated the ocean depth skin from the logical land/road surface and
  tightened the camera clipping range, preventing continent triangles from
  flickering or breaking into false holes on lower-precision depth buffers.
- Clipped mixed land/sea triangles at their computed ownership boundary,
  removing the regular polygon teeth produced by centroid-only classification.

## [1.1.0] - 2026-07-27

### Added

- Render-only graph filters for tags, attachments, unresolved links, and
  orphan notes. Toggling a filter never recalculates or moves the saved layout.
- Attachment and unresolved-link markers derived from their connected notes.

### Changed

- Note and tag labels now fade and scale smoothly with camera zoom.
- The compact top bar now keeps note search visible while grouping actions,
  filters, and appearance controls in an accessible dropdown menu.
- Tag satellites are intrinsically packed around directions derived from their
  linked notes. A tag unique to one note therefore orbits above that note
  instead of appearing on an unrelated hemisphere.
- Community-facing copy now presents the graph as a globe of cities, roads,
  and tag satellites, with Route Finder as a core navigation feature.

### Fixed

- Hidden categories and all incident links are consistently excluded from
  picking, labels, selection emphasis, and route searches.

## [1.0.0] - 2026-07-24

### Added

- Desktop Spherical Graph view, ribbon action, command-palette actions, search,
  settings, camera reset, clickable details, and fixed-layout status.
- Intrinsic seam-free spherical layout with deterministic Initialize, Refresh,
  and Renew transactions.
- Incremental Refresh with new-node warm-up, affected-neighborhood relaxation,
  anchors, and a maximum old-node displacement.
- Transactional persistence, migrations, stable camera state, rename handling,
  validation, cancellation, and a short-lived inline layout worker with a
  yielding compatibility fallback.
- Three.js rendering with tangent node discs, batched geodesic links, muted
  dashed graticule, label pooling, zoom thresholds, picking, and explicit
  resource cleanup.
- Distinct magenta selection links, acid-green all-shortest-route navigation,
  and green/amber route endpoint markers.
- Responsive, collapsible Selection details with active note links for node,
  route, and tag selections.
- Deterministic render-only tag satellites on an invisible concentric orbit,
  geometric globe occlusion, tag selection, spiral links, and an on-screen
  Tags toggle.
- Relative Globe size with automatic Initialize/Renew sizing and a configurable
  tag orbit height expressed as a percentage of globe radius.
- Synthetic test-vault generator, layout benchmark, complete automated test
  suite, CI, release validation, build attestations, architecture notes, and
  manual validation documentation.

### Security

- No telemetry, advertisements, runtime network calls, account requirement,
  remote code loading, external-file access, or note-content writes.

[Unreleased]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.0...HEAD
[1.2.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/releases/tag/1.0.0
