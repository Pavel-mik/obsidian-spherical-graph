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
- [x] Replace uniform circular directory caps with deterministic compound
  territories and multi-scale connected-ocean coastal erosion.
- [x] Add a directly accessible bottom-rail Auto rotate control that preserves
  the fixed position buffer and stops on manual camera interaction.
