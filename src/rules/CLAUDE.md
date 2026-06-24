# src/rules — the ACTIVE custom ruleset

You are in the ruleset the user is actively designing (the "rules reset"). When
the user says "the rules", they mean here. **Do not** put ruleset logic in
`src/engine` (that's the separate MTG-style reference engine).

Authoritative status & rules summary: **`./README.md`** (read it before changing
behavior). Full project map: `/CLAUDE.md`.

## Invariants when editing here

- **Reads go through `queries.ts`.** If you type `state.units[...]`,
  `state.field[...]`, `state.hand[...]`, or `getDef(...)` in `conditions.ts`,
  `effects.ts`, or `reducer.ts`, stop — add/use a friend in `queries.ts` instead.
- **Writes go through `game.ts`** (summon, destroyUnit, setController,
  removeFromHand, modifyStat, swapStats, performRitual, markForcedFired,
  nextRandom). Policy code never mutates state shape directly — including stat
  buffs/swaps (effects.ts calls `modifyStat`/`swapStats`, never `state.units[...]`).
- **Behaviour is DATA.** New cards = entries in `cards.ts` (conditions / develops
  / effects / forced). Only a genuinely new effect *verb* touches `effects.ts`.
- **Deterministic & pure.** `reduce(prev, action)` clones, never mutates `prev`,
  and returns `{ state, error? }`. Randomness uses the seeded PRNG (`nextRandom`).
- 배경 (conditions) are checked **only at play time**. 지혜 is a **threshold**
  condition, not a consumed resource. Combat uses 힘. Units carry mutable 힘/지혜.

## Layer map

```
types → queries (reads) → game (writes) ┐
                          conditions ────┼→ reducer → index (public API)
                          effects ───────┤
                          forced ────────┘   (settle loop; reads queries, calls effects)
```

## Verify

`npm test` (rules: `tests/rules*.test.ts`) + `npm run typecheck`. No browser.
Tests build boards directly (state is plain data), then drive real `RulesAction`s.

## Known next steps

Forced-ability auto-evaluation is **built** (`forced.ts`, main-phase settle loop).
Remaining: what advances the 부활 의식 ritual in real play, interactive choice
protocol, "up to N" optional counts, simultaneous-emptying (draw). See
`./README.md` for specifics.
