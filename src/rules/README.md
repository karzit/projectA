# Rules core (new ruleset)

A fresh, data-driven ruleset, separate from the MTG-style `src/engine`. Headless
and deterministic; `reduce(state, action)` is the only way state changes.

## Confirmed rules

- **No resource cost to play.** Deck = 15 cards, **all in hand at the start**;
  the field starts empty.
- **Loss:** a player whose **field is empty at the end of a turn** loses.
- **Opening:** both sides place **up to 3 cards** (interleaved freely). Units are
  on the field immediately (available as 배경 conditions for subsequent placements),
  but **develops and effects are deferred**. When both have placed 3 or called
  `finishOpening`, the **main phase** begins: deferred effects resolve all at once
  in A→B order (선턴 이점), then the forced-ability settle runs, then the starter
  (A) takes the first main turn.
- **Main phase:** on your turn you take **one** action — `play`, `attack`, or
  `pass` — then the turn passes. **Playing is optional** (you may pass to avoid
  depleting toward the loss condition).
- **배경 (background):** a card's play conditions — required unit(s) on a field
  and/or required environment entries. **Checked only at play time;** once in
  play the conditions are irrelevant.
- **환경 (environment):** an open-ended `type → value` map developed (전개) by
  card effects. **The same type cannot stack** (a new value replaces it);
  **different types coexist.** Types are not a fixed set.
- **Combat uses 힘 (power):** the lower-power unit is destroyed; a tie destroys
  both. Card/forced effects can also destroy units.
- **Stats:** every unit has 힘 (power) and 지혜 (wisdom). 힘 drives combat. 지혜 is
  **not a consumed resource — it is a threshold CONDITION**: a card's 배경 can
  require a side's **total wisdom** to reach an amount (e.g. `지혜:15`). 힘 can
  likewise gate a card by presence/absence of a strong unit (e.g. "no 힘 7+ unit
  on your side"). Stat conditions are evaluated per side ('own'/'opponent'/'any').

## Effect system (built)

`effects.ts` is the shared resolution engine for on-play card effects AND forced
abilities — one vocabulary (`Effect[]`), data-driven. Units carry **mutable**
힘/지혜/지략 so effects can swap/buff stats.

- Verbs: `develop`, `destroy`, `swapStats`, `modifyStat` (힘/지혜/지략),
  `modifyStatTemp` (이번 턴 동안), `summonSelf`, `summonTo` (적/아군 전장에 소환),
  `defect`, `descend`, `evolve` (진행), `leaveGame` (수보리조사),
  `ritual`, `repeat`, `randomPick` (패악질).
- Selectors: `self`, `ownField`, `oppField`, `anyField`, `chosen` (player picks),
  `random` (seeded, deterministic).
- `evolve` reads the source unit's `CardDef.evolveTarget` to determine the new form.
- `modifyStatTemp` buffs are tracked in `state.turnBuffs` and reversed by
  `clearTurnBuffs()` at end of each turn.

## Forced-ability evaluation (built)

`forced.ts` runs two settle loops after each main-phase action:

1. **`settleEvents`** — event-driven (consumes `state.pendingEvents`):
   fires `unitDied` / `selfDied` / `envChanged` / `turnStart` triggers.
   After each event batch, runs the static settle to propagate cascades.
2. **`settleForced`** — static-condition (`ownFieldEmpty`, `highestStat`, `ritual`).

Events are emitted by game primitives: `destroyUnit` → `unitDied`, the `develop`
effect verb → `envChanged`, `endTurn` in reducer → `turnStart`.

- Triggers: `ownFieldEmpty` (복수자), `highestStat` (배신자), `ritual` (마왕),
  `unitDied` (킹슬라임 ally-death), `selfDied` (최후), `envChanged` (용사),
  `turnStart` (미후왕 패악질).
- `once` abilities are recorded in `state.firedForced` and never refire.

## Open assumptions (next steps)

- **Ritual source**: the `ritual` mechanic and counter exist, but **what performs
  부활 의식 in real play** is still undecided — tests drive it via `performRitual`.
- **지략 (cunning)**: 수치 능력치가 아닌 키워드형 메커닉 (전개/진행과 동급). 구체적
  발동 규칙은 미확정 — 설계 확정 후 추가.
- **WHEN to settle**: forced abilities are evaluated only in the **main phase**.
  Revisit if forced effects should also fire mid-opening.
- **`once` scope**: keyed per unit/hand-card, i.e. once per source per game.
- **Interactive choices**: `chosen` selectors read a pre-supplied list. A richer
  "choice request / response" protocol (and legal-target validation) can replace
  this without changing the effect vocabulary.
- **"Up to N"**: `repeat` runs exactly N; 혁명's optional up-to-N count needs a
  variable/optional count once interactive choices land.
- **Environment scope** is assumed **global/shared**. Could be per-player instead.
- **배경 unit requirement** is satisfied by a matching unit on **either** field;
  change to own-field-only if intended.
- **One action per main turn** (play *or* attack *or* pass).
- **Simultaneous emptying (무승부)**: `checkLoss` blames A on a double-empty tie;
  no draw is modeled (pending a rules decision).

## Separation of responsibility

Policy code never reaches into state shape directly — it asks **read-only
"friends"** in `queries.ts`. Reads, writes, and policy are separated:

```
types.ts        data model only
queries.ts      READ-ONLY friends — the ONE place that reads state shape
                (findUnit, unitsControlledBy, wisdomOnSide, hasUnitNamed,
                 powerOf, inHand, isMainPhase, ...). Pure; never mutates.
environment.ts  environment value rules (develop / query)
cards.ts        card data + getDef
game.ts         setup + state MUTATIONS (summon, destroyUnit, setController,
                removeFromHand, modifyStat, swapStats, performRitual,
                markForcedFired, nextRandom)
conditions.ts   배경 policy — expressed entirely via queries
effects.ts      effect interpreter — reads via queries, writes via game
forced.ts       forced-ability settle loop — reads via queries, writes via effects
reducer.ts      turn loop / validation — reads via queries, calls the above
actions.ts      RulesAction union
```

Rule of thumb: if you're typing `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts` / `game.ts`, add a
friend in `queries.ts` instead.
