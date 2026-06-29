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
- **카드 장수 제한 없음.** 턴당 원하는 만큼 낼 수 있다. `onPlay` 효과는 **턴 종료
  (pass) 시 낸 순서대로** 일괄 처리 (`state.pendingPlays` 큐). 단, **`개입` 키워드**
  카드는 즉시 처리 (예: 기본 체력물약). 유닛 소환(필드 배치)은 항상 즉시 처리.

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

모든 핵심 룰 구현 완료. 클라이언트 연출(C-12 턴 전환 배너, C-13 카드 사용 연출)과
D-1 밸런스 점검이 남아 있음. `src/rules/PLAN.md` 참조.
