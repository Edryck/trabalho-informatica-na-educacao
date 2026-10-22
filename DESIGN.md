# Design

## Theme

Light studio workshop, playful but precise. The base follows the clean product look of a well-lit maker studio (warm cream background, white panels, soft shadows, saturated parts); on top sits a game layer that is impossible to miss: level and XP always visible, chunky pressable buttons, stars that drop and bounce, celebrations with sound.

Two surfaces that must read as the same game:

- **Bench (3D)** — bright studio: warm light floor, one soft key light with contact shadows, product-like parts in strong colors, LEDs and lamps that really glow.
- **Blueprint (2D)** — unchanged: deep blueprint blue with a fine grid and light cyan symbols. The UI frame around it follows this document.

## Colors

| Token | Value | Role |
|-------|-------|------|
| `colorBg` | `#F6F1E8` | App background (warm cream, subtle circuit-trace pattern) |
| `colorPanel` | `#FFFFFF` | Panels, cards, tray |
| `colorPanelSoft` | `#FBF7F0` | Hover, list rows |
| `colorBorder` | `#E9DFCE` | Borders, dividers |
| `colorText` | `#2B2118` | Primary text |
| `colorTextMuted` | `#6B5D4F` | Secondary text (AA on cream and white) |
| `colorAccent` | `#B87333` | Copper brand: borders, icons, focus ring, selection |
| `colorAccentDeep` | `#8A5424` | Filled primary buttons (white text AA), copper text on white |
| `colorAccentShadow` | `#5E3818` | Solid bottom shadow of primary buttons |
| `colorXp` | `#6D4BFF` | XP, level, progress |
| `colorXpDeep` | `#4B2FD1` | XP shadow and text |
| `colorStar` | `#FFB400` | Earned stars (always with a dark outline) |
| `colorSuccess` | `#16A34A` | Win state, check icons (text uses `#15803D`) |
| `colorWarning` | `#D97706` | Divergence, warnings (text uses `#B45309`) |
| `colorError` | `#DC2626` | Short circuit, invalid placement |
| `colorPositive` | `#E11D74` | + rail / VCC, always with the "+" glyph |
| `colorNegative` | `#2563EB` | − rail / GND, always with the "−" glyph |
| `colorCurrent` | `#F59E0B` | Current view particles and arrows |

Part and wire colors (saturated): green `#22C55E`, yellow `#FFC21A`, blue `#3B82F6`, pink `#EC4899`, coral `#EF4444`, purple `#8B5CF6`, orange `#F97316`.

Color never carries meaning alone: stars have filled vs outline shapes, rails carry "+"/"−", phase states use icons, divergence uses dashes, invalid placement uses hatching.

## Typography

| Style | Font | Weight | Size | Usage |
|-------|------|--------|------|-------|
| Display | Rubik | 700 | 40–56px | Game title, celebration headline |
| Title | Rubik | 600 | 20–28px | Screen and group titles |
| Game number | Rubik | 600 | 14–24px | Level, XP, star counts, counters |
| Button | Rubik | 600 | 15px | Primary and secondary buttons |
| Body | IBM Plex Sans | 400 | 14px | Brief, datasheet, feedback |
| Label | IBM Plex Sans | 500 | 12px, +0.04em | Field labels, tags |
| Value | IBM Plex Mono | 400 | 14px | Electrical values, IDs |
| Meter | IBM Plex Mono | 500 | 32px | Multimeter display |

Electrical values keep SI prefixes, Brazilian decimal comma and a thin space before units.

## Shape and depth

- Panels: white, 1px `colorBorder`, radius 14px, shadow `0 8px 24px rgba(80,60,30,.12)` (soft, offset — never a zero-offset colored glow).
- Primary button ("chunky"): 44px tall, `colorAccentDeep` fill, white Rubik text, solid 3px bottom shadow in `colorAccentShadow`; on press it moves down 3px and the shadow disappears.
- Secondary button: white fill, `colorBorder` outline and bottom shadow, same press behavior.
- XP bar: rounded track in `colorPanelSoft`, `colorXp` fill with a lighter top highlight.
- Stars: 5-point star with a dark outline; earned = `colorStar` fill, not earned = outline only, neutral goal = dashed gray outline.

## Bench (3D)

- Background and floor: cream `#F6F1E8` fading into a warm gray floor `#E7E1D6`.
- Lighting: one soft directional key with 2048px soft shadows, a hemisphere fill, and a studio environment generated with `RoomEnvironment` (no external HDR file). ACES tone mapping.
- A shadow-catcher plane gives contact shadows under the board and parts.
- Parts look like well-made products: rounded edges, satin plastic, metallic terminals, strong colors. Battery with a colored band and label; lamp with a threaded socket and glass bulb with a glowing filament; buttons with green or yellow caps; LEDs with translucent heads; chips matte black with silver pins and printed codes; the breadboard white with colored rails and printed column numbers.
- Reactions: lamp filament and halo follow brightness; LED glow in its color; motor propeller spins with a slight body vibration; buzzer emits animated rings; a short circuit throws small sparks for 600ms (nothing burns); a placed part does a small settle bounce.
- Light mode: after a 3s warm-up, if the frame rate stays below 40 for 2s, shadows and environment turn off and the game says so once.

## Screens

1. **Title** — the player's bench in slow showcase orbit behind a white panel: logo, player badge (level, XP bar, stars), daily repair card, buttons (Continue, New game, Workshop, Sandbox, Settings).
2. **Map and group screen** — the map shows only group cards, split into Electrical and Electronics. Each card says its state (available, complete, locked with what is missing, or soon), phases done and stars. A click opens the group screen: a single path of round nodes with 3 stars under each, focused on the next available phase. Esc goes group, then map, then back to the phase. Notices that arrive while a screen covers the bench (light mode, "continuing where you left off") wait in a queue and show when the screen closes.
3. **Phase screen** — top bar (level, XP, the phase's 3 star goals, map button), brief panel (goal, scenario checklist, star goals), tool bar, tray with chunky part cards and mini illustrations, blueprint/bench toggle.
4. **Phase complete** — celebration: stars drop one by one, XP counts up, level bar fills, unlock scene on level up; skippable with click or Esc.
5. **Workshop** — bench close-up with unlocked decor, cosmetic cards (breadboard, wires, mat), next reward.
6. **Settings** — symbol standard, reduced motion, volume, shortcuts, replay tour, export data, reset progress.

## Datasheet screen

A full screen above the bench, the map and the end screen (only the tour sits above it). The bench stays visible and dimmed behind it. Closing returns to the screen it came from.

- Hybrid style: a clean white sheet in the current theme (Rubik and Plex, copper dividers), and only the drawing area looks sketched.
- Sketch: an SVG filter (`feTurbulence` with fixed seed 7 plus `feDisplacementMap`) over ink-colored strokes, dashed dimension lines, italic Plex pin labels. The filter is off in light mode (`body.lite`).
- Left column: drawing (side view only for resistor, LED, diode and chips), pinout and the electrical symbol in the chosen IEC/ANSI standard. Right column: description, 3 to 5 key features, a technical table in Plex Mono, a typical application drawn as a read-only blueprint, and notes (breadboard tip and common mistake).
- Opened from the tray "i", the full-datasheet button on the new-part card, or the Datasheets button on the map and in the sandbox. From the list, a side column lets you move with the arrow keys.
- Spec numbers come from the solver model (`specRows`), never from the texts.

## Motion

Reference: TakayuStudio motion reference catalog. Web Animations API and CSS only; spring and bounce are sampled into keyframes or CSS `linear()`.

| Moment | Pattern | Duration | Easing |
|--------|---------|----------|--------|
| Screen and panel entrance | fade + slide (フェード＋スライド) | 600ms (panels 300ms) | easeOutCubic |
| Lists, map nodes, tray cards | sequential list (リスト順次表示) | 760ms, 40ms gap | easeOutCubic |
| Checklist tick, star goal lighting | pop scale (ポップスケール) | 520ms | easeOutBack |
| Star dropping on completion | bounce landing (バウンス着地) | 700ms | easeOutBounce |
| XP bar filling | spring follow (スプリング追従) | 1800ms | damped spring (mass 1, stiffness 80, damping 10) |
| XP number | count up (カウントアップ) | 1200ms | easeOutCubic |
| Item unlocked | expand from center + bloom (中央から展開 + ブルーム出現) | 860ms + 780ms | easeOutBack / easeOutQuart |
| Level up | particle burst (パーティクルバースト) | 820ms | easeOutQuart |
| Blueprint ↔ bench toggle | view crossfade (ビュークロスフェード) | 200ms | easeInOutCubic |
| Screen change | mask wipe (マスクワイプ) | 700ms | easeInOutQuint |
| Tour spotlight | iris open (アイリスオープン) | 760ms | easeOutQuart |
| Balloon and brief text | soft rise (ソフトライズ) | 900ms | easeOutSine |
| Button press | press feedback (プレスフィードバック) | 420ms | easeOutCubic |
| Hint offer | nudge (ナッジ) | 520ms | easeOutBack |
| Toasts | toast stack (トーストスタック) | 600ms | damped spring |
| Daily repair available | glow pulse (グローパルス) | 1100ms loop | easeInOutSine |

Reduced motion (system or settings): everything is instant, no loops, no particles; the completion screen shows its final state directly.

## Sound

CC0 effects, volume in settings, silent failure if the browser blocks audio: click, snap (part placed), wire, toggle, tick (scenario met), star (rising pitch per star), win, level up, unlock, soft error (short circuit, never punitive).

## Simulation UI patterns

Unchanged from the original design: every value shown comes from the last solver result, the circuit is solved live on every change, one shared value formatter, nothing burns outside groups with `burns: true`, rewind restores both views.
