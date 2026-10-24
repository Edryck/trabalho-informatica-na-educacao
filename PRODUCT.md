# Product

## Register

game (educational, simulation-first)

## Brand

**Fio Contínuo**
An educational circuit game where the player draws a circuit on a 2D blueprint and builds it on a 3D breadboard. The name comes from the core idea the game is built to teach: current flows through the whole loop, it isn't used up along the way.

First version is a demo for the course *Informática na Educação* (UTFPR, delivery 03/11/2026). The project is meant to keep growing after that, possibly toward a Steam release.

## Problem

Two learning gaps show up again and again with people starting out in electronics:

1. **"Current gets used up."** Many students believe the current gets consumed as it passes through a lamp or LED, so less comes out than goes in. This misconception is documented in physics education research (McDermott & Shaffer, *Am. J. Phys.*, 1992) and survives traditional teaching.
2. **Schematic → breadboard.** Even when the schematic is right, beginners get lost turning it into a physical build. The classic mistake is not knowing which breadboard holes are connected inside, which leads to shorts and open circuits that are hard to see.

Simulators like PhET already show circuits well, but they're open tools with no goals, no repair tasks and no bridge between the drawing and the bench.

## Solution

A browser game where the simulator is the core. Every phase runs on top of the same circuit solver:

- The player **draws** the circuit on a blueprint using standard symbols (IEC/ANSI toggle).
- Then **builds** the same circuit on a 3D breadboard, placing parts and wires freely.
- The game turns both into the same netlist and compares them, so it can tell "your drawing is right, your build isn't". The comparison is a warning and a star, never a requirement: a phase is won when the circuit reaches the expected state, whatever the layout.
- A **current view** toggle shows the flow and its direction, making it visible that current is the same before and after a component.
- **Repair phases** hand the player a broken circuit and a multimeter. Finding the fault is investigation, not a question.
- **Orders** give an open spec ("a fan with a switch and a buzzer, one 9V battery") with many valid solutions.
- Every phase is a **work order** from someone who brought something to the workshop (a client, or Dona Neide, the workshop owner, in tutorials). The order opens with the **concept** the phase uses; while the player builds, the simulator drops short **observations** tied to what just happened in the circuit; winning writes one **discovery** sentence into the **bench notebook**. No quiz.
- A g2 phase has the player measure the current on both sides of a lamp and compare: the numbers match.

## Users

**Student (primary)** — high school or first-year college, technical courses included. Little or no hands-on electronics. Plays on a laptop or school computer, usually in short sessions. Needs to feel progress fast and not get punished for experimenting.

**Teacher (secondary, future)** — would use the game in class and want to see how students are doing. Remote storage and a teacher view are future features; in the demo, progress lives only in `localStorage`.

**Hobbyist / self-learner (secondary)** — adults curious about electronics who want to understand before buying parts. Mostly relevant for a future public release.

## Product Purpose

Help the player build a working mental model of DC circuits by doing: drawing, building, measuring and fixing. Logic gates come in as real chips on the breadboard, not as abstract boxes.

Success looks like:
- The player explains, after playing, that current is the same at every point of a series loop
- The player can take a schematic and build it on a real or paper breadboard without shorting rows
- The player finds a fault in a circuit using measurements instead of trial and error
- Demo test sessions show improvement on a short pre/post task outside the game

## Journey End-to-End

Groups are split in two blocks, electrical first and electronics after. Each group unlocks through `requires` in the JSON, not through a global phase queue.

| Group | Block | In demo | Requires | Unlocks | Burns |
|-------|-------|---------|----------|---------|-------|
| g0 Bancada | electrical | yes | none | battery, jumper wire, lamp, breadboard | no |
| g1 Circuitos básicos | electrical | yes | g0 | switch, button, buzzer, motor, current view | no |
| g2 Resistência | electrical | yes | g1 | resistor, multimeter | no |
| g3 Série e paralelo | electrical | yes | g2 | nothing new | no |
| g4 Capacitância | electrical | no | g3 | capacitor | no |
| g5 Limites elétricos | electrical | no | g4 | fuse | yes |
| g6 Diodo e LED | electronics | yes | g3 | diode, LED | no |
| g7 Circuitos lógicos | electronics | no | g6 | logic switches, logic probe, chips | no |
| g8 Limites eletrônicos | electronics | no | g7 | nothing | yes |

1. **Bancada (g0)**: learns the interface, the symbols and how the breadboard is wired inside
2. **Circuitos básicos (g1)**: closed/open circuit, switches, polarity, lamps in a row with current view on
3. **Resistência (g2)**: resistor, color code, multimeter, Ohm's law, and current measured before and after a lamp (it is the same)
4. **Série e paralelo (g3)**: series versus parallel, voltage divider, a lamp that opens
5. **Diodo e LED (g6)**: the diode passes current one way only, the LED is a diode that lights, protection resistor
6. Each group ends with a **repair** phase and an **order** phase, except when the group is a short tutorial
7. Outside the phases: **sandbox** with every supported part, unlimited, saved on its own key

Demo scope = g0, g1, g2, g3 and g6 (29 phases, 87 stars). Phase content lives in JSON. A part only burns in a group with `burns: true` (g5 and g8, both outside the demo).

## Tech Stack (Locked for Demo)

| Layer | Technologies |
|-------|-------------|
| Language / build | TypeScript (strict) + Vite |
| 3D bench | Three.js |
| 2D blueprint | SVG overlaid on the page |
| Simulation | Own DC solver, Modified Nodal Analysis, piecewise LED/diode |
| Data | Phases and components in JSON; single netlist format |
| Persistence | `localStorage` (remote storage is future) |
| Tests | Vitest (solver and netlist first) |
| Future desktop | Tauri or Electron wrapper for Steam |

Architecture rule: blueprint and bench produce a netlist, the solver reads the netlist, and every screen reads solver results. Nothing else computes electrical values.

## Brand Personality

Curious, hands-on, precise, friendly, a little nerdy.

The game should feel like a well-kept lab bench at night: calm, technical, with things that light up when you get them right. It respects the player's intelligence, it doesn't talk down, and mistakes feel like part of the work rather than a failure.

## Anti-references

- Quiz games dressed up as adventures — the learning has to come from building and measuring, never from picking answers
- Childish edutainment (cartoon mascots, rewards for every click, praise for nothing) — the audience is teens and adults. Stars and XP exist, but they mark method milestones (measured, matched the schematic, solved), never clicks or speed, and asking for a hint is never penalised
- Professional EDA tools (KiCad, LTspice) — powerful but intimidating; this must be approachable in minutes
- Generic logic-gate puzzle look (Turing Complete style) — this game is about real parts on a real-looking bench

## Gamification

The simulator is the engine; the game layer is what makes people play it and come back.

- **Stars:** each phase has 3 stars. The first is always "solve it"; the others reward method — measuring with the right meter scale, keeping the schematic equal to the build, staying within cost or wire count. Never speed, never "no hints".
- **XP and levels:** 100 XP per new star, 10 levels. Level and XP are always visible.
- **Growing workshop:** every level unlocks either decor that appears around the bench or a cosmetic (breadboard color, wire palette, mat).
- **Daily repair:** after the Resistance group, a broken circuit generated from the date; fixed by measuring. Tracks a streak of consecutive days; no ranking.
- **Best version:** after winning above the lowest known cost, the player can view the cheapest correct solution.
- **Juice:** celebration on completion, sound effects, reactive 3D parts. A short spotlight tour shows where everything is.

XP, levels and the workshop are extrinsic motivation. They are kept on method (not clicks or speed) and asking for help is never penalised, so they support the intrinsic reward of watching the circuit work rather than replacing it.

## Design Principles

1. **The simulator is the teacher** — feedback comes from what the circuit actually does, not from a script saying "wrong"; observations describe the phenomenon, never the fix
2. **Many right answers** — phases check the expected state, never one correct layout
3. **Mistakes are cheap** — undo/rewind always available, nothing burns outside the groups marked `burns` in the JSON (the Limits groups)
4. **Drawing and building are the same circuit** — the netlist is the single truth; divergences are shown, not hidden
5. **Show the invisible** — current view, meter readings and datasheets turn abstract quantities into something you can see

## Accessibility & Inclusion

- WCAG AA contrast for all UI text
- Color never carries meaning alone (wire state, polarity, current direction also use icons, dashes or labels)
- Reduced motion: current animation can be replaced by static arrows
- Keyboard shortcuts for the main tools (place, wire, measure, undo)
- Brazilian Portuguese as primary language; texts structured so translation is possible later
- Runs in a regular browser on a mid-range school computer, no install
