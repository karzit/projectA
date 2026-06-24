# Rules core (new ruleset)

A fresh, data-driven ruleset, separate from the MTG-style `src/engine`. Headless
and deterministic; `reduce(state, action)` is the only way state changes.

## Confirmed rules

- **No resource cost to play.** Deck = 15 cards, **all in hand at the start**;
  the field starts empty.
- **Loss:** a player whose **field AND hand are both empty** loses (attrition).
- **Opening:** both sides place **up to 3 cards** (interleaved freely). When both
  have placed 3 or called `finishOpening`, the **main phase** begins with the
  starter (A).
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
힘/지혜 so effects can swap/buff stats.

- Verbs: `develop`, `destroy`, `swapStats`, `modifyStat`, `summonSelf`, `defect`,
  `descend`, `ritual`, `repeat` (count may be `enemyUnitCount` / `ownUnitCount`).
- Selectors: `self`, `ownField`, `oppField`, `anyField`, `chosen` (player picks),
  `random` (seeded, deterministic).
- 혁명 now runs end-to-end: `repeat enemyUnitCount × swapStats(chosen, chosen)`.

## Forced-ability evaluation (built)

`forced.ts` is the state-based "when to check" loop. After every **main-phase**
action the reducer *settles* the board: it repeatedly finds a forced ability
whose trigger holds and resolves it, to a fixpoint, **before** judging loss (so
복수자 can rise off an empty field and avert defeat).

- Sources are scanned in deterministic order (A→B, hand cards then field units):
  복수자/마왕 fire from **hand** (they summon themselves), 배신자 from the **field**.
- `once` abilities are recorded in `state.firedForced` and never refire. Non-once
  abilities self-limit (their effect makes the trigger stop holding); a per-settle
  `seen` set bounds no-op loops.
- Triggers: `ownFieldEmpty` (복수자), `highestStat` (배신자), `ritual` (마왕). The
  ritual counter lives in `state.rituals` and is advanced by the `ritual` effect
  verb / `performRitual`.

## Open assumptions (next steps)

- **Ritual source**: the `ritual` mechanic and counter exist, but **what performs
  부활 의식 in real play** (which card/event advances it) is still undecided —
  tests drive it via `performRitual`.
- **WHEN to settle**: forced abilities are evaluated only in the **main phase**
  (during the opening, players are still placing and auto-summons would interfere).
  Revisit if forced effects should also fire mid-opening.
- **`once` scope**: keyed per unit/hand-card (`instanceId:abilityId` /
  `owner:hand:cardId:abilityId`), i.e. once per source, not strictly once per game.
- **Interactive choices**: `chosen` selectors currently read a pre-supplied list
  on the action. A richer "choice request / response" protocol (and validating
  legal targets) can replace this without changing the effect vocabulary.
- **"Up to N"**: `repeat` runs exactly N; 혁명's "~수 까지" (optional, up to N)
  needs a variable/optional count once interactive choices land.
- **Environment scope** is assumed **global/shared** (우공이산 develops it, 미후왕
  reads it). Could be per-player instead.
- **배경 unit requirement** is satisfied by a matching unit on **either** field
  ("필드에 존재"); change to own-field-only if intended.
- **One action per main turn** (play *or* attack *or* pass). Could allow a play
  plus attacks in a single turn.

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
                removeFromHand, nextRandom)
conditions.ts   배경 policy — expressed entirely via queries
effects.ts      effect interpreter — reads via queries, writes via game
reducer.ts      turn loop / validation — reads via queries, calls the above
actions.ts      RulesAction union
```

Rule of thumb: if you're typing `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts` / `game.ts`, add a
friend in `queries.ts` instead.
