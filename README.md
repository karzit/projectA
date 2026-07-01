# Canvas 카드 게임 (커스텀 룰셋)

웹 Canvas 기반 2인 카드 게임. TypeScript로 작성된 **결정론적 헤드리스 룰 코어**
(`src/rules`)와 그 위에 얹힌 **Canvas UI 클라이언트**(`src/client`)로 이루어진다.
사용자가 직접 설계 중인 커스텀 룰셋이 게임의 본체다.

```
input → intent(RulesAction) → Game.apply(action) → GameState 스냅샷 → Canvas 렌더
```

## 빠른 시작

```bash
npm install
npm run dev         # vite 개발 서버 (src/rules 클라이언트)
npm test            # vitest — 전체 테스트
npm run typecheck   # tsc --noEmit (실질적 정합성 게이트; vite build는 타입체크 안 함)
npm run build       # vite 프로덕션 빌드
```

## 구성

| 디렉터리 | 역할 |
|----------|------|
| **`src/rules/`** | **활성 룰 코어.** 사용자가 설계 중인 커스텀 룰셋. 헤드리스 · 결정론적 · 테스트 완비. `Game.apply(action)`만이 상태를 바꾼다. |
| **`src/client/`** | **Canvas UI.** `src/rules`를 구동하는 브라우저 클라이언트. `npm run dev`가 이걸 띄운다. |
| `src/engine/` | **레거시 참조 구현.** 아래 참조. |
| `tests/` | vitest 스펙 (`rules*.test.ts`가 활성 룰셋). |

활성 개발은 **`src/rules` + `src/client`**에서 일어난다. 룰 설계·구현의 권위 있는
현황은 [`src/rules/README.md`](src/rules/README.md), 로드맵은
[`src/rules/PLAN.md`](src/rules/PLAN.md)를 본다.

## 룰 요약

- 코스트 없음. 덱 15장, **시작 시 전부 손패**, 필드는 비어 있음.
- **패배:** 턴 종료 시 필드가 빈 플레이어가 패배.
- **전장 그리드:** 전열 5칸(0–4) + 후열 4칸(5–8), 셀당 최대 1유닛.
- **전투는 힘(power) 기준**, 1:1 비교. **협공**(인접 아군 합산 방어), **지략**
  (상대 지혜 카드 자동 봉쇄) 등 반응 메커니즘.
- **배경**(play 조건) / **환경**(type→value 맵) / **지혜**(소모 자원이 아닌 임계 조건).

자세한 규칙은 [`src/rules/README.md`](src/rules/README.md)에 있다.

## 아키텍처 노트

- **결정론.** 룰 코어는 순수하다. 랜덤은 상태에 저장된 시드 PRNG에서 나온다.
  같은 시드 + 같은 액션열 ⇒ 동일한 게임.
- **단방향 흐름.** UI/입력은 상태를 직접 바꾸지 않고 `intent`(`RulesAction`)를
  발행한다. `App.ts`의 `game.apply` 호출이 온라인 대전 시 WebSocket 전송으로
  교체될 이음새다.
- **카드는 자기완결적.** 카드 하나 = `cards/defs/*.ts`의 `Card`/`UnitCard`
  서브클래스 파일. 동작은 오직 `Board` 메서드를 통해서만 보드를 건드린다 —
  카드를 추가해도 엔진 분기가 늘지 않는다.
- **책임 분리.** `src/rules`에서 읽기(`queries.ts`) / 쓰기(`gameMut.ts`) /
  정책(`conditions.ts`)이 분리돼 있다.

## `src/engine/` — 레거시 참조 구현 (MTG 스타일)

프로젝트 초기의 **참조용 아키텍처 예시**로 만든 MTG 스타일 헤드리스 엔진이다.
zone / 마나 / priority / 스택(LIFO) / state-based action / 트리거 등을 모델링한
데이터 주도 리듀서(`reduce(state, action) -> {state, events, error?}`)를 담고 있다.

**현재는 게임 본체와 거의 무관하다.** 원래 `src/client`가 이 엔진을 구동했지만
이후 `src/rules`로 옮겨갔고, 이 엔진은 구동하는 클라이언트가 없다. 초기 설계
레퍼런스로만 남겨 두며, **룰셋 변경을 여기에 반영하지 않는다.** 커스텀 룰 작업은
모두 `src/rules`에서 한다.
