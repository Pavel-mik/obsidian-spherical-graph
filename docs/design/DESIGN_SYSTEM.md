# Spherical Graph design system

The three PNG files in this directory are the visual source of truth for the
primary fixed state, an in-progress Refresh, and the Renew confirmation.
Obsidian owns the outer application chrome; the plugin implements only the
view toolbar, canvas, status rail, labels, tooltip, and modal content.

## Visual direction

- Canvas: full-bleed, neutral near-black in dark themes; use Obsidian theme
  variables rather than forcing a branded page background.
- Density: one slim toolbar, one large interaction canvas, one unobtrusive
  status rail. Do not place the globe inside a card.
- Graph palette: restrained cyan/teal defaults, violet selected state, amber
  active-note state. Selected and active states also differ by size/outline or
  marker geometry, not color alone.
- Chrome: compact Obsidian-native controls, 1 px borders, 6–8 px radii, almost
  no shadow. A modal is the only elevated frame.
- Typography: inherit Obsidian's interface font; 12–13 px control chrome,
  13–14 px labels/status/body, and 18 px modal title.

## Token intent

Prefer these Obsidian variables and provide restrained fallbacks:

| Role | Preferred token |
| --- | --- |
| canvas | `--background-primary` |
| toolbar/modal | `--background-secondary` |
| raised tooltip | `--background-modifier-form-field` |
| primary text | `--text-normal` |
| secondary text | `--text-muted` |
| borders | `--background-modifier-border` |
| focus/selected | `--interactive-accent` |
| error/cancel hover | `--text-error` |

Three.js colors are sampled from the same theme intent: default node
`#65c7d0`, selected `#b36cff`, active `#f2ad43`, default edge `#4e98a2`.
Theme refresh may tune luminance while preserving these semantic distinctions.

Spacing uses a 4 px base: 4, 8, 12, 16, 24, 32. Toolbar controls target a
36–40 px height, with a 16 px desktop gutter and 8 px gaps. The status rail
uses 16–24 px canvas insets.

## Components and states

- Search: flexible-width input on the left, magnifier icon, keyboard listbox
  results, visible focus ring.
- Layout controls: **Refresh layout**, **Renew layout**, contextual
  **Cancel calculation**, and **Reset camera**. Refresh/Renew are disabled
  while an operation runs. Cancel is not shown or is disabled in fixed states.
- Surface selector: label **Sphere surface** with values **Solid**,
  **Transparent**, and **Hidden**, aligned to the toolbar's right edge when
  space permits.
- Status: open text rail, never a floating notification card. During work it
  may include a thin progress bar and the explanatory line
  **Old map remains active until the new layout is validated**.
- Tooltip: compact two-line surface containing basename and full path.
- Labels: pooled and sparse. Active/hover/selected labels outrank high-degree
  labels.
- Renew modal: concise title, one paragraph, secondary **Cancel**, primary
  **Renew layout**. The primary action is accent-colored rather than red
  because the old map is retained transactionally.

## Allowed visible copy

Primary controls and states may use only the task-defined strings and their
dynamic counts:

- Spherical Graph
- Find a note…
- Refresh layout
- Renew layout
- Cancel calculation
- Reset camera
- Sphere surface
- Solid / Transparent / Hidden
- No saved layout
- Initializing · iteration …
- Up to date · N nodes · M edges
- Changes detected · +N / -N notes · K link changes
- Refreshing · phase … · iteration …
- Renewing · iteration …
- Calculation cancelled
- Layout error · previous map preserved
- Old map remains active until the new layout is validated
- Renew the entire spherical layout?
- Renew creates a completely new map and may change your mental landmarks. The
  current map is preserved unless the calculation succeeds.
- Cancel

Note basenames and paths are data, not invented UI copy.

## Icon inventory

- Search: simple 1.5–2 px outline magnifier.
- Refresh: clockwise circular arrows.
- Renew: circular regeneration arrows; text always distinguishes it from
  Refresh.
- Reset camera: centered target/crosshair.
- Surface selector: small downward chevron.
- Cancel: text is sufficient; avoid a destructive trash icon.

Use Obsidian's built-in icon registry where practical so weight and sizing
match the host application.

## Responsive behavior

Desktop is the supported target. At narrow split-pane widths, controls may wrap
to a second toolbar row in this order: search, layout actions, camera/surface.
The canvas must retain all remaining height. Text labels may collapse before
actions disappear. No mobile-specific claims are made.

## Motion

Camera rotation/zoom and search focus may animate. Layout coordinates never
interpolate during calculation. A successful operation swaps all node and edge
geometry once; respect `prefers-reduced-motion` for focus animation.
