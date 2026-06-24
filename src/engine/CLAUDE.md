# src/engine — MTG-style reference engine

A headless, deterministic MTG-style rules core. This is the **reference engine**
that `src/client` renders. It is **NOT** the active custom ruleset — that's
`src/rules`. Don't add custom-ruleset logic here. Full project map: `/CLAUDE.md`.

## Invariants

- Pure reducer: `reduce(prev, action) -> { state, events, error? }`. Never mutate
  `prev` (it clones). Illegal actions return the original state + an `error`.
- Fully serializable `GameState`; randomness is a seeded PRNG stored in state.
- `events: GameEvent[]` is an OUTPUT channel for the client (render/log/animate);
  the engine never reads it back.
- Card behaviour is DATA (`EffectSpec[]`, triggered abilities) interpreted by
  `effects.ts` / `triggers.ts` — adding cards shouldn't add engine branches.

## Map

```
priority/stack loop: phases.ts, reducer.ts (passPriority), sba.ts
casting/effects:     effects.ts, cards.ts, mana.ts, zones.ts
combat:              combat.ts
triggers:            triggers.ts (data-driven, incl. event-subject binding)
```

## Verify

`npm test` (`tests/{engine,stack,combat,triggers}.test.ts`) + `npm run typecheck`.
Tests build boards directly then drive real `Action`s.
