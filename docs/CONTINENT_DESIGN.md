# Continental atlas design

The current appearance is the sculpted **Živá kartografie** direction:
[full specification](design/2026-11-01-concepts/ZIVA_KARTOGRAFIE_SPEC.md),
[shared tokens](design/2026-11-01-concepts/ziva-kartografie.tokens.json), and
[visual reference](design/2026-11-01-concepts/03-ziva-kartografie.png).
The original continent-atlas-concept.png remains a historical design reference.
All interactive UI is native DOM/Three.js content.

## Product composition

- Full-height atlas canvas with room reserved for the open inspector.
- Compact search toolbar and Map controls menu.
- Collapsible selection details and a quiet status rail.
- True spherical geography, separate continents and sea gaps, small note
  cities, geodesic roads, countries and tag satellites on the existing orbit.

## Appearance

The approved JSON defines the exact colors, CSS-pixel widths, local halo
intensities, UI spacing, typography and state priorities. The globe has matte
petrol water and earthy ochre, jade, terracotta, slate, sage and rose land,
with two additional land families available. Continent color indexes remain
stable. The relief is procedural optical shading, with no terrain displacement
or changes to the ownership raster.

Ordinary cities use warm ivory, selection coral, routes amber, Search wine,
and tag satellites silver. Hover retains semantic center colors. Search
membership remains an independent outer ring; there are at most two state
rings on a city. Each road draws a single semantic core, ordered route,
selection, Search, hover, ordinary.

Use the native interface font for UI, and restrained serif cartographic
labels. Controls are 36px high on desktop, 44px on touch, with 6px corners.
Panels use 8px corners and quiet separators. Local alpha halos are permitted;
global bloom, neon chrome, decorative grids and continuous pulsing are not.

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
- Legacy snapshots without country ownership may derive a display-only
  subdivision from real directory paths and frozen city positions. This cached
  overlay is clipped to the original land and sent to the decorative worker
  separately. It never changes the saved continent raster, land support, coast,
  city positions or layout lifecycle. Persisted country rasters take precedence.
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

The approved iteration 5 appearance adds radial display-only terrain height.
Stored city directions on S², continent/country ownership and layout lifecycle
remain unchanged. Derived physical geometry is documented in specification
section 29 and the shared TerrainSurface. Node/road/pin/label/satellite anchors
follow that height; ordinary UI actions never invoke a layout solve.

- `Find a note…`
- `Map`
- `Selection details`
- Existing action/filter/surface labels inside the open Map menu
- Existing note, tag, route, and status strings
- A status count ending in `continents`

No marketing headline, badge, fake metric, or unrelated navigation is added to
the graph view.
