# CLAUDE.md

Guidance for working in this repo. A web Canvas-based card game, built in TypeScript.

## ⚠️ Two codebases — know which one is active

This repo contains **two separate game engines**:

1. **`src/engine/`** — an **MTG-style** headless deterministic rules core. Built
   first, as the reference architecture. **No client anymore** — `src/client`
   used to drive it but has since been repointed at `src/rules` (below). Keep it
   as a headless reference; don't modify it for ruleset changes.

2. **`src/rules/` + `src/client/`** — the **NEW custom ruleset** the user is
   actively designing ("the rules reset"), now wired to the full Canvas UI. The
   rules core is headless + tested; the client (`npm run dev`) drives it. This is
   where **active design work happens**.

When the user talks about "the rules", they almost always mean **`src/rules/`**.
Don't modify `src/engine/` for ruleset changes. Confirm if unsure.

## Commands

```bash
npm install
npm test            # vitest — all engines (48 tests)
npm run typecheck   # tsc --noEmit (the real correctness gate; vite build does NOT typecheck)
npm run build       # vite production build of the client
npm run dev         # vite dev server (the src/rules client)
```

- Verify rules/engine changes with `npm test` + `npm run typecheck`.
- For `src/client` (browser) changes, verify with the preview tools (start dev
  server, screenshot). Note: the render loop runs continuously, so a static
  screenshot may need a retry; check `preview_console_logs` for errors.

## Conventions (the user cares about these)

- **Structure first.** When asked for a feature, the user usually wants the clean
  data model / framework before wiring complex behavior. Lead with structure.
- **Cards are self-contained.** A card is a `Card`/`UnitCard` subclass in
  `cards/defs/*.ts`: static `meta` data + `onPlay`/`subscribe`/`onDeath`
  callbacks. Behaviour drives the board **only through `Board` methods**, so
  adding a card adds a file, not engine branches — extend `Board` only for a
  genuinely new primitive.
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
- **Loss:** a player whose field is empty at the end of a turn loses.
- **Opening:** both sides place up to 3 cards; then **main phase**, alternating
  Per turn: play up to 1 card + each unit may attack once + pass (ends turn). All are optional except pass.
- **배경 (conditions):** play requirements, checked **only at play time** (a unit
  present, an environment entry, or a wisdom/power threshold).
- **환경 (environment):** open-ended `type → value` map. **Same type can't stack**
  (replaces); different types coexist. Types are not a fixed enum.
- **Combat uses 힘 (power):** 1:1 — lower power destroyed, tie destroys both.
  **협공 (cooperative defense):** the defender may add extra units (`attack`
  action's `blockers`); if the defenders' combined 힘 > attacker, all defenders
  survive, otherwise all participating defenders are destroyed (each unit may
  cooperate once per turn — `blockedThisTurn`). Effects can also destroy.
  **지혜 (wisdom) is a threshold condition, NOT a consumed resource** (a card may
  require a side's total wisdom ≥ N).
- Units carry **mutable** 힘/지혜 (effects swap/buff stats).

### Layering (separation of responsibility)

```
types.ts               data model only
queries.ts             READ-ONLY "friends" — the ONE place that reads state shape
environment.ts         환경 value rules (develop / query)
gameMut.ts             low-level state MUTATIONS — every write to GameState happens here
                       (createGame, summon helpers, destroyUnit, modifyStat, swapStats,
                        removeFromHand, checkLoss, clearTurnBuffs, markForcedFired, …)
Board.ts               battlefield mediator — the only caller of gameMut writes + queries;
                       cards call Board methods (UnitHandle gives a unit method semantics)
conditions.ts          배경 policy (canPlay) — expressed entirely via queries
EventManager.ts        forced-ability subscription registry (static + event-driven subs)
GameContext.ts         context handed to a card's onPlay/subscribe (board, choices, events)
cards/Card.ts          Card/UnitCard base + CardMeta; behavior via onPlay/subscribe/onDeath
cards/defs/*.ts        one file per card — meta DATA + behavior, as Card subclasses
cards/CardRegistry.ts  card registry + getCard / getDef / findCardByName
gameCore.ts            the Game class — turn loop / validation + the forced settle loop;
                       reads via queries, writes via Board / gameMut
actions.ts             RulesAction union
index.ts               public API barrel
```

**Rule of thumb:** if you type `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts`/`gameMut.ts`, add a
friend to `queries.ts` instead.

**Card behavior is code, not a data table.** Each card is a `Card`/`UnitCard`
subclass in `cards/defs/*.ts`: static `meta` (id/힘/지혜/keywords/배경 conditions)
plus `onPlay`/`subscribe`/`onDeath` callbacks that drive the board **only through
`Board` methods** (`destroyUnit`, `develop`, `modifyStat`, `setController`,
`pickRandom`, …) — never touching `state` directly. Forced abilities register
subscriptions on `ctx.events` (EventManager); the `Game._settle` loop fires them.

### Open items (next steps)

- **Forced-ability auto-evaluation** (복수자/배신자/마왕) is **built** (`Game._settle`
  in `gameCore.ts`: a main-phase settle loop run before the loss check, firing
  subscriptions held by `EventManager`). Remaining: what advances 마왕's 부활 의식
  ritual in real play (tests drive it via `performRitual`).
- **Interactive choice protocol**: `chosen` selectors read a pre-supplied list;
  no choice-request/response or legal-target validation yet.
- **Simultaneous emptying (무승부)**: `checkLoss` blames A on a double-empty tie;
  no draw is modeled (item D — pending a rules decision).
- See `src/rules/README.md` for the authoritative, detailed status.

## `src/engine/` — the MTG-style reference engine (no client)

> Working in here? See `src/engine/CLAUDE.md` (auto-loaded).

Headless, deterministic. `reduce(state, action) -> {state, events, error?}`.
Models zones, mana, the **priority** loop, the **stack** (LIFO), state-based
actions, full turn structure + combat, and **triggered abilities** (data-driven,
incl. event-subject binding). Emits a `GameEvent[]` stream. Kept as a reference;
the client no longer drives it.

Files: `types, rng, mana, zones, cards, effects, combat, sba, phases, triggers,
actions, reducer, game, index`.

## `src/client/` — Canvas UI (drives `src/rules`)

> Working in here? See `src/client/CLAUDE.md` (auto-loaded).

One-way data flow: input → `intent` (`RulesAction`) → `App.applyIntent` →
`game.apply(action)` → `state:changed` (HUD/log) + `markDirty` (renderer). The
`game.apply` call in `App.ts` is the seam a WebSocket transport would replace for
online play. (There is no `engine:event` stream — the client renders from each
new `GameState` snapshot, and `App.logAction` derives log lines from the action.)

- `core/` — `EventBus`/`EventManager` (typed pub/sub + DOM input), `ResourceManager`
  (asset loading), `CanvasManager` (layered canvases, HiDPI, fixed-step RAF loop).
- `render/` — `layout` (shared positions → renderer AND hit-testing agree),
  `CardSprite` (cached offscreen sprites), `BoardRenderer`, `Animator` (ease to
  layout target positions; fade-outs for departed cards), `theme`.
- `input/` — `InteractionLayer` (pointer/keyboard state machine: drag-to-play with
  drop-zone highlight, click-to-attack, DOM hover/배경 zoom panels), `commands`.
- `ui/` — DOM overlay above the canvas: `UIRoot`, `Hud`, `LogPanel`, `Overlay`
  (menu/loading/game-over), `styles`.
- `App.ts` composition root, `main.ts` entry, `decks.ts` preset decks.

## Tests

`tests/` (vitest). Engine: `engine`, `stack`, `combat`, `triggers` (+ `helpers`).
Rules: `rules` (environment/conditions/loss), `rules-loop` (opening/turns/combat),
`rules-effects` (effect interpreter). Engine tests build boards directly (state is
plain data) then drive through real Actions.
