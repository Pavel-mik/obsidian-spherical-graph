# Spherical Graph implementation plan

- [x] Create the repository from the current official Obsidian sample plugin.
- [x] Place it at `.obsidian/plugins/spherical-graph` in a dedicated test vault.
- [x] Preserve the complete specification as `docs/CODEX_TASK.md`.
- [x] Set stable plugin identity, release metadata, and core quality scripts.
- [x] Implement graph extraction, filtering, signatures, diffs, and change tracking.
- [x] Implement spherical geometry primitives and deterministic initialization.
- [x] Implement full and incremental intrinsic solvers with coverage regularization.
- [x] Implement committed snapshot persistence, migrations, and transactional lifecycle.
- [x] Implement the final-only inline worker protocol and non-blocking fallback.
- [x] Implement Three.js rendering, picking, labels, camera controls, and cleanup.
- [x] Implement the Obsidian view, toolbar, search, commands, settings, and vault events.
- [x] Add deterministic tests, test-vault generation, and layout benchmarks.
- [x] Complete user, architecture, algorithm, validation, and manual-test documentation.
- [x] Pass lint, typecheck, tests, production build, and final artifact checks.
- [x] Load the plugin in Obsidian and verify search, pending/Refresh, Renew,
  persistence, fixed-position stability, light/dark themes, and compact layout.
- [x] Add smooth zoom-driven label fading/scaling and consolidate graph actions
  into a compact disclosure menu while keeping note search visible.
- [x] Add render-only tag, attachment, existing-file, and orphan filters.
- [x] Anchor and intrinsically pack tag satellites from committed note positions.
- [x] Freeze every validated layout before deriving detailed land, coast, beach,
  and ocean geometry.
- [x] Render deterministic land, broad connected oceans, irregular coastlines,
  and sand beaches without feeding render-time ownership back into positions.
- [x] Replace the retired cyberpunk treatment with the continental atlas design
  system and add an on-screen Continents toggle.
- [x] Make top-level vault folders authoritative continents with deterministic
  intrinsic territories, weak cross-folder springs, and hard S² boundaries.
- [x] Reserve approximately half the surface for connected ocean, render only
  linked root notes as islands, and leave every orphan over open water.
- [x] Add same-subfolder selection emphasis and a searchable excluded-folder
  picker with subtree semantics.
- [x] Replace render-derived circular/compound land with a deterministic,
  quota-based connected owner raster allocated before the solver and persisted
  with the committed layout.
- [x] Add a directly accessible bottom-rail Auto rotate control that preserves
  the fixed position buffer and stops on manual camera interaction.
- [x] Replace radial lobe sampling and uniform orphan placement with
  deterministic farthest-point city spacing, short-range collision protection,
  hard final territory projection, and irregular ocean-separated growth.
- [x] Make startup load-first, persist a complete Sync-safe render graph, add
  explicit Load map controls, and isolate graph indexing, geography, and land
  meshing in adaptive one-shot workers for large-vault stability.
- [x] Automatically index and initialize the first map only when no usable
  saved layout exists, while retaining load-first startup for every later open.
- [x] Reorganize the compact menu into Layout, Explore, Saved map, Visible
  content, and Globe groups with concise intent hints and action tooltips.
- [x] Make fullscreen and Map controls explicitly dismissible on touch devices,
  keep the controls panel above mobile navigation with momentum scrolling,
  frame newly generated globes, and decouple continent names from note-label
  zoom suppression.

## Follow Search

- [x] Read core Search results through a guarded, isolated adapter.
- [x] Add opt-in following, query/count status and a Clear control.
- [x] Highlight matching notes and links with both endpoints matched, preserving
  selection, routes, filters, camera and committed layout.
- [x] Verify lifecycle, stale-result protection, rendering and native Search;
  run the complete project validation gate.
- [x] Refine Search to thin, contrasting strokes and a single-row mode selector;
  preserve note queries, expose native Search and keep the focus command usable.
- [x] Change Search highlights to wine red and replace the dark edge casing
  with a soft, fading halo.
- [x] Fill Search node centers, refine selection and route highlights, hide
  unrelated edges on selection, and persist the Globe Edges visibility toggle.

## Subfolder countries

- [x] Partition each continent into connected child-directory territories, including a direct-note Common district.
- [x] Constrain note centers and marker disks to their country and keep root notes outside continental land.
- [x] Persist ownership, preserve old maps until Renew, and guard Refresh when folder membership changes.
- [x] Render shared geographic borders, zoomed country names, and an independent Country borders toggle.
- [x] Verify end-to-end ownership, persistence, refresh, and native Obsidian rendering; package a test build.

## Živá kartografie

- [x] Inspect the approved specification, renderer, UI and persistence boundary.
- [x] Share the approved design tokens across scene and DOM.
- [x] Implement dimensional materials, screen-space roads, city states and silver satellites.
- [x] Apply the menu, inspector, typography and responsive treatment.
- [x] Test state composition, filters, pixel sizing, occlusion and immutable snapshots.
- [x] Run npm run check, inspect the built plugin and document verification.

## Živá kartografie – screenshot iteration 2

- [x] Compare the concept with native output and diagnose missing legacy countries and lost subpixel coverage.
- [x] Increase city/road legibility, restore stroke coverage, and use broad mineral terrain layers.
- [x] Add cached display-only country subdivisions for legacy maps, preserving saved geography and positions.
- [x] Validate overview/selection/borders in native Obsidian, run the project gate, and record the comparison.

## Živá kartografie – point-by-point iteration 3

- [x] Model bevelled terrain terraces with directional light, ledge shadows and richer mineral colours.
- [x] Give cities bead-like cores and a dominant selected marker with an offset label.
- [x] Make graph relationships gold and visually stronger than geographic boundaries.
- [x] Round country boundary strokes within a bounded, city/coast-protected display envelope.
- [x] Deepen the ocean, coastline and surrounding light without changing committed geography.
- [x] Calm continent typography and make the inspector more spacious with a quiet Open note action.
- [x] Compare native overview/selection with the concept, check profiles and shaders, run npm run check, and verify saved coordinates.

## Živá kartografie – iteration 4

- [x] Replace engraved contour dominance with smooth slopes and directional terrace lips.
- [x] Distinguish countries by restrained area tones without changing their raster.
- [x] Give selection a filled coral core, softer ring and broader light; attenuate ordinary limb beads.
- [x] Reduce overview web clutter without removing relationships or weakening explicit highlights.
- [x] Make water matte/petrol and coast highlights directional.
- [x] Improve explicit focus composition, geographic label contrast and inspector density.
- [x] Verify layout preservation, native shaders/controls/profiles, run npm run check, capture screenshots and compare them with the original concept.

## Živá kartografie – iteration 5, three steps

- [x] Step 1: multihue mineral material, country tints, unified side lighting, ocean relief, atmospheric rim and contrasting violet pins.
- [x] Step 2: immutable shared height field, real displaced land and coastal walls, terrain-aware city/edge/pin/label/satellite anchors and picking.
- [x] Step 3: deterministic bent surface roads, detail scaling, regression tests, full gate, native QA, saved-map audit and concept comparison.

## Živá kartografie – iteration 6

- [x] Sharpen and refine terrain strata, keeping one immutable height sampler and all anchors aligned.
- [x] Give every saved/display country a restrained, stable hue tint within its continental family.
- [x] Keep one basename-only hover label, including a fallback when map labels are disabled.
- [x] Run regression/full checks, native hover/geometry/state QA, preserve stored layout/settings/pins and compare new screenshots with the concept.

## Živá kartografie – iteration 7, eight comparison findings

- [x] 1. Break long uniform strata with bounded, stationary erosion detail.
- [x] 2. Separate terrace tops, directional lips and narrow wall shadows.
- [x] 3. Restore richer mineral colours and deeper cavities.
- [x] 4. Make each country's restrained hue coherent across its area.
- [x] 5. Strengthen warm country borders over the terrain and graph context.
- [x] 6. Narrow the cyan shallows and separate gold coast from dark water.
- [x] 7. Strengthen upper-left key light and the continuous atmospheric rim.
- [x] 8. Add broad directional ocean structure, clearer cities and calmer context roads.
- [x] Verify saved layout/settings/pins, functions, full gate and native snapshots against the concept.
