# Spherical Graph cyberpunk design system

## Source of truth

- Primary concept: `spherical-graph-cyberpunk-concept.png`
- Native concept size: 1536 × 1024
- Product structure remains unchanged: one toolbar, one spherical graph canvas,
  and one integrated status rail.
- The surrounding Obsidian shell is context, not part of the plugin-owned
  surface.

## Visual direction

The plugin should feel like a precise cyberpunk research instrument rather than
a decorative vaporwave poster. The graph is the single visual focal point.
Glow is local and functional: cyan identifies graph structure, magenta identifies
focus or selection, and amber identifies the active note.

The background is a cool ink-black, never a warm neutral. Empty canvas space may
carry extremely faint scanline and circuit-grid texture. Controls use thin
technical borders, clipped corners, and compact spacing.

## Color lock

| Token | Value | Role |
| --- | --- | --- |
| `--sg-void` | `#02050b` | Canvas and root background |
| `--sg-panel` | `#06101a` | Toolbar and status rail |
| `--sg-panel-raised` | `#091622` | Inputs, buttons, menus, tooltip |
| `--sg-cyan` | `#21e6ff` | Nodes, primary edges, active borders |
| `--sg-cyan-soft` | `#73f4ff` | High-emphasis labels and neighbors |
| `--sg-cyan-dim` | `#0b7185` | Secondary borders and remote nodes |
| `--sg-magenta` | `#ff4fd8` | Focus, selection, primary focus ring |
| `--sg-route-start` | `#c8ff3d` | Route origin and path |
| `--sg-route-end` | `#ffb547` | Route destination |
| `--sg-graticule` | `#284650` | Muted meridians and parallels |
| `--sg-tag` | `#9d7bff` | Tag satellites and focused tag labels |
| `--sg-tag-soft` | `#ded7ff` | Tag label text |
| `--sg-tag-edge` | `#7364c7` | Thin note-to-tag spirals |
| `--sg-amber` | `#ffb547` | Active note |
| `--sg-text` | `#d9f8ff` | Primary UI copy |
| `--sg-muted` | `#7da5b2` | Secondary copy |
| `--sg-danger` | `#ff5876` | Destructive or error state |
| `--sg-grid` | `rgba(33, 230, 255, 0.055)` | Canvas micro-grid |

Light and dark Obsidian themes both retain a dark cyberpunk plugin surface. The
light-theme variant may raise the panel luminance slightly, but must not turn the
canvas white.

## Typography

- UI chrome: `var(--font-monospace)` with `ui-monospace`, `Cascadia Code`,
  `SFMono-Regular`, and `Consolas` fallbacks.
- Graph labels: the same mono stack for a technical instrument feel.
- Control copy: 12px, 600 weight, 0.015em tracking.
- Status and secondary copy: 11px, 500 weight, 0.04em tracking.
- Labels: 11px, 600 weight, tight line height, cyan-black text shadow.
- Modal body text remains Obsidian-readable, with the same palette and a less
  compressed line height.

## Component families

### Toolbar

- One full-width rail with a 1px cyan-dim bottom border.
- Search retains flexible width and receives the only magenta focus treatment.
- Buttons and select share a 34px control height, clipped top-right and
  bottom-left corners, thin cyan-dim borders, and no rounded-card appearance.
- Hover raises border/text luminance; press uses a shallow cyan inset.
- Disabled controls become dim, not translucent blur.

### Canvas

- Full bleed between toolbar and status rail.
- A faint scanline/circuit texture is layered above the WebGL background but
  below labels and tooltips.
- The sphere uses a dark translucent core, cyan geodesic edges, a muted dashed
  latitude/longitude graticule, and restrained rim light. The graticule must
  never resemble the brighter continuous note links.
- Near-side nodes are bright cyan; selected nodes and incident edges use
  magenta; the active note uses amber. Route origins use acid green and route
  destinations use amber, each reinforced by a double tangent ring and a text
  role.

### Labels and tooltip

- Labels have no card background.
- Tooltip is a compact angular panel with a magenta border when associated with
  a focused node. Existing basename/path content remains unchanged.

### Selection details

- A translucent angular panel sits beside the globe at desktop widths and
  becomes a bottom drawer below 560px.
- The selected note is followed by all direct neighbors. An active route adds
  explicit `START` and `DEST` rows plus the complete shortest-path union.
- Note names are functional controls; click opens the note and
  `Ctrl`/`Cmd` + click opens a new tab.
- The panel may scroll internally, but must not cover the globe center.
- Its complete header is an accessible disclosure control. Collapsed state is
  a 39px rail with a downward chevron; expanded state uses an upward chevron.

### Tag satellites

- Violet octahedral satellites sit on a larger invisible concentric sphere.
  Orbit height is user-adjustable; no orbit grid or carrier surface is drawn.
- Thin violet spiral links appear only for the selected note and active route
  nodes. They never adopt magenta selection or green route ribbon thickness.
- Satellite markers and labels are absent when hidden behind the main globe.
  An optional, default-off view guard additionally fades them around the direct
  camera axis. Labels are compact clipped chips and connected tags receive only
  a restrained violet emphasis.

### Status rail

- Integrated 32–36px telemetry rail, not a floating card.
- A cyan status LED precedes the existing status copy.
- Busy/pending/error tones use cyan, magenta, and danger respectively.

### Dialog and menus

- Angular raised surface, 1px cyan-dim border, compact mono title and buttons.
- Confirmation action uses magenta; cancel remains neutral.

## Motion

- Focus animation keeps the existing camera rotation duration.
- Hover and focus treatments transition over 120–160ms.
- A slow, low-opacity scanline drift is allowed only when reduced motion is not
  requested.
- Layout positions must never animate or change as part of styling.

## Icon inventory

The current toolbar intentionally uses text controls only. The existing Obsidian
`orbit` view icon remains unchanged. Native select affordances remain native.
No decorative icon row, logo, badge, or invented navigation is permitted.

## Allowed visible copy

- `Find a note...`
- `Refresh layout`
- `Renew layout`
- `Cancel calculation`
- `Reset camera`
- `Sphere surface`
- `Solid`
- `Transparent`
- `Hidden`
- Existing graph note basenames and paths
- Existing lifecycle/status messages
- Existing Renew confirmation copy
- `Selection details`
- `Node`
- `Route`
- `Start`
- `Dest`
- `Linked notes`
- `Shortest-path network`
- Dynamic direct-connection, hop, and route-node counts
- `Select destination`
- `Awaiting destination node`
- `No linked notes`
- `No route through existing links`

No additional cyberpunk jargon, decorative metrics, badges, or labels may be
introduced.

## Responsive rules

- At wide widths, search, actions, and surface mode remain in one toolbar row.
- Below 840px, the existing two-row toolbar behavior remains.
- Below 560px, the surface label may hide while its accessible select label
  remains.
- The selection panel becomes a bottom drawer below 560px. The globe always
  receives the remaining space; overlays must not obscure its center.
