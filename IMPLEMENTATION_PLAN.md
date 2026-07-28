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
- [x] Keep Initialize and Renew on the classic deterministic full-sphere layout,
  and freeze validated positions before any geographic analysis.
- [x] Derive geography afterward with an adaptive intrinsic spherical grid,
  fine/coarse density fields, watershed basins, and one connected ocean; use
  graph communities only as a soft prior.
- [x] Select exclusive spatial continents, preserve semantic identity across
  Refresh, leave unassigned notes as islands, and render deterministic land,
  irregular coastlines, and sand beaches without feeding geography back into
  node positions.
- [x] Replace the retired cyberpunk treatment with the continental atlas design
  system and add an on-screen Continents toggle.
