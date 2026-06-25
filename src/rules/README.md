# Rules core (new ruleset)

A fresh ruleset, separate from the MTG-style `src/engine`. Headless and
deterministic. The `Game` object (`gameCore.ts`) owns `GameState`; `Game.apply
(action)` is the only way state changes — it mutates in place on success and
rolls back from a snapshot on an illegal action. Card behaviour lives in
`Card`/`UnitCard` subclasses (`cards/defs/*.ts`), driving the board through
`Board` methods.

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
- **Main phase:** on your turn you may **play up to 1 card**, have **each unit
  attack at most once**, and then **`pass`** to end the turn. All are optional
  except the final `pass` (you may pass immediately to avoid depleting toward the
  loss condition). Per-turn limits are tracked by `playedThisTurn`,
  `attackedThisTurn`, and `blockedThisTurn`.
- **배경 (background):** a card's play conditions — required unit(s) on a field
  and/or required environment entries. **Checked only at play time;** once in
  play the conditions are irrelevant.
- **환경 (environment):** an open-ended `type → value` map developed (전개) by
  card effects. **The same type cannot stack** (a new value replaces it);
  **different types coexist.** Types are not a fixed set.
- **Combat uses 힘 (power):** 1:1 — the lower-power unit is destroyed; a tie
  destroys both. **협공 (cooperative defense):** the defender may commit extra
  units via the `attack` action's `blockers` field; if the defenders' combined 힘
  **>** the attacker's 힘 the defenders all survive, otherwise every participating
  defender is destroyed. Each unit may cooperate **once per turn**
  (`blockedThisTurn`, via `canBlock`). Card/forced effects can also destroy units.
- **Stats:** every unit has 힘 (power) and 지혜 (wisdom). 힘 drives combat. 지혜 is
  **not a consumed resource — it is a threshold CONDITION**: a card's 배경 can
  require a side's **total wisdom** to reach an amount (e.g. `지혜:15`). 힘 can
  likewise gate a card by presence/absence of a strong unit (e.g. "no 힘 7+ unit
  on your side"). Stat conditions are evaluated per side ('own'/'opponent'/'any').

## Card behaviour (built)

A card is a `Card`/`UnitCard` subclass in `cards/defs/*.ts` with static `meta`
(id / kind / 힘 / 지혜 / keywords / 배경 conditions / evolveTarget) plus callbacks.
It never touches `GameState` directly — it acts through a `GameContext`
(`ctx.board`, `ctx.choices`, `ctx.events`). Units carry **mutable** 힘/지혜 so
behaviour can swap/buff stats.

- Callbacks: `onPlay(ctx)` (on-play effect, also at opening end), `subscribe(ctx)`
  (register forced abilities — see below), `onDeath(ctx)` (UnitCard, after death).
- `Board` vocabulary (the only writes a card may use): `summon`, `summonTo`,
  `destroyUnit`, `exitUnit`, `setController` (defect), `modifyStat`,
  `addTurnBuff` (이번 턴 동안), `swapStats`, `grantKeyword`, `evolveUnit` (진행, via
  `meta.evolveTarget`), `performRitual`, `develop` (환경 전개), `pickRandom`
  (seeded, deterministic). A `UnitHandle` gives a unit method-call semantics.
- `ctx.choices` is a cursor over the player-supplied `choices` list (replaces the
  old `chosen` selector); `pickRandom` covers the old `random` selector.
- `addTurnBuff` buffs are tracked in `state.turnBuffs` and reversed by
  `clearTurnBuffs()` at the end of each turn.

## Forced-ability evaluation (built)

Forced abilities are **subscriptions** a card registers on `ctx.events`
(`EventManager`) from its `subscribe(ctx)`, in two flavours: **event-driven**
(`EventSub`, fires on a matching `GameEvent`) and **static-condition**
(`StaticSub`, fires while a predicate over state holds). `Game._settle`
(`gameCore.ts`) runs after each main-phase action and interleaves them:

1. Drain one `state.pendingEvents` event → fire matching event subs. For a
   `unitDied` event it also synthesises the dead card's `onDeath(ctx)`.
2. With no pending events, fire static-condition subs to a fixpoint (re-looping
   to phase 1 if firing one queued new events).

Events are emitted by mutations: `destroyUnit` → `unitDied`, `develop` →
`envChanged`, `endTurn` → `turnStart`.

- Triggers in play: `ownFieldEmpty` (복수자), `highestStat` (배신자), `ritual` (마왕),
  `unitDied` (킹슬라임 ally-death), self-death via `onDeath` (최후), `envChanged`
  (용사), `turnStart` (미후왕 패악질).
- `once` subscriptions are recorded in `state.firedForced` and never refire.

## Open assumptions (next steps)

- **Ritual source**: the `ritual` mechanic and counter exist, but **what performs
  부활 의식 in real play** is still undecided — tests drive it via `performRitual`.
- **지략 (cunning)**: 수치 능력치가 아닌 키워드형 메커닉 (전개/진행과 동급). 구체적
  발동 규칙은 미확정 — 설계 확정 후 추가.
- **WHEN to settle**: forced abilities are evaluated only in the **main phase**.
  Revisit if forced effects should also fire mid-opening.
- **`once` scope**: keyed per unit/hand-card, i.e. once per source per game.
- **Interactive choices**: cards read targets from `ctx.choices` (a cursor over
  the player-supplied list). A richer "choice request / response" protocol (and
  legal-target validation) can replace this without changing card callbacks.
- **"Up to N"**: a card's `onPlay` currently consumes a fixed count from
  `ctx.choices`; 혁명's optional up-to-N count needs a variable/optional count
  once interactive choices land.
- **Environment scope** is assumed **global/shared**. Could be per-player instead.
- **배경 unit requirement** is satisfied by a matching unit on **either** field;
  change to own-field-only if intended.
- **협공 tie semantics**: a cooperative tie (combined 힘 == attacker) currently
  destroys the **defenders** (success needs strictly `>`), which is asymmetric
  with a 1:1 tie (both die). Confirm this is intended.
- **Simultaneous emptying (무승부)**: `checkLoss` blames A on a double-empty tie;
  no draw is modeled (pending a rules decision).

## Separation of responsibility

Policy code never reaches into state shape directly — it asks **read-only
"friends"** in `queries.ts`. Reads, writes, and policy are separated:

```
types.ts               data model only
queries.ts             READ-ONLY friends — the ONE place that reads state shape
                       (findUnit, unitsControlledBy, wisdomOnSide, hasUnitNamed,
                        powerOf, inHand, isMainPhase, canAttack, canBlock, ...).
                       Pure; never mutates.
environment.ts         환경 value rules (develop / query)
gameMut.ts             low-level state MUTATIONS — every write happens here
                       (createGame, summon helpers, destroyUnit, setController,
                        removeFromHand, modifyStat, swapStats, performRitual,
                        markForcedFired, checkLoss, clearTurnBuffs, nextRandom)
Board.ts               battlefield mediator — the ONLY caller of gameMut writes +
                       queries; cards act through it (UnitHandle = unit methods)
conditions.ts          배경 policy (canPlay) — expressed entirely via queries
EventManager.ts        forced-ability subscription registry (static + event subs)
GameContext.ts         context handed to a card callback (board, choices, events)
cards/Card.ts          Card/UnitCard base + CardMeta
cards/defs/*.ts        one file per card — meta + onPlay/subscribe/onDeath
cards/CardRegistry.ts  registry + getCard / getDef / findCardByName
gameCore.ts            the Game class — turn loop / validation + the settle loop;
                       reads via queries, writes via Board / gameMut
actions.ts             RulesAction union
index.ts               public API barrel
```

Rule of thumb: if you're typing `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts` / `gameMut.ts`, add a
friend in `queries.ts` instead.
