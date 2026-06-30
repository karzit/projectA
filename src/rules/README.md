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
- **Opening:** both sides place **up to 3 cards** (interleaved freely), each
  specifying a **cell number (0–8)**. Units are on the field immediately
  (available as 배경 conditions for subsequent placements), but **develops and
  effects are deferred**. When both have placed 3 or called `finishOpening`, the
  **main phase** begins: deferred effects resolve all at once in A→B order
  (선턴 이점), then the forced-ability settle runs, then the starter (A) takes
  the first main turn.
- **Main phase:** on your turn you may **play any number of cards** (no limit),
  have **each unit either attack or move** (not both — `actedThisTurn` tracks
  this), and then **`pass`** to end the turn. All are optional except the final
  `pass`. Card effects resolve **at turn end** (when `pass` is called), in the
  order they were played. Exception: cards with the **`개입` keyword** resolve
  immediately when played (e.g. 기본 체력물약).
- **전장 그리드 (battlefield grid):** each player side has **9 cells** —
  **전열 (front row)** cells 0–4 (5 slots) and **후열 (back row)** cells 5–8
  (4 slots). Units occupy one cell; a cell can hold at most one unit.
  - **Adjacency** (same side, used for movement and cooperative defense):
    `0↔1,5 / 1↔0,2,5,6 / 2↔1,3,6,7 / 3↔2,4,7,8 / 4↔3,8 /
     5↔0,1,6 / 6↔1,2,5,7 / 7↔2,3,6,8 / 8↔3,4,7`
  - **Attack range** (`ATTACK_TARGETS[cell]`, cross-side default):
    전열 0→{0,1} / 1→{0,1,2} / 2→{1,2,3} / 3→{2,3,4} / 4→{3,4}
    후열 5→{0,1} / 6→{1,2} / 7→{2,3} / 8→{3,4}
- **이동 (move):** a unit that hasn't acted this turn may move to an adjacent
  empty cell. Moving counts as acting (`actedThisTurn`).
- **배경 (background):** a card's play conditions — required unit(s) on a field
  and/or required environment entries. **Checked only at play time.**
- **환경 (environment):** an open-ended `type → value` map developed (전개) by
  card effects. **The same type cannot stack** (a new value replaces it);
  **different types coexist.** Types are not a fixed set.
- **Combat uses 힘 (power):** 1:1 — the lower-power unit is destroyed; a tie
  destroys both. **협공 (cooperative defense):** the defender may commit extra
  units via the `attack` action's `blockers` field; **extra blockers must be in
  cells adjacent to the primary defender's cell**. If the defenders' combined 힘
  **≥** the attacker's 힘 the defenders all survive; otherwise every participating
  defender is destroyed. Each unit may cooperate **once per turn**
  (`blockedThisTurn`). Card/forced effects can also destroy units.
- **Stats:** every unit has 힘 (power) and 지혜 (wisdom). 힘 drives combat. 지혜 is
  **not a consumed resource — it is a threshold CONDITION**: a card's 배경 can
  require a side's **total wisdom** to reach an amount.
- **지략 (cunning):** when an opponent plays a card with a `{need:'wisdom',
  amount:N}` condition, a unit with `cunning ≥ N` that hasn't blocked this turn
  may auto-counter, consuming one use and locking the card for this turn.

## Card behaviour (built)

A card is a `Card`/`UnitCard` subclass in `cards/defs/*.ts` with static `meta`
(id / kind / 힘 / 지혜 / keywords / 배경 conditions / evolveTarget) plus callbacks.
It never touches `GameState` directly — it acts through a `GameContext`
(`ctx.board`, `ctx.choices`, `ctx.events`). Units carry **mutable** 힘/지혜 so
behaviour can swap/buff stats.

- Callbacks: `onPlay(ctx)` (resolves at turn end for normal cards, immediately
  for `개입` cards; also at opening end), `subscribe(ctx)` (register forced
  abilities — see below), `onDeath(ctx)` (UnitCard, after death).
- `Board` vocabulary (the only writes a card may use): `summon`, `summonCard`,
  `destroyUnit`, `exitUnit`, `setController` (defect), `modifyStat`,
  `addTurnBuff`, `swapStats`, `grantKeyword`, `evolveUnit`, `performRitual`,
  `develop`, `pickRandom`, `addToHand`, `lockCard`, `resolveCombat1v1`,
  `pickRandomFrom`, `moveUnit`, `grantCunning`. A `UnitHandle` gives a unit
  method-call semantics.
- `ctx.choices` is a cursor over the player-supplied `choices` list;
  `pickRandom` covers the seeded random selector.
- `addTurnBuff` buffs are tracked in `state.turnBuffs` and reversed by
  `clearTurnBuffs()` at the end of each turn.

## Forced-ability evaluation (built)

Forced abilities are **subscriptions** a card registers on `ctx.events`
(`EventManager`) from its `subscribe(ctx)`, in two flavours: **event-driven**
(`EventSub`, fires on a matching `GameEvent`) and **static-condition**
(`StaticSub`, fires while a predicate over state holds). `Game._settle`
(`gameCore.ts`) runs after each main-phase action:

1. Drain one `state.pendingEvents` event → fire matching event subs. For a
   `unitDied` event it also synthesises the dead card's `onDeath(ctx)`.
2. With no pending events, fire static-condition subs to a fixpoint.

- Triggers in play: `ownFieldEmpty` (복수자), `highestStat` (배신자), `ritual` (마왕),
  `unitDied` (킹슬라임 ally-death), self-death via `onDeath` (최후), `envChanged`
  (용사), `turnStart` (미후왕 패악질), `heroLevelUp` (전사/사제/마법사).

### 영웅담 레벨링 + 결속 + 액티브 (built 2026-06-29)

- **레벨/exp**: `meta.levels` 유닛(용사)은 소환 시 `level/exp/expMax` 추적. 적 처치
  점수(힘+지혜 누적)가 피보나치 임계를 돌파할 때마다 레벨업 → +1/+1 + `heroLevelUp`
  이벤트 발행. 표시값은 `exp`(누적 점수)/`expMax`(다음 임계).
- **결속** 키워드: 한 턴에 결속 카드 한 장만 (`bondPlayedThisTurn`).
- **공격 대신 액티브** (`meta.activeAbility`): `ability` 액션 → `UnitCard.onAbility`.
  행동권(`actedThisTurn`) 소모. 사제(아군 힘 부여)·마법사(적 힘 감소). 음수 turnBuff는
  0 클램프 오버슈트를 막기 위해 현재 힘 이하로 제한.
- **이중방어** 키워드: `canBlock`이 한 턴 2회 협공 허용 (전사).
- **부동** 키워드: 효과가 pass 시점 효과 큐에서 처리되며, 이번 턴 능동 플레이어가
  아무 행동(공격/이동)도 하지 않았을 때만(`board.noActionThisTurn()`) 발동. 폭탄
  (대상 적 힘 -5, 10 이하면 파괴) 구현. **여관 정화는 '부정적 효과' 범위 결정 보류.**

### 묘지 + 전투 스코프 버프 (built 2026-06-30)

- **묘지(graveyard)**: `destroyUnit`이 사망 유닛 스냅샷을 `state.graveyard[owner]`에
  보관. `dead` 배경 조건(`hasDeadWithKeyword`)으로 조회. **교회**(`board.reviveFromGraveyard`)
  가 사망한 아군 용사를 강화 스탯/레벨/expMax 유지한 채 부활(현재 exp만 0 리셋).
  *주의: exp는 player 단위 `heroKillScore`에서 파생되므로 다음 처치 시 재계산됨.*
- **전투 스코프 버프**: **풀 플레이트 아머**가 아군 용사에 `수비강화3` 키워드 부여 →
  `_attack`이 방어 유닛에 전투 동안만 +3 힘 적용(`_applyArmor`/`_revertArmor`),
  생존 시 복구. 1:1·협공 양쪽에 적용.

### 타겟팅 리액션 파이프라인 + 지략 opt-in (built 2026-06-30)

- **타겟팅 파이프라인** (`board.resolveTargeting(targetId, {kind, wisdomAmount?})`):
  주문·전투 공격이 공유하는 window. 최종 대상 id 또는 `null`(무효화) 반환.
  - **호위**(난입): 수비측에 `호위` 키워드 유닛이 있으면 다른 무작위 아군이 대신 대상.
    1:1 전투(`_attack`)와 주문(폭탄·마법사)이 이 경로를 탄다.
  - **성검**(개입): 아군 용사에 `성검` 키워드 부여 → 자신 대상 주문에 지략 +5
    (wisdom-gated 주문만 실효). `resolveTargeting`의 spell 분기에서 무효화.
- **지략 opt-in** (자동봉쇄 → 선택): wisdom-gated 카드 play 시 봉쇄 가능한 상대 유닛이
  있으면 발동을 보류(`state.pendingReaction`)하고 `apply`가 `reactionRequest`를 반환.
  수비측이 **`react`** 액션으로 `block`(지략 소진+카드 잠금) 또는 통과(`_resolvePlay`로
  재개) 선택. 반응 대기 중 다른 액션 금지. **클라이언트는 `reactionRequest` 처리 필요(후속).**

### 스펙 개정 + 적 퀘스트 체인 (built 2026-06-30, 2차)

개정: 킹슬라임 7/3→**5/3**; 폭탄 배경 **지혜:20**(용사 제거); 풀 플레이트 아머 배경
**지혜:12** + **선택한 아군**에 부여(이전엔 모든 용사); 퀘스트-슬라임토벌이 **운명의 자각** 획득.

신규 키워드 프리미티브 (CardMeta 플래그 + `initialKeywords`):
- `cannotMove`(목없는기사머리) — `canMove`에서 차단.
- `cannotCooperate`/`noCoop`(마왕) — 협공 블로커 불가 + 협공 수비 받기 불가(`_attack`).
- `combatImmune`(목없는기사) — 전투로 파괴되지 않음(효과 파괴는 적용됨).
- `board.declareLoss(player)` — 즉시 패배(마왕 최후). `pass`의 `checkLoss`는 기존 loser 보존.

신규 카드:
- **여관**(부동): 아군의 부정적 키워드(`cannotAttack/cannotMove/noCoop`) 제거.
- **여신의 도움**(배경:용사, 결속, 부동): 선택 적 유닛 능력치 절반(내림).
- **적 퀘스트 체인**: 모험의 시작→슬라임토벌→**운명의 자각**(지역:왕성, 고블린2)
  →**미궁 탐험**(지하 미궁, 해골병사2+목없는기사+머리)→**마왕성 입성**(마왕 소환).
  - **고블린**(2/1, `고블린` 키워드): `_goblinSupporters` — 협력 방어처럼 선두 공격자의
    **인접 셀** 미행동 고블린만 합류(힘 합산), **패배 시 참여 고블린 전원 파괴**.
  - **해골병사**(5/1 최후:해골), **해골**(2/0).
  - **목없는기사**(7/0 전투면역, 정적조건: 자기 전장에 머리 없으면 파괴), **머리**(0/6
    지략6 이동불가 최후:적 용사 지략2).
  - **마왕**(44/44 협력불가 최후:패배).
- `once` subscriptions are recorded in `state.firedForced` and never refire.

## Open assumptions (next steps)

- ~~**Ritual source**~~ ✅ **결정(2026-06-25)**: 전용 카드 **부활 의식**
  (`revival-ritual`)을 낼 때마다 +1, 5회 누적 시 마왕 강림.
- ~~**Interactive choices**~~ ✅ **구현(2026-06-25)**: `ctx.choices.request({from,
  min,max,prompt})`. 부족/불법이면 롤백 후 `{ state, choiceRequest }` 반환.
- ~~**협공 tie semantics**~~ ✅ **결정(2026-06-25)**: 합산 힘 ≥ 공격자면 전원 생존.
- ~~**Simultaneous emptying (무승부)**~~ ✅ **결정(2026-06-25)**: 동시 전멸 시
  턴 종료자(pass한 플레이어)가 패배.
- **지략 opt-in (리액션)**: 현재 자동 봉쇄. 옵트인은 reaction window 필요 — 후속.
- **Environment scope** is assumed **global/shared**.
- **배경 unit requirement** is satisfied by a matching unit on **either** field.
- **WHEN to settle**: forced abilities evaluated only in the **main phase**.

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
                        performRitual, markForcedFired, checkLoss, clearTurnBuffs,
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
