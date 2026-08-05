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

- Top-level vault folders are the authoritative continent owners. Linked notes
  in the vault root are islands; degree-zero notes remain cities over water.
- Initialize and Renew allocate geography before the note solver runs. A fixed
  intrinsic icosphere grid has exactly one owner per land cell and `-1` for
  ocean.
- Folder area quotas scale smoothly with member count. The global target is
  48% land, leaving approximately 52% ocean without deriving a circular cap
  around a folder centroid.
- Seeds balance the existing macro layout with farthest-site separation.
  Simultaneous deterministic frontier growth prevents a large owner from
  surrounding a small one; a cell can join only from an existing same-owner
  neighbour, so every continent is connected by construction.
- Cells adjacent to foreign land remain water. Continents therefore cannot
  overlap, touch, or weave through one another, even when the vault contains
  many cross-folder links.
- The growth priority combines an anisotropic local metric, multi-frequency
  angular relief, local support, and seeded noise. This yields compact but
  non-circular regions without one-cell tendrils.
- Cities are assigned across their owner cells with deterministic
  farthest-point sampling. The solver adds a tangent return force whenever a
  movable city leaves its territory and performs a final hard projection after
  collision handling. No artificial minimum distance from the coast is used.
- Cross-folder links keep a weak spring contribution for orientation, but they
  cannot move a city onto foreign land. Relatively strong endpoints become
  ports and project to the nearest existing boundary cell on the preferred
  side; they never grow a new land bridge.
- The exact owner raster is stored in the committed snapshot. Load and Obsidian
  Sync therefore reproduce the same land allocation instead of re-detecting it
  from potentially different render timing or device performance.
- The renderer treats the raster as authoritative and applies only
  deterministic sub-cell boundary displacement. Coastlines gain coves,
  headlands, relief, and an irregular beach band without changing territory
  topology or drawing a beach ring around every city.
- Mixed surface triangles are clipped at the coast rather than admitted by
  their centroid. This preserves a smooth irregular outline independent of the
  icosphere triangulation.
- Land uses a seamless procedural relief/strata/grain material with restrained
  contour traces. Ocean uses its own lower-contrast procedural depth texture.
  Both are derived from sphere direction and the snapshot seed; the plugin
  ships no raster texture and makes no runtime request.
- Orphan notes remain visible as interactive cities over the ocean and do not
  seed land. Degree-one/two folder notes remain ordinary cities on their
  directory continent; only linked root notes receive island footprints.

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
