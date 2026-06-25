# src/rules — the ACTIVE custom ruleset

You are in the ruleset the user is actively designing (the "rules reset"). When
the user says "the rules", they mean here. **Do not** put ruleset logic in
`src/engine` (that's the separate MTG-style reference engine).

Authoritative status & rules summary: **`./README.md`** (read it before changing
behavior). Full project map: `/CLAUDE.md`.

## Invariants when editing here

- **Reads go through `queries.ts`.** If you type `state.units[...]`,
  `state.field[...]`, `state.hand[...]`, or `getDef(...)` in `conditions.ts`,
  `Board.ts`, card defs, or `gameCore.ts`, stop — add/use a friend in
  `queries.ts` instead.
- **Writes go through `gameMut.ts`, mediated by `Board.ts`** (summon,
  destroyUnit, setController, removeFromHand, modifyStat, swapStats,
  performRitual, markForcedFired, nextRandom). Cards and the settle loop call
  **`Board` methods**, never `state.units[...]` directly — including stat
  buffs/swaps (`board.modifyStat` / `swapStats`).
- **Card behaviour is code in a subclass.** New cards = a new file in
  `cards/defs/*.ts` (a `Card`/`UnitCard` subclass: `meta` + `onPlay` /
  `subscribe` / `onDeath`), registered in `cards/CardRegistry.ts`. Behaviour
  drives the board only via `Board`; extend `Board` only for a new primitive.
- **Deterministic, with snapshot rollback.** `Game.apply(action)` mutates
  `this.state` in place on success and **restores from a `structuredClone`
  snapshot on an illegal action**, returning `{ state, error? }`. Randomness uses
  the seeded PRNG (`nextRandom`).
- 배경 (conditions) are checked **only at play time**. 지혜 is a **threshold**
  condition, not a consumed resource. Combat uses 힘. Units carry mutable 힘/지혜.

## Layer map

```
types → queries (reads) → gameMut (writes) ─┐
                          Board (mediator) ──┤
        conditions ───────────────────────── ┼→ gameCore (Game: apply + settle) → index
        EventManager + GameContext ──────────┤
        cards/Card + cards/defs/* + Registry ─┘   (card subclasses drive Board; forced
                                                   subs fire in Game._settle)
```

## Verify

`npm test` (rules: `tests/rules*.test.ts`) + `npm run typecheck`. No browser.
Tests build boards directly (state is plain data), then drive real `RulesAction`s.

## Known next steps

Forced-ability auto-evaluation is **built** (`Game._settle` in `gameCore.ts`, a
main-phase settle loop firing `EventManager` subscriptions). Remaining: what
advances the 부활 의식 ritual in real play, interactive choice protocol, "up to N"
optional counts, simultaneous-emptying (draw). See `./README.md` for specifics.
