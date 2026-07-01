# src/engine — MTG-style 레거시 참조 엔진

프로젝트 초기에 참조 아키텍처로 만든 헤드리스 · 결정론 MTG 스타일 룰 코어.
**지금은 게임 본체와 거의 무관한 레거시**다 — 구동하는 클라이언트가 없다
(`src/client`는 `src/rules`로 옮겨갔다). 이것은 **활성 커스텀 룰셋이 아니다**
(그건 `src/rules`). **여기에 커스텀 룰셋 로직을 추가하지 말 것.** 초기 설계
레퍼런스로만 유지한다. 전체 프로젝트 맵: `/CLAUDE.md`.

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
