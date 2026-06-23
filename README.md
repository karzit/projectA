# @ccg/engine — MTG-style rules engine (core)

Headless, deterministic rules engine for an MTG-style card game. **No Canvas, no
network** — pure TypeScript that the renderer, input layer, server, and AI all
sit on top of. This is the foundation: an authoritative server runs this engine,
clients send `Action`s and render the resulting `GameState`.

```
Action (intent) ──▶ reduce(state, action) ──▶ { state, events, error? }
                         │
                         └── validate · mutate clone · run State-Based Actions
```

## Run

```bash
npm install
npm test         # vitest — 16 tests across setup, priority/stack, casting, combat
npm run typecheck
```

## Design principles

- **Single source of truth, one-way flow.** State only ever changes through
  `reduce(state, action)`. It is pure: the input state is never mutated, illegal
  actions return the original state plus an `error` string (a server rejects
  without crashing).
- **Fully serializable & deterministic.** `GameState` is plain JSON, randomness
  comes from a seeded PRNG stored *in* the state (`state.seed`). Same seed + same
  action sequence ⇒ identical game. This is what makes replay, spectating, and
  server authority possible.
- **Rules are data, not branches.** Card behaviour lives in `EffectSpec[]` on the
  card definition and is run by the interpreter in `effects.ts`. New cards are
  data; the engine only grows when a genuinely new primitive op is needed.
- **Events are an output channel.** `reduce` returns a `GameEvent[]` log for the
  renderer/animation/replay. The engine never reads them back.

## What the core models

- Zones (`library`/`hand`/`battlefield`/`graveyard`/`exile`/`stack`) and movement
- Mana pools, costs, payment; lands tapping for mana (mana abilities skip the stack)
- The **priority** loop: both players pass in succession ⇒ resolve the top of the
  stack, or advance the step
- The **stack** (LIFO) with spell/ability resolution and targeting legality
- **State-Based Actions**: lethal-damage destruction, loss at ≤0 life, decking
- Full turn structure (untap → upkeep → draw → main1 → combat → main2 → end →
  cleanup), first-turn draw skip, one land per turn
- **Combat** (minimal subset): declare attackers/blockers, simultaneous combat
  damage, summoning sickness + `haste`, `vigilance`, `flying` blocking restriction

### Deliberately out of scope (next layers)

First strike / trample / deathtouch, triggered & replacement effects, the
"mana ability vs. paying costs" nuance, multiplayer >2, mulligans. The
architecture (data-driven effects + SBA + stack) is built to absorb these
without structural change.

## Layout

```
src/engine/
  types.ts      GameState and all data shapes (serializable)
  rng.ts        seeded PRNG + shuffle (advances state.seed)
  mana.ts       cost parsing, pool, payment
  zones.ts      zone arrays + moveCard
  cards.ts      sample CardDefs + registry (would be JSON in production)
  effects.ts    the effect interpreter (drawCard, dealDamage, ...)
  combat.ts     combat damage assignment
  sba.ts        state-based actions + game-over check
  phases.ts     turn/step order, enterStep/advanceStep, priority granting
  actions.ts    the Action (intent) union
  reducer.ts    the orchestrator: reduce(state, action)
  game.ts       createGame() + driver helpers
  index.ts      public API
tests/          vitest specs + deterministic scenario builders
```

## Using it

```ts
import { createGame, reduce } from './src/engine/index.js';

let state = createGame({ seed: 42, decks: { P0: [...], P1: [...] } });
const res = reduce(state, { type: 'passPriority', player: 'P0' });
if (res.error) { /* reject */ } else { state = res.state; render(res.events); }
```

## Next steps

1. **Card effect DSL** — expand `EffectSpec` (modes, conditions, "until end of
   turn") and add triggered/replacement effect hooks around the stack.
2. **Server layer** — wrap `reduce` with per-player visibility redaction (hide
   hands/libraries) and WebSocket sync; clients send `Action`s only.
3. **Renderer** — Canvas layer that draws `GameState` and animates from the
   `GameEvent[]` stream.
