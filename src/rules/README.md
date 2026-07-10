# Rules core (new ruleset)

Headless and deterministic. The `Game` object (`gameCore.ts`) owns `GameState`; `Game.apply
(action)` is the only way state changes — it mutates in place on success and
rolls back from a snapshot on an illegal action. Card behaviour lives in
`Card`/`UnitCard` subclasses (`cards/defs/*.ts`), driving the board through
`Board` methods.

This document is a **current-state reference**, not a changelog — it describes
what the code does today. For history, use `git log` / `PLAN.md`.

## Setup & turn structure

- **No resource cost to play.** Deck = 15 cards, **all in hand at the start**;
  the field starts empty. **같은 카드는 덱에 1장만** — `meta.multiCopy` 카드
  (사교도)만 여러 장 가능. **넘버링 없는 토큰 카드(`meta.token`)는 덱 편성 불가**
  — 다른 카드의 생성 효과로만 획득(슬라임/킹슬라임/고블린/해골류/퀘스트 체인/의식
  4종/진행 결과물/사특한 신/마왕 등; 넘버링 정본은 `카드 디자인/테마 구성.txt`).
  (`maxDeckCopies`, 편성 시점 규칙이라 엔진은 검증하지 않고 덱 에디터가 강제.)
- **Loss:** a player whose **own field is empty at the end of their own turn**
  loses (`checkLoss(state, turnEnder)` in `gameMut.ts` only checks `turnEnder`'s
  field — emptying the *opponent's* field during my turn does not end their
  game; they still get their own turn to react/rebuild before the check applies
  to them). The check runs **after** all turn-end effects and forced abilities
  settle (`#finishEndTurn` runs `#settle` first — e.g. 복수자 can refill an
  emptied field before the check) and **before the next turn starts**; once a
  loser is decided the next turn never begins. (2026-07-03: previously checked
  *both* sides at every turn end, which let the first player wipe the second
  player's opening field and win turn 1 before the second player ever acted —
  see D-1 in `PLAN.md`.)
- **Opening:** both sides place **up to 3 cards** (interleaved freely), each
  specifying a **cell number (0–8)**. Units are on the field immediately
  (available as 배경 conditions for subsequent placements), but **develops and
  effects are deferred**. When both have placed 3 or called `finishOpening`,
  the **main phase** begins: deferred effects resolve all at once in A→B order
  (선턴 이점), then the forced-ability settle runs, then the starter (A) takes
  the first main turn.
- **Main phase:** on your turn you may **play any number of cards** (no
  limit), have **each unit either attack or move** (not both —
  `actedThisTurn` tracks this), and then **`pass`** to end the turn. All are
  optional except the final `pass`. Card effects resolve **at turn end** (when
  `pass` is called), in the order they were played. Exception: cards with the
  **`개입` keyword** resolve immediately when played (e.g. 기본 체력물약).
  Unit summons (field placement) always resolve immediately regardless of
  개입.
- **미공개 유닛 (unrevealed units):** a unit summon that isn't `개입`/forced is
  on the field immediately (occupies its cell) but is treated as **not
  existing** for 배경 conditions, attack eligibility, attack targeting, and
  loss checks until its queued effect resolves at pass time (D-2).
- **황폐 (attrition, from turn 35):** at the start and end of every turn from
  turn 35 on, every unit on the field loses **1 힘**; units reduced to 0 or
  below are destroyed (`Board.applyDesolation`, `DESOLATION_START_TURN` in
  `gameCore.ts`). Forces a true stalemate (e.g. an unbreakable cooperative
  defense wall with no legal attack) to end via attrition instead of running
  forever.
- **오행산 (trapped) units are treated as not existing**, same as 미공개
  유닛: immune to stat changes (original rule) *and* excluded from 배경
  conditions, attack eligibility/targeting, cooperative defense, and loss
  checks (`queries.isRevealed` covers both trapped and unrevealed). They still
  occupy their cell. Without this, a unit that re-enters 오행산 every turn
  (e.g. 제천대성) could permanently dodge 황폐 decay while keeping the field
  "non-empty," preventing the game from ever ending.

## 전장 그리드 (battlefield grid)

Each player side has **9 cells** — **전열 (front row)** cells 0–4 (5 slots)
and **후열 (back row)** cells 5–8 (4 slots). Units occupy one cell; a cell can
hold at most one unit.

- **Adjacency** (same side, used for movement and cooperative defense):
  `0↔1,5 / 1↔0,2,5,6 / 2↔1,3,6,7 / 3↔2,4,7,8 / 4↔3,8 /
   5↔0,1,6 / 6↔1,2,5,7 / 7↔2,3,6,8 / 8↔3,4,7`
- **Attack range** (`ATTACK_LANES[cell]`, computed by `attackableTargets`):
  각 칸은 상대 전열 칼럼으로 **레인**을 뻗는다 —
  전열 0→{0,1} / 1→{0,1,2} / 2→{1,2,3} / 3→{2,3,4} / 4→{3,4},
  후열 5→{0,1} / 6→{1,2} / 7→{2,3} / 8→{3,4}.
  사거리는 **칸 단위 고정 — 빈 칸도 거리 1로 센다** (2026-07-10에 차폐 모델을
  되돌림): 기본 사거리는 자기 레인의 **상대 전열**. 단, 기본 사거리 안에 공격
  가능한 적이 **하나도 없으면 사거리 +1**로 취급해 레인 뒤의 **상대 후열**까지
  대상이 된다 (레인 전열에 적이 하나라도 있으면 후열은 사거리 밖). 후열
  공격자도 아군 전열에 가로막히지 않는다.
- **이동 (move):** a unit that hasn't acted this turn may move to an adjacent
  empty cell. Moving counts as acting (`actedThisTurn`).

## 배경 / 환경 / 지혜

- **배경 (background):** a card's play conditions — required unit(s) on a
  field and/or required environment entries and/or a stat threshold.
  **Checked only at play time** — losing the condition afterward does not
  undo an already-played card.
- **환경 (environment):** an open-ended `type → value` map developed (전개) by
  card effects. **The same type cannot stack** (a new value replaces it);
  **different types coexist.** Types are not a fixed set. Scope is
  global/shared (both players read the same environment).
- **Stats:** every unit has 힘 (power) and 지혜 (wisdom), both **mutable**
  (effects can swap/buff them). 힘 drives combat. 지혜 is **not a consumed
  resource — it is a threshold CONDITION**: a card's 배경 can require a side's
  total wisdom (or a single unit's wisdom) to reach an amount.
- `PlayCondition` kinds (`conditions.ts`): `unit` (named unit present),
  `keyword` (keyword present on any field), `env` (environment entry),
  `wisdom` (side-total wisdom threshold), `unitWisdom` (single-unit wisdom
  threshold, e.g. 종말), `powerPresent`/`noPowerAtLeast` (side-total power
  threshold), `dead` (graveyard has a unit with a keyword, e.g. 교회).

## Combat

Combat uses 힘 (power), 1:1 — the lower-power unit is destroyed; a tie
destroys both.

**협공 (cooperative defense):** `attack` only carries `attackerId`/
`targetId`. If the defender has eligible adjacent allies (`coopBlockersFor`),
the engine **pauses** (`state.pendingAttack`, surfaced as
`attackReactionRequest`) and waits for the **defender** to choose blockers via
a separate `resolveAttack` action (`blockerIds: string[]`, empty = solo
defense). If no eligible allies exist, combat resolves immediately, solo.
Extra blockers must be in cells adjacent to the primary defender's cell. If
the defenders' combined 힘 **≥** the attacker's 힘, the defenders all survive
(the attacker is never destroyed by a coop defense — by design); otherwise
every participating defender is destroyed. Each unit may cooperate **once per
turn** (`blockedThisTurn`, or twice for **이중방어**-keyword units, e.g. 전사).
Card/forced effects can also destroy units outside combat.

**대리 전투:** a `대리방어필요`-tagged target (e.g. 삼장법사) is redirected to
a same-controller `대리방어`-tagged unit (e.g. 저오능/사오정) if one exists and
isn't trapped — via `Board.substituteDefender`, expressed by keyword, not a
per-card branch.

**타겟팅 파이프라인** (`board.resolveTargeting(targetId, {kind,
wisdomAmount?})`): the shared redirect window for both spell targeting and
combat attacks.
- **호위** (난입): a non-unit spell card; sits in hand doing nothing until the
  defending side is targeted. If the defender has a `호위`-keyword card in
  hand, it auto-fires and is consumed (removed from hand), redirecting to a
  random other ally instead. Both 1:1 combat (`_attack`) and wisdom-gated
  spells (폭탄, 마법사) go through this path.
- **성검** (개입): grants a friendly hero the `성검` keyword → self-targeted
  spells gain +5 effective 지략 (only matters for wisdom-gated spells);
  handled in `resolveTargeting`'s spell branch.

**Combat-scoped buffs:** 풀 플레이트 아머 grants a hero the `수비강화3`
keyword → `_attack` applies +3 힘 to the defender for the duration of combat
only (`_applyArmor`/`_revertArmor`), reverted on survival. Applies to both
solo and coop defense.

**고블린 떼:** attacking with a `고블린`-keyword unit pulls in other
un-acted, adjacent-to-the-attacker 고블린 units as supporters (combined 힘, all
marked acted). On a loss, every participating goblin is destroyed.

## 지략 (cunning) — opt-in reaction

When a player plays a card with a `{need:'wisdom', amount:N}` condition, if
the opponent has a unit with `cunning ≥ N` that hasn't blocked this turn, the
play is **held** (`state.pendingReaction`) and `apply` returns a
`reactionRequest`. The defender responds with a **`react`** action:
- `block: true` — consumes one use of the chosen unit's cunning
  (`cunningUsedThisTurn`) and **locks the card for the rest of the turn**
  (`lockedThisTurn`); the card stays in hand.
- `block: false` — the held play resumes (`_resolvePlay`).

No other action is legal while `pendingReaction` is set. This is **not
automatic** — the defender always gets to choose.

## Card behaviour architecture

A card is a `Card`/`UnitCard` subclass in `cards/defs/*.ts` with static
`meta` (id / kind / 힘 / 지혜 / keywords / 배경 conditions / evolveTarget) plus
callbacks. It never touches `GameState` directly — it acts through a
`GameContext` (`ctx.board`, `ctx.choices`, `ctx.events`).

- Callbacks: `onPlay(ctx)` (resolves at turn end for normal cards,
  immediately for `개입` cards; also at opening end), `subscribe(ctx)`
  (register forced abilities — see below), `onDeath(ctx)` (UnitCard, after
  death), `onAbility(ctx)` (UnitCard with `meta.activeAbility`, via the
  `ability` action — consumes the attack/move action slot).
- **미공개(unrevealed) 유닛 (D-2):** 유닛 소환(필드 배치·칸 점유)은 카드를 낸
  즉시 일어나지만, 그 유닛이 배경 조건 판정·공격 가능 여부·공격 대상 산출에서
  "존재"로 인식되는 건 **공개된 뒤**부터다. `개입` 키워드나 강제 효과로 즉시
  처리(onPlay 실행)된 카드가 아니면, 아직 `pendingPlays`/`openingPlays` 큐에
  남은 카드의 유닛은 미공개다 — `queries.isRevealed(state, unitId)`가 판별,
  `hasUnitNamed`/`hasUnitWithCardOnField`/`hasKeywordOnAnyField`/
  `wisdomOnSide` 계열(배경 조건이 거치는 존재 판정), `canAttack`/
  `attackableTargets`/`coopBlockersFor`(공격 가능 여부·공격 대상·협공 블로커)
  전부 미공개 유닛을 제외한다. 큐가 처리되는 순간(턴 종료 pass, 또는 양쪽
  오프닝 완료) 그 유닛은 공개된다.
- `Board` vocabulary (the only writes a card may use): `summon`,
  `summonCard`, `destroyUnit`, `exitUnit`, `setController` (defect),
  `modifyStat`, `addTurnBuff`, `swapStats`, `grantKeyword`, `evolveUnit`,
  `develop`, `pickRandom`, `pickRandomFrom`, `addToHand`,
  `lockCard`, `resolveCombat1v1`, `moveUnit`, `grantCunning`,
  `substituteDefender`, `resolveTargeting`, `declareLoss`,
  `clearNegativeTurnBuffs`, `reviveFromGraveyard`. A `UnitHandle` gives a
  unit method-call semantics.
- `ctx.choices` is a cursor over the player-supplied `choices` list;
  `pickRandom`/`pickRandomFrom` cover the seeded random selector.
- `addTurnBuff` buffs are tracked in `state.turnBuffs` and reversed by
  `clearTurnBuffs()` at the end of each turn; `clearNegativeTurnBuffs`
  (여관) reverts only the negative ones early.

### Keyword primitives (`CardMeta` flags)

- `cannotSummon` — can't be played from hand normally (only summoned via a
  card effect / forced trigger), e.g. 마왕.
- `cannotAttack` / `cannotMove` — blocked in `canAttack`/`canMove` (e.g. 머리
  can't move).
- `cannotCooperate` (`noCoop`) — doesn't cooperate with allies: can't act as
  a coop blocker for others, but can still be the target/beneficiary of
  cooperative defense (e.g. 마왕).
- `combatImmune` — not destroyed by combat (effect-based destruction still
  applies), e.g. 목없는기사.
- `allKeywords` — has every keyword primitive at once (used for
  ritual/placeholder units).
- Free-form `keywords: string[]` cover everything else (고블린, 호위, 성검,
  결속, 부동, 이중방어, 대리방어/대리방어필요, 수비강화N, …) — checked via
  `unitHasKeyword`/`hasKeywordOnAnyField`, not dedicated `CardMeta` flags.

### 영웅담 (레벨링 / 결속 / 액티브)

- **레벨/exp**: `meta.levels` 유닛(용사)은 소환 시 `level/exp/expMax` 추적. 적
  처치 점수(힘+지혜 누적)가 피보나치 임계를 돌파할 때마다 레벨업 → +1/+1 +
  `heroLevelUp` 이벤트 발행. 표시값은 `exp`(누적 점수)/`expMax`(다음 임계).
- **결속** 키워드: 한 턴에 결속 카드 한 장만 (`bondPlayedThisTurn`).
- **공격 대신 액티브** (`meta.activeAbility`): `ability` 액션 →
  `UnitCard.onAbility`. 행동권(`actedThisTurn`) 소모. 사제(아군 힘 부여)·마법사
  (적 힘 감소). 음수 turnBuff는 0 클램프 오버슈트를 막기 위해 현재 힘 이하로
  제한.
- **부동** 키워드: 효과가 pass 시점 효과 큐에서 처리되며, 이번 턴 능동 플레이어가
  아무 행동(공격/이동)도 하지 않았을 때만(`board.noActionThisTurn()`) 발동.
  폭탄(대상 적 힘 -5, 10 이하면 파괴)과 여관(음수 턴 버프 제거)이 이 키워드를
  쓴다. 의식 4종(첫~마지막)도 보상 절(다음 의식 획득/사특한 신 소환)이 부동
  게이트라 키워드를 명시한다 — 제물 희생·사교도 획득 자체는 부동과 무관하게
  발동한다(부분 부동). AI(SimAI)는 이 키워드를 보고 부동 카드를 낸 턴의 남은
  행동을 아끼고, 이미 행동한 턴에는 카드를 보류한다.

### 묘지 (graveyard)

`destroyUnit`이 사망 유닛 스냅샷을 `state.graveyard[owner]`에 보관. `dead`
배경 조건(`hasDeadWithKeyword`)으로 조회. **교회**(`board.reviveFromGraveyard`)
가 사망한 아군 용사를 강화 스탯/레벨/expMax 유지한 채 부활(현재 exp만 0
리셋). exp는 player 단위 `heroKillScore`에서 파생되므로 다음 처치 시
재계산된다.

### 적 퀘스트 체인 (예시 카드 그룹)

모험의 시작 → 슬라임토벌 → 운명의 자각(지역:왕성, 고블린2) → 미궁 탐험
(지하 미궁, 해골병사2+목없는기사+머리) → 마왕성 입성(상대 전장에 마왕
소환). 관련 카드: 고블린(2/1), 해골병사(5/1, 최후:해골 소환), 해골(2/0),
목없는기사(7/0, combatImmune, 정적조건: 자기 전장에 머리 없으면 파괴),
머리(0/6, 지략6, cannotMove, 최후: 적 용사 지략 +2), 마왕(44/44,
cannotCooperate, cannotSummon, 최후: 컨트롤러 패배 — 직접 소환 불가, 마왕성
입성으로 상대 전장에 소환되는 것으로만 등장한다).

## Forced-ability evaluation

Forced abilities are **subscriptions** a card registers on `ctx.events`
(`EventManager`) from its `subscribe(ctx)`, in two flavours: **event-driven**
(`EventSub`, fires on a matching `GameEvent`) and **static-condition**
(`StaticSub`, fires while a predicate over state holds). `Game._settle`
(`gameCore.ts`) runs after each main-phase action:

1. Drain one `state.pendingEvents` event → fire matching event subs. For a
   `unitDied` event it also synthesises the dead card's `onDeath(ctx)`.
2. With no pending events, fire static-condition subs to a fixpoint.

`once` subscriptions are recorded in `state.firedForced` and never refire.
Forced abilities are evaluated only in the **main phase**.

Triggers in play: `ownFieldEmpty` (복수자), `highestStat` (배신자), `ritual`
(마왕 강림), `unitDied` (킹슬라임 ally-death), self-death via `onDeath`
(최후), `envChanged` (용사), `turnStart` (미후왕 패악질), `heroLevelUp`
(전사/사제/마법사).

## Open assumptions

- **배경 unit requirement** is satisfied by a matching unit on **either**
  field (not scoped to the player's own side unless the condition says so).
- Everything else previously open here (ritual source, interactive choices,
  협공 tie semantics, simultaneous-emptying, 지략 opt-in) has been decided —
  see the sections above.

## Separation of responsibility

Policy code never reaches into state shape directly — it asks **read-only
"friends"** in `queries.ts`. Reads, writes, and policy are separated:

```
types.ts               data model only (UnitInstance.cell, field:(string|null)[], actedThisTurn)
queries.ts             READ-ONLY friends — the ONE place that reads state shape
                       (findUnit, unitsControlledBy, wisdomOnSide, hasUnitNamed,
                        powerOf, inHand, isMainPhase, canAttack, canMove, canBlock,
                        attackableTargets, unitAtCell, hexAdjacent, HEX_ADJACENT,
                        ATTACK_TARGETS, fieldUnitIds, unitCount, …).
                       Pure; never mutates.
environment.ts         환경 value rules (develop / query)
gameMut.ts             low-level state MUTATIONS — every write happens here
                       (createGame, placeUnit, moveUnit, removeUnit, destroyUnit,
                        setController, removeFromHand, modifyStat, swapStats,
                        markForcedFired, checkLoss, clearTurnBuffs,
                        nextRandom, firstFreeCell)
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
actions.ts             RulesAction union (play has optional cell?)
index.ts               public API barrel
```

Rule of thumb: if you're typing `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts` / `gameMut.ts`, add a
friend in `queries.ts` instead.
