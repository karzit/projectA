# CLAUDE.md

Guidance for working in this repo. A web Canvas-based card game, built in TypeScript.

## ⚠️ 어느 코드베이스가 활성인지 먼저 확인

**활성 게임 본체는 `src/rules/` + `src/client/` 하나뿐이다.** `src/engine/`은
프로젝트 초기에 만든 **레거시 참조 구현**으로, 지금은 게임과 거의 무관하다.

1. **`src/rules/` + `src/client/`** — 사용자가 **활성 설계 중인 커스텀 룰셋**
   ("the rules reset")과 그것을 구동하는 전체 Canvas UI. 룰 코어는 헤드리스 +
   테스트 완비, 클라이언트(`npm run dev`)가 이를 구동한다. **모든 활성 설계
   작업이 여기서 일어난다.** 사용자가 "the rules"라고 하면 거의 항상 여기다.

2. **`src/engine/`** — **MTG 스타일** 헤드리스 결정론 룰 코어. 초기에 참조
   아키텍처로 만들었다. **이제 구동하는 클라이언트가 없다** — 원래 `src/client`가
   구동했으나 `src/rules`로 옮겨갔다. **룰셋 변경을 여기에 반영하지 말 것.** 초기
   설계 레퍼런스로만 남겨 둔다.

애매하면 확인하되, 기본값은 **`src/rules/`**. `src/engine/`은 건드리지 않는다.

## Commands

```bash
npm install
npm test            # vitest — 전체 테스트 (173 tests)
npm run typecheck   # tsc --noEmit (the real correctness gate; vite build does NOT typecheck)
npm run build       # vite production build of the client
npm run dev         # vite dev server (the src/rules client)
```

- Verify rules/engine changes with `npm test` + `npm run typecheck`.
- For `src/client` (browser) changes: **Claude Code Chrome 확장이 설치되어 있음.**
  `preview_start`로 dev 서버를 띄운 뒤 `mcp__Claude_in_Chrome__*` 도구로 직접 확인한다
  (navigate, read_console_messages, javascript_tool 등). preview_* 도구보다 Chrome MCP 우선.

## Conventions (the user cares about these)

- **Structure first.** When asked for a feature, the user usually wants the clean
  data model / framework before wiring complex behavior. Lead with structure.
- **Cards are self-contained.** A card is a `Card`/`UnitCard` subclass in
  `cards/defs/*.ts`: static `meta` data + `onPlay`/`subscribe`/`onDeath`
  callbacks. Behaviour drives the board **only through `Board` methods**, so
  adding a card adds a file, not engine branches — extend `Board` only for a
  genuinely new primitive.
- **Separation of responsibility.** In `src/rules`, reads / writes / policy are
  separate (see below). Don't reach into state shape from policy code.
- **Determinism.** Engines are pure: `reduce(state, action) -> {state, error?}`,
  never mutate input, randomness comes from a seeded PRNG stored in state.
- Match the surrounding comment density and idiom. Korean is the user's language;
  card names/domain terms are Korean (힘=power, 지혜=wisdom, 배경=background/condition,
  환경=environment, 전개=develop).

## `src/rules/` — the active custom ruleset

> Working in here? `src/rules/CLAUDE.md` (auto-loaded) has the editing invariants;
> `src/rules/README.md` is the authoritative detailed status.

The game (per the user's spec):

- No resource cost to play. Deck = 15 cards, **all in hand at start**; field empty.
- **Loss:** a player whose field is empty at the end of a turn loses (판정은 턴
  종료 효과·강제 능력 정산 후, 다음 턴 시작 전 — 패배 확정 시 다음 턴 없음).
- **Opening:** both sides place up to 3 cards, each specifying a **cell (0–8)**;
  then **main phase**, alternating. Per turn: play **any number of cards** + each
  unit may **attack OR move** (not both, tracked by `actedThisTurn`) + pass. All
  are optional except pass. `onPlay` effects resolve at **turn end** (pass 시)
  in play order. **`개입`** 키워드 카드는 즉시 처리 (예: 기본 체력물약). 유닛
  소환(필드 배치)은 항상 즉시 처리되지만, `개입`/강제 효과가 아닌 한 그 유닛은
  **공개(큐 처리) 전까지 배경 조건·공격 가능 여부·공격 대상 어디에도 존재하지
  않는 것으로 취급**한다 (D-2, `src/rules/README.md` "미공개 유닛" 절).
- **전장 그리드:** 전열 5칸(0–4) + 후열 4칸(5–8). 셀은 최대 1유닛. 이동은 인접 빈 셀로.
  협공 블로커는 방어 유닛의 **인접 셀** 유닛만 가능. **사거리 차폐:** 빈 칸은 거리
  0 — 후열 공격자는 아군 전열에 가로막히고, 상대 전열이 빈 레인으로는 상대 후열까지
  직접 공격 가능.
- **배경 (conditions):** play requirements, checked **only at play time** (a unit
  present, an environment entry, or a wisdom/power threshold).
- **환경 (environment):** open-ended `type → value` map. **Same type can't stack**
  (replaces); different types coexist. Types are not a fixed enum.
- **Combat uses 힘 (power):** 1:1 — lower power destroyed, tie destroys both.
  **협공 (cooperative defense):** the defender may add adjacent-cell units as
  blockers; if combined 힘 **≥** attacker, all defenders survive, otherwise all
  participating defenders are destroyed (each unit may cooperate once per turn —
  `blockedThisTurn`). Effects can also destroy.
  **지혜 (wisdom) is a threshold condition, NOT a consumed resource.**
- Units carry **mutable** 힘/지혜 (effects swap/buff stats).
- **지략 (cunning):** unit stat that auto-blocks opponent's wisdom-gated cards.

### Layering (separation of responsibility)

```
types.ts               data model only
queries.ts             READ-ONLY "friends" — the ONE place that reads state shape
environment.ts         환경 value rules (develop / query)
gameMut.ts             low-level state MUTATIONS — every write to GameState happens here
                       (createGame, summon helpers, destroyUnit, modifyStat, swapStats,
                        removeFromHand, checkLoss, clearTurnBuffs, markForcedFired, …)
Board.ts               battlefield mediator — the only caller of gameMut writes + queries;
                       cards call Board methods (UnitHandle gives a unit method semantics)
conditions.ts          배경 policy (canPlay) — expressed entirely via queries
EventManager.ts        forced-ability subscription registry (static + event-driven subs)
GameContext.ts         context handed to a card's onPlay/subscribe (board, choices, events)
cards/Card.ts          Card/UnitCard base + CardMeta; behavior via onPlay/subscribe/onDeath
cards/defs/*.ts        one file per card — meta DATA + behavior, as Card subclasses
cards/CardRegistry.ts  card registry + getCard / getDef / findCardByName
gameCore.ts            the Game class — turn loop / validation + the forced settle loop;
                       reads via queries, writes via Board / gameMut
actions.ts             RulesAction union
index.ts               public API barrel
```

**Rule of thumb:** if you type `state.units[...]`, `state.field[...]`,
`state.hand[...]`, or `getDef(...)` outside `queries.ts`/`gameMut.ts`, add a
friend to `queries.ts` instead.

**Card behavior is code, not a data table.** Each card is a `Card`/`UnitCard`
subclass in `cards/defs/*.ts`: static `meta` (id/힘/지혜/keywords/배경 conditions)
plus `onPlay`/`subscribe`/`onDeath` callbacks that drive the board **only through
`Board` methods** (`destroyUnit`, `develop`, `modifyStat`, `setController`,
`pickRandom`, …) — never touching `state` directly. Forced abilities register
subscriptions on `ctx.events` (EventManager); the `Game._settle` loop fires them.

### Open items (next steps)

모든 핵심 룰 구현 완료. 남은 작업은 클라이언트 연출(C-12/C-13)과 밸런스 점검(D-1).
See `src/rules/PLAN.md` for the full roadmap and `src/rules/README.md` for rule details.

## `src/engine/` — the MTG-style reference engine (no client)

> Working in here? See `src/engine/CLAUDE.md` (auto-loaded).

Headless, deterministic. `reduce(state, action) -> {state, events, error?}`.
Models zones, mana, the **priority** loop, the **stack** (LIFO), state-based
actions, full turn structure + combat, and **triggered abilities** (data-driven,
incl. event-subject binding). Emits a `GameEvent[]` stream. Kept as a reference;
the client no longer drives it.

Files: `types, rng, mana, zones, cards, effects, combat, sba, phases, triggers,
actions, reducer, game, index`.

## `src/client/` — Canvas UI (drives `src/rules`)

> Working in here? See `src/client/CLAUDE.md` (auto-loaded).

One-way data flow: input → `intent` (`RulesAction`) → `App.applyIntent` →
`game.apply(action)` → `state:changed` (HUD/log) + `markDirty` (renderer). The
`game.apply` call in `App.ts` is the seam a WebSocket transport would replace for
online play. (There is no `engine:event` stream — the client renders from each
new `GameState` snapshot, and `App.logAction` derives log lines from the action.)

- `core/` — `EventBus`/`EventManager` (typed pub/sub + DOM input), `ResourceManager`
  (asset loading), `CanvasManager` (layered canvases, HiDPI, fixed-step RAF loop).
- `render/` — `layout` (shared positions → renderer AND hit-testing agree),
  `CardSprite` (cached offscreen sprites), `BoardRenderer`, `Animator` (ease to
  layout target positions; fade-outs for departed cards), `theme`.
- `input/` — `InteractionLayer` (pointer/keyboard state machine: drag-to-play with
  drop-zone highlight, click-to-attack, DOM hover/배경 zoom panels), `commands`.
- `ui/` — DOM overlay above the canvas: `UIRoot`, `Hud`, `LogPanel`, `Overlay`
  (menu/loading/game-over), `styles`.
- `App.ts` composition root, `main.ts` entry, `decks.ts` preset decks.

## Tests

`tests/` (vitest). Engine: `engine`, `stack`, `combat`, `triggers` (+ `helpers`).
Rules: `rules` (environment/conditions/loss), `rules-loop` (opening/turns/combat),
`rules-effects` (effect interpreter). Engine tests build boards directly (state is
plain data) then drive through real Actions.
