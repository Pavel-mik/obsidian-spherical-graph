# Manual test plan

Use a dedicated disposable vault with developer tools available. Record the
Obsidian version, operating system, plugin commit, graph size, and results in
`VALIDATION.md`. Never run destructive test-vault generation against a real
vault.

## Preparation

1. Run `npm ci` and `npm run check`.
2. Confirm `main.js`, `manifest.json`, and `styles.css` are directly in
   `.obsidian/plugins/spherical-graph/` and that no extra worker JavaScript file
   is required.
3. Run:

   ```powershell
   npm run generate:test-vault -- --output ./tmp/test-vault --nodes 500 --edges 1500 --seed 42 --pattern clustered
   ```

   Copy only the generated Markdown notes into the disposable development
   vault if it is not already disposable.
4. Restart/reload Obsidian, enable **Spherical Graph**, open developer tools,
   and clear the console.

## Functional and lifecycle checks

1. **First open / Initialize**

   - Run **Spherical Graph: Open graph** from the command palette.
   - Confirm a progress status appears rather than a blank panel.
   - Confirm no intermediate node positions are shown.
   - When complete, confirm a coherent full-sphere map appears and status is
     fixed/up to date.
   - Inspect diagnostics or an instrumented run and confirm the worker payload
     contains no continent assignments, centers, extents, or geographic force
     parameters. Confirm geographic analysis begins only after the final
     position buffer has passed validation.
   - Inspect diagnostics or instrumented state and confirm the worker has
     terminated.

2. **Full rotation without a seam**

   - Drag the camera through multiple complete revolutions in both directions.
   - Inspect nodes/edges around every apparent longitude.
   - Confirm there is no jump, cut, duplicated boundary, or planar seam.

3. **Zoom and resize**

   - Zoom to both configured limits with wheel and trackpad/pinch if available.
   - Resize the pane repeatedly.
   - Confirm the camera keeps its orientation, the canvas remains sharp, and no
     clipping or spontaneous layout movement occurs.

4. **Hover, selection, and open**

   - Hover front-hemisphere nodes and confirm basename/full-path tooltip.
   - Select a node and confirm direct neighbors and incident edges are
     emphasized while unrelated items are subdued.
   - Confirm active-note and selected states are distinguishable without color
     alone.
   - Confirm the translucent **Selection details** panel shows the selected
     note and every direct neighbor. Click each kind of note link and verify
     `Ctrl`/`Cmd` opens it in a new tab.
   - Select the panel header and confirm it collapses to a 39px rail with
     `aria-expanded="false"`. Change selection, expand it again, and confirm
     the new details were retained.
   - Double-click to open; `Ctrl`/`Cmd` + click to open in a new tab.
   - Drag across a node and confirm the drag does not accidentally open it.

5. **Search and focus**

   - Use only the keyboard to focus search, filter by basename and path, move
     through results, and press `Enter`.
   - Confirm the chosen node is selected and the camera focuses it.
   - Confirm focus changes camera state only, not the committed position buffer.

6. **Fixed-map interaction invariant**

   - Capture/export or instrument a copy of the committed position buffer.
   - Perform a long sequence of rotation, zoom, hover, select, clear, search,
     focus, note open, resize, and theme changes.
   - Compare buffers byte-for-byte; they must be unchanged.
   - Confirm no worker exists during the sequence.

7. **Add note / pending state**

   - Add a Markdown note with links to existing notes.
   - Wait past the debounce.
   - Confirm pending counts update and no calculation begins.
   - Confirm the new note is not shown at an uncommitted random position.
   - Confirm all old positions are unchanged.

8. **Refresh atomic swap**

   - Select **Refresh layout**.
   - Confirm the old map remains visible and interactive throughout.
   - Confirm progress changes in DOM only; nodes do not drift.
   - On completion, confirm one atomic geometry update includes the new note,
     camera orientation is retained, and the worker terminates.
   - Record maximum and mean old-node displacement; verify the configured
     **Refresh displacement cap** and that remote unaffected nodes are fixed.
   - Compare the committed positions captured immediately before and after
     post-layout geography derivation. They must remain bitwise unchanged.

9. **Link change Refresh**

   - Add, remove, and reweight links among existing notes.
   - Confirm a pending link diff without automatic layout.
   - Run Refresh and verify only the local affected region may move.

10. **Delete behavior**

    - Delete a note.
    - Confirm the node and its incident visible edges disappear without moving
      other nodes.
    - Run Refresh and confirm the deletion is committed.

11. **Rename preservation**

    - Rename a note using Obsidian.
    - Confirm the displayed title/path updates at the identical position.
    - Run Refresh and confirm a pure rename does not introduce positional drift.

12. **Cancel Refresh**

    - Create enough pending changes for a visible calculation and start Refresh.
    - Select **Cancel calculation**.
    - Confirm status reports cancellation, the worker terminates, and the
      previously committed snapshot and Renew generation remain unchanged.

13. **Changes during operation**

    - Start Refresh, then add another note while it runs.
    - Confirm the current calculation does not restart.
    - After its successful captured-input commit, confirm the state remains
      dirty for the newer change.

14. **Renew confirmation and new map**

    - Select **Renew layout**.
    - Confirm the modal explains that the mental map may change and that the old
      map is preserved until success.
    - Cancel once and confirm no worker/snapshot change.
    - Confirm and let Renew finish.
    - Verify camera is retained, the full internal arrangement is new (not only
      globally rotated), the committed generation increments once, and the
      worker terminates.

15. **Renew cancel/error rollback**

    - Start another Renew and cancel it.
    - If a safe debug failure injection is available, simulate worker failure
      or an invalid final result.
    - Confirm the previous full snapshot remains rendered and persisted, with no
      generation increment.

16. **Restart stability**

    - Record selected node vectors and camera state.
    - Restart Obsidian and reopen the view.
    - Confirm nodes return to the same unit vectors and the camera orientation is
      restored without global rotation.

17. **Theme**

    - Switch between light and dark themes.
    - Confirm toolbar, canvas, labels, selection, active state, tooltip, and
      modal remain legible.
    - Confirm the committed position buffer is unchanged.

18. **Split and pop-out**

    - Open/activate the view in a narrow split.
    - Verify toolbar wrapping, full remaining canvas height, horizontal globe
      framing, and a reduced label density without horizontal page overflow.
    - Move the view to a pop-out window.
    - Verify interaction, resize, owner-window animation, and cleanup.

19. **Surface modes**

    - Test **Solid**, **Transparent**, and **Hidden**.
    - Confirm Solid depth-hides the back hemisphere, Transparent provides an
      x-ray cue, Hidden removes only the surface mesh, and no mode moves nodes.
    - Toggle **Map → Continents**. Confirm land, coastlines, islands, and
      cartographic labels disappear/reappear without changing the committed
      position buffer.
    - In a clustered synthetic vault, confirm large spatially dense regions
      form non-overlapping landmasses around their visible nodes, with sea
      between neighboring owners. Confirm small disconnected groups and notes
      outside accepted land remain islands.
    - Use an instrumented geography run to confirm every land cell has exactly
      one owner and all ocean cells form one connected component.
    - Use a fixture where one graph community occupies two distant spatial
      clusters. Confirm the community can support both candidates but does not
      force them into one footprint or move their nodes. Conversely, confirm a
      prominent spatial basin is not rejected solely because graph-community
      support is weak.
    - Inspect several coasts at close zoom. Confirm the shoreline has
      deterministic fine-scale irregularity, avoids a repeated circular
      “cloud” outline, and is bordered by a variably wide sand-beach band.
    - Run Refresh after adding a note inside an existing spatial cluster.
      Confirm the matched continent keeps its name and color while its center
      and diagnostic extent are rederived from the fixed positions. Confirm the
      geography update itself does not alter any position.
    - Run Renew and confirm a new full-sphere arrangement is allowed; then
      confirm geography is derived from that completed arrangement rather than
      constraining it during the solve.

20. **Large synthetic vault**

    - Test at 1,000 and 5,000 nodes.
    - Confirm UI stays responsive during calculation, sampled mode is reported
      above threshold, and pair-evaluation growth follows the configured sample
      count rather than all pairs.
    - Confirm instanced nodes, batched edges, and bounded labels.
    - Change **Globe size** from 100 to 200 and confirm node discs and the
      selected-node coral frame become half as large while the globe,
      camera, and committed positions stay unchanged.
    - Set **Label zoom-in threshold** to 75. Confirm labels disappear when
      zoomed out and reappear only after zooming in past the threshold.
    - Select a highly connected node and confirm its incident coral roads
      remain clearly visible above crossing blue-gray roads.
    - Confirm meridians and parallels are muted and dashed while document
      links remain brighter and continuous in solid and transparent modes.
    - Select a note, choose **Find route**, and select a destination. Confirm
      all shortest routes are highlighted amber, including both branches
      of a synthetic diamond graph. Confirm the origin has an amber double ring
      and `Start` label, the destination has a blue double ring and `Dest`
      label, and the panel lists both endpoints and all route-union nodes.
      Confirm disconnected notes show **No route**, and selecting the route
      control clears the result.
    - Add several inline and frontmatter tags to disposable test notes. Confirm
      every unique tag has an amber satellite outside the globe, but no carrier
      sphere is visible.
    - With no selection, confirm no tag links are rendered. Select a tagged
      note and confirm only its tag spirals appear. Complete a route and confirm
      links are present for tags of every route-union note.
    - Change **Tag orbit height** from 30% to 60%. Confirm satellites and the
      outer spiral endpoints move outward immediately while the committed
      document-position buffer stays bitwise unchanged.
    - Rotate the globe through multiple orientations. Confirm tag markers and
      labels disappear only when the main globe lies between them and the
      camera, including in Transparent and Hidden surface modes.
    - Enable **Protect globe view from tags** and confirm front-facing
      satellites near the direct camera axis additionally fade. Disable it and
      confirm they return; this option is off by default.
    - Resize below 560px and confirm the selection panel becomes a bottom
      drawer without obscuring the center of the globe or blocking scrolling.

21. **Close view during calculation**

    - Start a calculation and immediately close the owning view.
    - Confirm cancellation, worker termination, Blob URL revocation, and no
      late completion commit.

22. **Repeated open/close**

    - Reopen and close the fixed view at least ten times.
    - Check the console and memory/resource counters for duplicate listeners,
      observers, RAF loops, WebGL contexts, or errors.

23. **Empty and WebGL error states**

    - Apply a filter that yields zero nodes and confirm a clear empty state.
    - Simulate or trigger WebGL context loss where practical.
    - Confirm an understandable recoverable error while the persisted map
      remains safe.

## Completion evidence

Record pass/fail for every step. Attach console errors, screenshots, and exact
reproduction steps for failures. Do not mark an automated unit test as a GUI
pass.
