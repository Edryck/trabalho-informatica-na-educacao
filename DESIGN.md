# Design

## Theme

Dark mode primary. Two surfaces with different moods that must read as the same game:

- **Blueprint (2D)** — deep blueprint blue with a fine grid, symbols drawn in light cyan lines. Feels like a technical drawing.
- **Bench (3D)** — dark anti-static mat under a warm desk light, white breadboard, real-looking parts. Feels like a lab at night.

The UI chrome (panels, toolbars, datasheet) sits on top of both and uses the same neutral dark palette, so switching between blueprint and bench never feels like changing apps. A light theme is not built in the demo.

## Colors

| Token | Value | Role |
|-------|-------|------|
| `colorBg` | `#0E141B` | App background, outside the canvases |
| `colorPanel` | `#16202B` | Panels, toolbars, datasheet card |
| `colorPanelRaised` | `#1D2A38` | Hover, selected list items, popovers |
| `colorBorder` | `#2A3A4C` | Panel borders, dividers |
| `colorText` | `#E6EDF3` | Primary text |
| `colorTextMuted` | `#93A4B5` | Secondary text, labels, metadata |
| `colorBlueprint` | `#0B2540` | Blueprint canvas background |
| `colorBlueprintGrid` | `#16385C` | Blueprint grid lines |
| `colorBlueprintLine` | `#9FD3FF` | Symbols and wires on the blueprint |
| `colorAccent` | `#E0954A` | Copper — primary action, selected tool, focus ring |
| `colorAccentPressed` | `#C27A35` | Pressed/hover of primary action |
| `colorCurrent` | `#FFD166` | Current view particles and arrows |
| `colorSuccess` | `#4CC38A` | Phase complete, expected state reached |
| `colorWarning` | `#E3B341` | Divergence blueprint × bench, measurement out of range |
| `colorError` | `#E5534B` | Short circuit, burned part (g6+), invalid placement |
| `colorPositive` | `#E5534B` | + rail / VCC marker (always paired with "+" glyph) |
| `colorNegative` | `#5AA9E6` | − rail / GND marker (always paired with "−" glyph) |

Rail and state colors are never the only signal: "+", "−", icons or dash patterns always go with them.

## Typography

Font family: **IBM Plex Sans** for UI, **IBM Plex Mono** for values, IDs and the multimeter. Both are SIL Open Font License and ship with the game.
Fallback stack: `"IBM Plex Sans", system-ui, sans-serif` / `"IBM Plex Mono", ui-monospace, monospace`

| Style | Weight | Size | Usage |
|-------|--------|------|-------|
| Display | SemiBold (600) | 28px | Group title on the phase map ("Circuitos lógicos") |
| Heading | SemiBold (600) | 18px | Panel titles, phase name, datasheet component name |
| Body | Regular (400) | 14px | Phase brief, datasheet text, feedback |
| Label | Medium (500) | 12px, +0.04em | Tool names, field labels, toggles |
| Value | Plex Mono Regular | 14px | Electrical values (`4,72 V`, `18,3 mA`, `220 Ω`) |
| Meter | Plex Mono Medium | 32px | Multimeter display |

Electrical values always use SI prefixes and the Brazilian decimal comma (`0,02 A` is shown as `20,0 mA`). Units always have a thin space before them.

## Iconography

Line icons, 1.5px stroke, 20px default, rounded joins. Electrical symbols on the blueprint follow the chosen standard (IEC default, ANSI toggle) and are drawn as SVG, never as icon-font glyphs.

Key icons: select, wire, place part, multimeter, current view, undo, rewind, datasheet, blueprint view, bench view, run/power, reset phase.

## Components

### Tool Bar (left)
- Vertical, `colorPanel`, 56px wide
- Tools: select, wire, multimeter, current view toggle, undo, rewind
- Active tool: `colorAccent` icon + 2px left indicator
- Each tool has a keyboard shortcut shown in its tooltip

### Parts Tray (bottom)
- Horizontal strip, `colorPanel`, 88px tall
- Shows only parts unlocked and allowed in the current phase, with remaining count badge
- Locked parts don't appear (no grayed-out teasers)
- Drag from tray to blueprint or bench; click opens the datasheet

### Phase Brief (top right)
- Card on `colorPanel`, 320px wide
- Phase name, type tag (tutorial / montagem / conserto / encomenda), goal in one or two sentences
- Expected state shown as a checklist that ticks live as the simulator reaches it
- Order phases also show the spec (parts allowed, budget)

### Datasheet Card
- Opens automatically when a part is unlocked, later from the tray or the part
- Sections: what it does, symbol (IEC/ANSI), key values in Plex Mono, how it goes on the breadboard, one common mistake
- Short text, written like a lab monitor explaining it, never like a textbook

### Multimeter (HUD)
- Floating panel bottom-right, mode selector (V, A, Ω) and the Meter display
- Probes are placed on breadboard holes; reading updates live from the solver
- Ammeter mode requires breaking the loop (series), as in real life; the game says so when it's used wrong

### Current View
- Toggle in the tool bar
- On: small `colorCurrent` particles move along wires in the conventional current direction; speed proportional to current (clamped so tiny currents still visibly move)
- Arrows on every wire segment so the direction reads without motion
- Reduced motion: particles off, arrows only

### Feedback Toast
- Bottom center, above the tray
- Success: `colorSuccess` left bar. Warning/error: matching bar + icon
- Error text follows the course guidelines: says why, gives a hint, never shows the answer on the first try, never mocking

### Divergence Marker
- When blueprint and bench netlists differ, both views highlight the mismatched connection with a `colorWarning` dashed outline and a short label ("no esquema essa ponta vai no +")

### Buttons
- Primary: `colorAccent` bg, `colorBg` text, SemiBold, radius 6px, height 36px
- Secondary: transparent, 1px `colorBorder`, `colorText`
- No gradients, no glow on buttons. Glow is reserved for things that are electrically on (LEDs, lamps)

## Screens & Navigation

1. **Title** — game name, continue / new game / sandbox / settings
2. **Phase map** — groups as columns or a path, phases as nodes; completed, available and locked states (icon + color)
3. **Phase screen** — the main workspace:
   - Center: blueprint or bench, switched by a two-state toggle (`Blueprint | Bancada`, shortcut `Tab`)
   - Left: tool bar. Bottom: parts tray. Top right: phase brief. Bottom right: multimeter when active
4. **Phase complete** — summary: expected state reached, parts used, cost, "tentar versão mais barata" option
5. **Sandbox** — same workspace, all unlocked parts, no brief, save/load slots
6. **Settings** — symbol standard (IEC/ANSI), reduced motion, volume, reset progress

## Layout

- Desktop first, minimum 1280×720
- Canvas takes all space not used by panels; panels never cover the area where the circuit is
- Panel padding: 12px; gap between panels: 8px
- Click targets: minimum 32px in the UI, 1 hole pitch in the bench with hover snapping to the nearest hole

## Bench (3D)

- Camera: orbit around the breadboard with limits (no going under the table), default 3/4 top view, `F` to frame the board
- Interaction happens on the board plane: hover highlights the hole under the cursor, connected holes of the same strip light up faintly so the internal wiring is learnable
- Wires are free: the player clicks a start hole and an end hole; the wire is a tube following a soft curve between them. Auto-tidy is a future feature
- Parts are mostly procedural geometry (resistor body with real color bands, LED dome, chips with notch and pin 1 dot); third-party models only where procedural looks bad, always credited
- Lighting: one warm key light, soft fill, LEDs and lamps emit when lit

## Blueprint (2D)

- SVG on a grid of 20px; symbols snap to grid, wires are orthogonal on the blueprint (unlike the free wires of the bench)
- Junction dots on T connections, no dot on crossings
- Labels (`R1`, `LED1`, `U1`) assigned automatically, editable

## Motion

- View switch blueprint ↔ bench: crossfade 200ms
- Panels open: fade + translateY 6px, 150ms, ease-out
- Expected-state checklist tick: 120ms scale on the check
- LED turning on: brightness ramp 80ms, no flicker
- No bounce, no elastic
- `prefers-reduced-motion`: all transitions instant, current particles off

## Simulation UI Patterns

- **Single source of truth**: every value shown anywhere (meter, current view, LED brightness, checklist) comes from the last solver result. No screen recalculates anything.
- **Live by default**: the circuit is solved on every change; there's no "simulate" button. A power switch on the battery lets the player cut everything.
- **Number formatting**: one shared formatter for values (SI prefix, 3 significant digits, comma decimal).
- **Nothing burns before g6**: before the Limits group, overcurrent shows a `colorWarning` marker and a hint instead of destroying the part.
- **Rewind** restores the full circuit state (blueprint + bench), not just the last action.
