# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.0] - 2026-07-29

### Added

- Every non-orphan top-level vault folder now owns one deterministic continent.
  Notes in that folder remain inside its intrinsic spherical territory, while
  cross-folder links weakly pull only their endpoints toward useful ports.
- Linked notes stored directly in the vault root become standalone islands.
  Orphan notes anywhere remain interactive cities over open water and never
  manufacture land.
- Selecting a note now adds a restrained secondary highlight to notes in the
  same first-two-level directory region while preserving the existing selected,
  linked-neighbor, active-note, and Route Finder visual states.
- Settings now provide a searchable vault-folder picker with subtree exclusion,
  removable path chips, and preservation of missing legacy paths.

### Changed

- Initialize and Renew use a deterministic directory-aware S² initialization.
  Same-folder edges keep full spring weight, cross-folder edges are reduced, and
  hard geodesic territory boundaries prevent continental overlap.
- The connected external ocean now targets approximately 50% of the spherical
  raster, with deterministic compensation for the visible area of root-note
  islands.
- Degree-one and degree-two notes inside a folder are ordinary continent
  members. The previous rule that converted them into individual islands was
  removed.
- A cross-folder single-note move is treated as a semantic relocation during
  Refresh. Multi-note folder renames retain the previous map and geography
  identity through deterministic membership matching.

### Notes

- The layout algorithm version is now 4. Older committed layouts receive one
  automatic Initialize so directory territories and the new ocean budget are
  applied. The resulting layout is fixed again after that completed operation.

## [1.3.1] - 2026-07-28

### Changed

- Continental density, watershed population, and land support now use only
  notes with at least three links. Orphan notes remain interactive cities over
  water, while degree-one/two notes are eligible for separate island patches.
- The renderer deterministically expands only the already connected external
  ocean to a 34–46% coverage floor, widening river-like seams into readable
  seas while protecting continent-member cells.
- Legacy 1.3.0 geography receives the new degree-aware rendering immediately;
  existing committed node positions do not need to be regenerated or moved.

### Fixed

- Large, saturated vaults no longer allow continent support to cover nearly the
  entire globe with only one-cell channels between landmasses.
- Orphan and weakly linked notes no longer inflate continental density or close
  the visual ocean, and orphan notes no longer create unnecessary land patches.
- Connected-ocean expansion cannot manufacture inland lakes because it advances
  exclusively from the existing external sea.

## [1.3.0] - 2026-07-28

### Added

- Post-layout cartography on an intrinsic icosphere: locally adaptive
  fine/coarse density, deterministic watershed basins, exclusive spatial
  ownership, and one explicit connected ocean.
- Spatial continent recovery that can recognize a visually coherent dense
  region without graph-community support, split one graph community across
  distant landmasses, and retain unrelated notes as islands.
- Regression coverage for multi-cluster large vaults, conflicting soft priors,
  uniform backgrounds, connected ocean, deterministic ownership, and
  bit-for-bit preservation of completed node positions.

### Changed

- Initialize and Renew once again use the ordinary deterministic full-sphere
  layout. Continents no longer choose initial positions, apply forces, reserve
  circular caps, or clamp solver output.
- Graph communities are now only a soft marker prior over the finished map.
  Spatial density and visible separation decide final geography.
- Land rendering uses bounded adaptive density over fixed note positions,
  ignores long or structurally suspicious bridge roads, and derives the beach
  inset from signed distance to the connected external ocean.
- Artificial shelf islands were removed. Small irregularity is confined to the
  coastline band so interiors remain continuous.

### Fixed

- Dense but visually separate communities can no longer be transitively merged
  through a chain of small unsupported watershed basins.
- A wide watershed basin no longer claims every note in it. Only a supported
  core seeds land; dispersed notes join a continent only when they actually lie
  in its connected spatial mask.
- Conflicting graph priors no longer split one obvious spatial landmass, while
  distant clusters remain separated by ocean.
- Circular, self-confirming continents, unsupported cross-ocean land bridges,
  and accidental inland beach/lake holes are removed.

### Notes

- The layout algorithm version is now 3. A version-2 committed snapshot is
  treated as obsolete and is replaced by one automatic Initialize when the
  plugin first opens after updating. Later browsing remains fixed as before.
- The analytical grid, density field, watershed, and cell ownership are
  temporary; persisted snapshots retain only fixed positions and compact
  semantic geography.

## [1.2.5] - 2026-07-28

### Added

- Search now finds tags as well as notes, and Selection details lists linked
  tags alongside linked notes.
- Continents receive a textured sand-beach underlay and detailed coastline.

### Changed

- **Solid** now writes a fully opaque globe depth surface so cities and tags on
  the far side cannot show through.
- Tag labels and links respect solid-globe occlusion.

## [1.2.4] - 2026-07-28

### Fixed

- Prominent hub-and-spoke and core/periphery communities are no longer lost
  because one global consensus mixed coarse and fine CPM resolutions. Candidate
  regions are now formed per resolution before hierarchical reconciliation.
- Clearly affiliated boundary notes are added to a selected continent when at
  least two internal neighbors provide a dominant majority of their local link
  weight. This prevents otherwise coherent communities from being represented
  only partially.
- A single unassigned note embedded in supported land no longer cuts an
  isolated lake or bay. Competing accepted continents still carve sea, while
  free notes must form a locally connected, spatially coherent group before
  they can exclude land.
- A topology-cohesion gate continues to reject long sparse chains even at the
  new coarse detection scale.

### Notes

- Existing committed layouts remain fixed after updating. Use **Renew layout**
  to apply the revised continent detection and membership. The isolated-lake
  rendering correction applies immediately.

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

[Unreleased]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.4.0...HEAD
[1.4.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.3.1...1.4.0
[1.3.1]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.3.0...1.3.1
[1.3.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.5...1.3.0
[1.2.5]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.4...1.2.5
[1.2.4]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.3...1.2.4
[1.2.3]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.2...1.2.3
[1.2.2]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.1...1.2.2
[1.2.1]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.2.0...1.2.1
[1.2.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/releases/tag/1.0.0
