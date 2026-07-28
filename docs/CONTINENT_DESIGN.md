# Continental atlas design

The visual source of truth is
[`continent-atlas-concept.png`](./continent-atlas-concept.png), generated at
1536 × 1024. The implementation keeps every interactive control and label as
native DOM/Three.js content; the concept image is not shipped as application
UI.

## Product composition

- A full-height atlas canvas with the globe centered slightly left.
- A compact top rail containing `Find a note…` and the `Map` menu.
- A collapsible `Selection details` rail on the right.
- A quiet status rail at the bottom.
- The globe is the focal point: matte ocean, disjoint continents, visible sea
  gaps, small islands, restrained graticule, city-like note markers, surface
  roads, and tag satellites on an outer orbit.

## Design tokens

| Role | Token | Value |
| --- | --- | --- |
| App background | `--sg-void` | `#07131f` |
| Ocean | `--sg-ocean` | `#0c2638` |
| Raised surface | `--sg-panel-raised` | `#102332` |
| Primary text | `--sg-text` | `#edf0e8` |
| Muted text | `--sg-muted` | `#9aa9ad` |
| Border / graticule | `--sg-line` | `#516675` |
| City marker | `--sg-city` | `#f1e4c4` |
| Selection | `--sg-selection` | `#ff6b57` |
| Route | `--sg-route` | `#f1bb55` |
| Tags | `--sg-tag` | `#d49a43` |
| Coastline | `--sg-coast` | `#d4b572` |
| Land 1 | `--sg-land-1` | `#66725a` |
| Land 2 | `--sg-land-2` | `#a07a49` |
| Land 3 | `--sg-land-3` | `#8d5947` |
| Land 4 | `--sg-land-4` | `#536776` |
| Land 5 | `--sg-land-5` | `#77756c` |
| Land 6 | `--sg-land-6` | `#667f75` |

No gradients, neon colors, glow effects, holographic treatments, clipped
corners, or decorative grid overlays are part of this system.

## Typography and chrome

- UI: Obsidian's interface font, 12–14 px, medium weight, normal tracking.
- Map labels: a restrained serif stack in small caps with wider tracking.
- Controls: 34 px high, 4 px radius, 1 px low-contrast border.
- Panels are rails with separators, not nested card stacks.
- Proper SVG/Lucide icons are supplied by Obsidian's `setIcon` helper where an
  icon improves recognition.

## Geography rules

- Topology determines continents before geography is rendered.
- Communities are detected at multiple CPM resolutions and retained only when
  they are sufficiently large, cohesive, and stable. Consensus is evaluated
  per resolution before the candidate hierarchy is reconciled, so a prominent
  hub region can survive at its natural coarse scale even when a fine scale
  subdivides it.
- The ordinary automatic size threshold grows sublinearly. A lower
  large-vault threshold is reserved for exceptionally stable,
  low-conductance regions, so a compact smaller book can become a continent
  while a similarly sized sparse chain remains an archipelago.
- Cohesion combines two-hop reachability and redundant internal edges. After
  disjoint selection, a boundary note joins a continent only when at least two
  member neighbors give that continent a dominant majority of local link
  weight.
- Selected continents are a disjoint partition subset; rejected nodes remain
  islands rather than being forced into landmasses.
- Initialize/Renew first complete the ordinary deterministic full-sphere
  layout. Refresh preserves its bounded fixed-position behavior. Geography is
  derived only afterward and never reserves caps, applies a force, or moves a
  note.
- Every degree-three-or-higher continent city supports a local land kernel and
  short internal roads support narrow corridors. Unsupported areas remain sea;
  links longer than the corridor limit cannot manufacture a trans-oceanic land
  bridge.
- Continent positions act as semantic territory sites. A closer competing
  continent site carves sea from another region, and a dominance margin leaves
  sea where two continent support fields compete. A lone free note cannot
  create a lake; free notes carve only as a locally linked, spatially coherent
  group. A surface cell therefore has at most one land owner.
- Coast variation is deterministic and multi-scale. It perturbs the union of
  city and short-road support rather than a center-radius silhouette, allowing
  concave shores, gulfs, and separated lobes while retaining organic edges.
- Mixed surface triangles are clipped at the coast rather than admitted by
  their centroid. This preserves a smooth irregular outline independent of the
  icosphere triangulation.
- Land uses a seamless procedural relief/strata/grain material with restrained
  contour traces. Ocean uses its own lower-contrast procedural depth texture.
  Both are derived from sphere direction and the snapshot seed; the plugin
  ships no raster texture and makes no runtime request.
- Orphan notes remain visible as interactive cities over the ocean and do not
  seed land. Degree-one/two notes can become spatially separated islands;
  footprints shrink with vault density and avoid supported continent territory.
  After land ownership is reconciled, the already connected external ocean
  retreats weak coasts until it occupies 34–46% of the render raster. This
  creates readable seas without inland holes or any node movement.

## Core interaction

`Open graph → inspect the generated world → open Map → toggle Continents →
select a city or tag → inspect Selection details → optionally run Refresh or
Renew.`

## Allowed first-viewport copy

- `Find a note…`
- `Map`
- `Selection details`
- Existing action/filter/surface labels inside the open Map menu
- Existing note, tag, route, and status strings
- A status count ending in `continents`

No marketing headline, badge, fake metric, or unrelated navigation is added to
the graph view.
