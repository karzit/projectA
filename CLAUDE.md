# CLAUDE.md

Guidance for working in this repo. A web Canvas-based card game, built in TypeScript.

## ⚠️ Two codebases — know which one is active

This repo contains **two separate game engines**:

1. **`src/engine/` + `src/client/`** — an **MTG-style** card game. The engine is a
   headless deterministic rules core; the client is a full Canvas UI (managers,
   renderer, interaction, animation, HUD, turn timer). It has a **working browser
   demo** (`npm run dev`). Built first, as the reference architecture.

2. **`src/rules/`** — the **NEW custom ruleset** the user is actively designing
   ("the rules reset"). This is where **active design work happens**. Headless +
   tested; **not yet wired to a client**.

When the user talks about "the rules", they almost always mean **`src/rules/`**.
Don't modify `src/engine/` for ruleset changes. Confirm if unsure.

## Commands

```bash
npm install
npm test            # vitest — all engines (48 tests)
npm run typecheck   # tsc --noEmit (the real correctness gate; vite build does NOT typecheck)
npm run build       # vite production build of the client
npm run dev         # vite dev server (the src/engine MTG client demo)
```

- Verify rules/engine changes with `npm test` + `npm run typecheck`.
- For `src/client` (browser) changes, verify with the preview tools (start dev
  server, screenshot). Note: the render loop runs continuously, so a static
  screenshot may need a retry; check `preview_console_logs` for errors.

## Conventions (the user cares about these)

- **Structure first.** When asked for a feature, the user usually wants the clean
  data model / framework before wiring complex behavior. Lead with structure.
- **Data-driven.** Card behaviour is DATA (effects/conditions/triggers as plain
  objects), interpreted by the engine. Adding a card should not add engine
  branches — only a genuinely new primitive verb extends the interpreter.
- **Separation of responsibility.** In `src/rules`, reads / writes / policy are
  separate (see below). Don't reach into state shape from policy code.
- **Determinism.** Engines are pure: `reduce(state, action) -> {state, error?}`,
  never mutate input, randomness comes from a seeded PRNG stored in state.
- Match the surrounding comment density and idiom. Korean is the user's language;
  card names/domain terms are Korean (힘=power, 지혜=wisdom, 배경=background/condition,
  환경=environment, 전개=develop).

## `src/rules/` — the active custom ruleset

> Working in here? `src/rules/CLAUDE.md` (auto-loaded) has the editing invariants;
> `src/rules/README.md` is the authoritative detailed status.

The game (per the user's spec):

- No resource cost to play. Deck = 15 cards, **all in hand at start**; field empty.
- **Loss:** a player whose field AND hand are both empty loses (attrition).
- **Opening:** both sides place up to 3 cards; then **main phase**, alternating
  **one action per turn** (play / attack / pass). **Playing is optional.**
- **배경 (conditions):** play requirements, checked **only at play time** (a unit
  present, an environment entry, or a wisdom/power threshold).
- **환경 (environment):** open-ended `type → value` map. **Same type can't stack**
  (replaces); different types coexist. Types are not a fixed enum.
- **Combat uses 힘 (power):** lower power destroyed, tie destroys both. Effects can
  also destroy. **지혜 (wisdom) is a threshold condition, NOT a consumed resource**
  (a card may require a side's total wisdom ≥ N).
- Units carry **mutable** 힘/지혜 (effects swap/buff stats).

### Layering (separation of responsibility)

```
types.ts        data model only
queries.ts      READ-ONLY "friends" — the ONE place that reads state shape
environment.ts  environment value rules
cards.ts        card data + getDef
game.ts         setup + state MUTATIONS (summon, destroyUnit, setController, removeFromHand, modifyStat, swapStats, performRitual, markForcedFired, nextRandom)
conditions.ts   배경 policy — expressed entirely via queries
effects.ts      effect interpreter (Effect[] verbs) — reads via queries, writes via game
forced.ts       forced-ability settle loop — reads via queries, writes via effects
reducer.ts      turn loop / validation — reads via queries, calls the above
actions.ts      RulesAction union
```

**Rule of thumb:** if you type `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts`/`game.ts`, add a friend
to `queries.ts` instead.

Effect verbs: `develop`, `destroy`, `swapStats`, `modifyStat`, `summonSelf`,
`defect`, `descend`, `ritual`, `repeat`. Selectors: `self`, `ownField`, `oppField`,
`anyField`, `chosen` (player-picked, supplied on the action), `random` (seeded).

### Open items (next steps)

- **Forced-ability auto-evaluation** (복수자/배신자/마왕) is **built** (`forced.ts`:
  a main-phase settle loop run before the loss check). Remaining: what advances
  마왕's 부활 의식 ritual in real play (tests drive it via `performRitual`).
- **Interactive choice protocol**: `chosen` selectors read a pre-supplied list;
  no choice-request/response or legal-target validation yet.
- **Simultaneous emptying (무승부)**: `checkLoss` blames A on a double-empty tie;
  no draw is modeled (item D — pending a rules decision).
- See `src/rules/README.md` for the authoritative, detailed status.

## `src/engine/` — the MTG-style reference engine

> Working in here? See `src/engine/CLAUDE.md` (auto-loaded).

Headless, deterministic. `reduce(state, action) -> {state, events, error?}`.
Models zones, mana, the **priority** loop, the **stack** (LIFO), state-based
actions, full turn structure + combat, and **triggered abilities** (data-driven,
incl. event-subject binding). Emits a `GameEvent[]` stream for the client.

Files: `types, rng, mana, zones, cards, effects, combat, sba, phases, triggers,
actions, reducer, game, index`.

## `src/client/` — Canvas UI (drives `src/engine`)

> Working in here? See `src/client/CLAUDE.md` (auto-loaded).

One-way data flow: input → `intent` (engine Action) → `reduce` → `engine:event`
(for renderer/log) + `state:changed` (for HUD). The `reduce` call in `App.ts` is
the seam that a WebSocket transport would replace for online play.

- `core/` — `EventBus`/`EventManager` (typed pub/sub + DOM input), `ResourceManager`
  (asset loading), `CanvasManager` (layered canvases, HiDPI, fixed-step RAF loop).
- `render/` — `layout` (shared positions → renderer AND hit-testing agree),
  `CardSprite` (cached offscreen sprites), `BoardRenderer`, `Animator` (ease to
  target positions, fade-outs, floating damage numbers, state-derived target /
  combat arrows), `theme`.
- `input/` — `InteractionLayer` (pointer/keyboard state machine: drag-to-play with
  drop-zone highlight, targeting arrows), `commands`.
- `ui/` — DOM overlay above the canvas: `UIRoot`, `Hud`, `LogPanel`, `Overlay`
  (menu/loading/game-over), `styles`.
- `TurnTimer.ts` — per-turn countdown; on expiry auto-completes the turn via
  normal Actions (a client concern; the engine stays wall-clock-free).
- `App.ts` composition root, `main.ts` entry, `decks.ts` preset decks.

## Tests

`tests/` (vitest). Engine: `engine`, `stack`, `combat`, `triggers` (+ `helpers`).
Rules: `rules` (environment/conditions/loss), `rules-loop` (opening/turns/combat),
`rules-effects` (effect interpreter). Engine tests build boards directly (state is
plain data) then drive through real Actions.
