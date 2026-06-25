# 구현 계획 (세션 간 인계용)

> 작성 2026-06-25. 다른 세션이 **순서대로** 이어받아 구현한다. 각 단계 완료 시
> 체크하고, 설계가 바뀌면 이 파일을 갱신할 것. 권위 있는 규칙 현황은 `README.md`.

## A. 지략(cunning) — ✅ 구현 완료 (2026-06-25)

**규칙**: 상대가 `{need:'wisdom', amount:N}` 배경을 가진 카드를 낼 때, 내 전장에
**지략 ≥ N** 이고 이번 턴 미사용인 유닛이 있으면 → 그 카드 봉쇄. 해당 유닛의 지략을
1회 소진하고, 그 카드는 상대의 이번 턴 동안 잠금(다시 못 냄). 유닛당 턴 1회.

- 지략은 **능력치 합산 대상이 아님** → `StatName`에 넣지 말 것. 별도 `cunning` 필드.
- **v1은 자동 봉쇄**: 봉쇄 가능하면 항상 발동(지략 소진). "취소할 수 있습니다"의
  선택(opt-in)은 상호작용 프로토콜(B-3) 이후로 미룸.
- 임계값은 **지략 ≥ 요구치**(이상). 봉쇄 대상은 **상대 카드만**.

### 단계 (레이어 순서 — 반드시 이 순서로)

- [x] 1. `types.ts`: `UnitInstance.cunning: number`; `GameState`에
      `cunningUsedThisTurn: string[]`, `lockedThisTurn: Record<PlayerId, string[]>`.
- [x] 2. `cards/Card.ts`: `CardMeta.cunning?: number` (초기 지략).
- [x] 3. `gameMut.ts`: `placeUnit`에서 `cunning: def.cunning ?? 0` 초기화;
      `grantCunning`/`spendCunning`/`resetCunningTurn`; `createGame`에 새 필드;
      `_endTurn`에서 `resetCunningTurn` 호출.
- [x] 4. `queries.ts`: `cunningOf(id)`; `cunningBlockerFor(state, opponent, amount)`
      → 미사용 + 지략≥N 인 봉쇄 유닛 id 또는 null; `isCardLocked`.
- [x] 5. `gameCore._play`: wisdom 배경마다 상대 봉쇄 검사. 잠긴 카드 선검사(`fail`).
      봉쇄 시 `spendCunning` 후 **`Blocked` 예외** — 일반 `Illegal`과 달리 스냅샷을
      롤백하지 않고 소진/잠금 mutation을 커밋한 채 에러 반환(+ replay 위해 로그).
- [x] 6. `Board.ts`: `grantCunning` mediator 메서드 + `UnitHandle.cunning`/`grantCunning`.
- [x] 7. 테스트: `tests/rules-cunning.test.ts` — 봉쇄 성공/실패, 1회 소진, 카드 잠금,
      턴 넘기면 해제 (5 tests).

> 구현 노트: 봉쇄는 "실패한 플레이"지만 **상태를 바꾼다**(지략 소진·카드 잠금).
> 기존 롤백 아키텍처(Illegal→스냅샷 복원)와 충돌하므로 `Blocked` 예외를 신설해
> `apply()`가 롤백 없이 커밋 후 에러를 반환하도록 했다.

## B. 후속 (지략 이후, 순서대로)

- [x] B-1. **영웅담 테마 카드** ✅ (2026-06-25): 모험의 시작 / 용사 / 슬라임 /
      킹슬라임(지략4) / 퀘스트-슬라임토벌 / 기본 체력물약 — 6장 구현 + 등록.
      `tests/rules-heroic.test.ts` (6 tests). 새 primitive: `gameMut.addToHand` +
      `Board.addToHand`. 슬라임은 1/0으로 통일(문서의 '1/1 슬라임' 표기 무시).
      서유기 테마(미후왕 진행 체인/투전승불 지혜합→지략)는 별도 후속으로 미구현.
- [x] B-2. **남은 pending rules 결정** ✅ (2026-06-25):
      · 협공 동점 → **전원 생존**(`>=`).
      · 동시 전멸 → **턴 종료자(pass한 자) 패배** (`checkLoss(state, turnEnder)`).
      · 부활 의식 → 전용 카드 **부활 의식**(`revival-ritual`) 5회 플레이 → 마왕 강림.
      `tests/rules-pending.test.ts` (4 tests). README "Open assumptions" 갱신.
- [x] B-3. **상호작용 선택 프로토콜** ✅ (2026-06-25): `ctx.choices.request({from,
      min,max,prompt})` → 부족/불법 시 `ChoiceRequired` → `Game.apply` 롤백 후
      `{state, choiceRequest}` 반환 → 같은 play 액션에 choices 채워 재전송(onPlay 재실행).
      혁명(up-to-N) / 기본 체력물약(1 타겟)을 전환. `tests/rules-choice.test.ts` (6).
      App.ts에 최소 가드(B-4에서 본격 피커 UI).
      ⚠️ **지략 opt-in은 미구현** — 비활성 플레이어 리액션이라 reaction window 필요(후속).
- [ ] B-4. **클라이언트 UX** 다듬기 (선택 프로토콜 UI 포함).

## C. 앱/클라이언트 로드맵 (2026-06-25 추가)

> A/B는 룰 엔진(`src/rules`) 작업. C는 앱·화면·메타게임 작업(`src/client` 중심).
> 둘은 병렬 가능하나, C는 아래 우선순위 순으로. UI 정비(C-4)·오디오(C-5)는
> 의도적으로 뒤로 미룸(구체안 미정).

### 화면/구조 (우선)

- [ ] C-1. **로비 도입.** 현재 로드 → 곧장 게임(메뉴 오버레이만 있음). 로드 완료 시
      **로비 화면**으로 진입하도록 변경. 로비 = 허브: [솔로 플레이] / [덱 편성] /
      [환경설정] 진입점. 화면 전환을 명시적 상태(`screen: lobby|deck|game|settings`)로.
      `ui/Overlay.ts`의 menu/loading/game-over 위에 로비 스크린 추가, `App.ts`가
      화면 상태 소유.
- [ ] C-2. **솔로 플레이.** 로비 → 솔로 플레이 → 덱 선택 → AI(또는 더미) 상대로 게임
      시작. 멀티플레이는 **추후/보류**(App.ts의 `game.apply` 자리가 WebSocket 시seam —
      지금은 로컬 솔로만). 최소: 상대 턴 자동 진행(간단 AI 또는 패스).
- [ ] C-3. **덱 편성 화면.** (a) 수집한 카드 목록 보기, (b) 덱 편성(15장),
      (c) 편성된 덱 목록 보기, (d) 덱 이름 수정. 저장은 localStorage(우선),
      `decks.ts` PRESET_DECKS를 사용자 덱 저장소로 확장. 카드 풀 = CardRegistry.

### 뒤로 미룸 (구체안 나오면 진행)

- [ ] C-4. **UI/전체 디자인 개선.** 구체적 개선안 미정 → 보류. 방향 정해지면 착수.
- [ ] C-5. **오디오 요소.** BGM/효과음. ResourceManager에 오디오 로딩 확장 지점.
      구체안 미정 → 보류.

### 설정

- [ ] C-6. **환경설정.** 로비에서 진입. 초기 후보: 음량(오디오 도입 후), 언어(미정),
      애니메이션/속도 등. 항목 확정 후 구현.

### D. 룰·게임플레이 점검 (지속)

- [ ] D-1. **재미/방향성 점검.** 솔로 플레이(C-2)가 돌면 실제 플레이로 밸런스·재미
      검토. 협공/지략/진행 체인이 게임을 재밌게 만드는지, 승패 조건(전장 비우기)이
      잘 작동하는지. B-2의 pending rules 결정과 연동. 결과를 README/PLAN에 반영.

## 검증
각 단계: `npm test` + `npm run typecheck`. 브라우저 변경 시 preview 도구.
