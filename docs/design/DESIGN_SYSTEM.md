# Spherical Graph design system

The active design is the continental editorial atlas described in
[`../CONTINENT_DESIGN.md`](../CONTINENT_DESIGN.md).

The former cyberpunk direction is retired. New UI and renderer work must use
the atlas roles defined there: matte ocean, muted earth land colors, sand
coastlines, ivory cities, blue-gray roads, coral selection, amber routes and
tag satellites, cartographic region typography, and restrained native
Obsidian chrome without additive glow.

The implementation source of truth is split between:

- CSS tokens and application chrome in `styles.css`;
- WebGL theme mapping in `src/render/SphericalGraphRenderer.ts`;
- semantic geography in `src/geography`;
- land/sea ownership in `src/render/landGeometry.ts`; and
- the full-screen concept in `docs/continent-atlas-concept.png`.
