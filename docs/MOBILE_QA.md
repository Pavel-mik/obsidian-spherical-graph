# Mobile QA

Run these checks with community-plugin data enabled in Obsidian Sync. Use a
representative phone and tablet; include one lower-memory Android device when
preparing a public release.

## Phone

- Install and enable the plugin from a clean mobile configuration.
- Open a vault with no saved map and verify Initialize begins automatically.
- Background Obsidian during Initialize; verify calculation cancels cleanly and
  the app remains responsive after returning.
- Restore or generate a saved map, then drag, pinch, tap a city, tap a tag,
  search, pin, route, filter, and open Selection details.
- Verify labels and ordinary roads disappear during a gesture and return after
  release; selected/route emphasis must remain visible.
- Verify Auto rotate and the normal atmosphere toggle are absent, Fullscreen
  automatically rotates, and device rotation does not crop UI.
- Confirm no fullscreen-exit button appears in either mode. Use the standard
  Android Back button/gesture to exit Fullscreen without leaving the graph;
  repeat when native fullscreen is unavailable and the CSS fallback is active.
- Repeat fullscreen entry and Back several times, then navigate Back normally
  outside presentation and verify no stale modal/history entry remains.
- Check the controls menu and bottom inspector around display cutouts and
  navigation bars in portrait and landscape; scroll to the last menu control
  and confirm both it and the menu close button remain reachable.

## Tablet

- Repeat the phone interaction checks in portrait and landscape.
- Verify Auto rotate resumes three seconds after touch interaction.
- Verify Fullscreen enables the presentation atmosphere in Automatic and High
  quality profiles, and exits through the **Exit fullscreen** button, platform
  Back gesture, or Escape key. The button must contain no `u00d7` prefix and
  must be absent outside Fullscreen.
- Compare Automatic, Battery saver, and High quality after reopening the view.

## Sync and recovery

- Generate and save on desktop; sync to mobile; choose **Load map** and verify
  positions, continents, pins, and camera match.
- Modify pins on mobile, use **Save map** for a changed camera, sync back,
  reload, and verify no layout drift.
- Pin notes, Renew the map, and reload on desktop, phone, and tablet. Confirm
  the same notes retain their pins at their new positions, including pins
  synced from another device immediately before Renew completes.
- Leave a second device on an older map, move its camera without choosing
  **Save map**, then sync again and verify the newer map and pins remain intact.
- Test a state above the 3 MB warning threshold. If the 4.5 MB budget is
  crossed, verify only the derived graph cache is removed and the canonical
  layout reloads after a vault re-index.
- Disable/enable the plugin and restart Obsidian several times. A saved map must
  load first and no new layout may start unless the saved state is absent or
  invalid.

## Resource checks

- Watch Android memory and temperature during ten minutes of normal use.
- Confirm repeated open/close cycles do not accumulate WebGL contexts.
- Confirm the app remains usable after WebGL context loss or Android process
  suspension, and that the last committed map is never overwritten by a
  cancelled operation.
