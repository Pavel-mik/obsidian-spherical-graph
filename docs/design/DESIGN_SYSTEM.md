# Spherical Graph design system

The active visual direction is **Živá kartografie** (sculpted cartography),
implemented from [the approved specification](2026-11-01-concepts/ZIVA_KARTOGRAFIE_SPEC.md)
and [its shared tokens](2026-11-01-concepts/ziva-kartografie.tokens.json).
[Concept 3](2026-11-01-concepts/03-ziva-kartografie.png) is the artistic reference.
See the [implementation and verification report](2026-11-01-concepts/IMPLEMENTATION_REPORT.md)
for native Obsidian checks and physical-device validation limits.
The current point-by-point refinement is documented in
[iteration 7 review](2026-11-01-concepts/ITERATION_7_REVIEW.md), with native screenshots.

Use matte mineral land, optical terraced relief, a deep petrol ocean, fine
sand coastlines, warm ivory cities, coral selection, amber routes, wine Search
membership and silver tag satellites. Local depth-tested alpha halos provide
light around cities and important roads. Do not add scene-wide bloom, additive
glow, animated particles, continuously pulsing nodes or satellite orbits.

The rendering changes never modify committed city positions, territory owners,
solver settings, layout generations, camera orientation on ordinary selection or tag orbit
height. Geographic ownership and lifecycle rules remain in
[Continental atlas design](../CONTINENT_DESIGN.md).

## Implementation map

- Shared bundled design data: src/render/cartography.ts and the approved JSON.
- DOM roles and component appearance: styles.css, scoped to the graph view.
- Physical display terrain: terrainSurface.ts, reliefGeometry.ts and SphereLayer.ts;
  the land worker returns derived geometry without changing intrinsic positions.
- Multihue mineral shading: terrainMaterial.ts; coarse colour is independent of light.
- Static atmosphere outside the silhouette: HorizonGlow.ts, separate from clouds.
- Screen-space roads and geographic strokes: screenSpaceLine.ts.
- City centers, local halos and independent rings: NodeLayer.ts and cityMaterial.ts.
- Silver satellites and existing occlusion/protection: TagLayer.ts and tagLinkStyle.ts.
- Shared label priority, collision and count budget: LabelPlacement.ts.
- Responsive inspector framing: cameraFraming.ts and SphericalGraphRenderer.ts.
- Legacy display-only country boundaries: countryPresentation.ts; saved rasters
  take precedence. The decorative worker receives this overlay separately so
  its land/coastline generation continues to use the original geography.

Current token revision 7 uses 9px reference cities with a 7.5px overview floor,
17px filled coral selection with a 42px local halo, gold selected relationships,
protected rounded geographic ink and country area tones. See specification
section 31 for current values. Ordinary long/hub roads retain every segment
with lower context opacity; all explicit highlights keep their state strength.
Real low-relief slopes and coastal walls use the same cached height field as
cities, pins, labels, geographic ink and satellite link starts. Bent surfaceRoad
paths guard against terrain intersections, unrelated cities and coarse chords.
Picking/DOM labels test actual terrain geometry in Solid mode. Petrol water has
optical relief, geographic shallows and a 0.65px dashed graticule. The phone
profile skips extra water-detail samples. Saved ownership remains intact.
Pins have violet #A58AFF heads and ivory #F5FAFC shafts, independent of city states.

Sixteen finer strata use contour-aligned cuts and separate plateau/riser normals.
Stationary erosion breaks the smooth contours into irregular folds and channels.
Directional lips and foot shadows separate terraces without uniform dark ink.
Country borders keep warm ink independent of terrain light; solid sand no longer
mixes with a broad cyan apron. A continuous 8px outer haze complements the
upper-left key. Broad optical bathymetry lives in oceanMaterial.ts.
Coarse profiles use a consistent geometric cut stride. A worker-built packed BVH
keeps exact terrain occlusion efficient. Country RGB hue multipliers have similar
luminance and remain stable under country-key reordering. Node hover uses the map
label alone, with a basename-only fallback when that label cannot be displayed.

Explicit Find/Focus can include up to 0.24 rad of real territory context;
it changes only the camera. The inspector puts Open and accessible icon Pin
on one row and previews four connections with an expandable complete list.

Existing user filters, surface modes, Search following, Route Finder, pins,
saved maps, autorotation and mobile safe areas remain available. Existing
persisted appearance values are respected; the normal-edge opacity default
for new settings is 0.24. Search keeps its established visibility at wide zoom
while selection and route strokes retain the existing edge zoom threshold.
