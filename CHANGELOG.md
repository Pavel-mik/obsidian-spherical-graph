# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.1.0...HEAD
[1.1.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/Pavel-mik/obsidian-spherical-graph/releases/tag/1.0.0
