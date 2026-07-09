# 구현 계획 (세션 간 인계용)

> 작성 2026-06-25. 다른 세션이 **순서대로** 이어받아 구현한다. 각 단계 완료 시
> 체크하고, 설계가 바뀌면 이 파일을 갱신할 것. 권위 있는 규칙 현황은 `README.md`.

---

## ✅ 완료된 섹션 요약

| 섹션 | 내용 | 완료일 |
|------|------|--------|
| A | 지략(cunning) — 봉쇄 로직, 테스트 | 2026-06-25 |
| B-1 | 영웅담 테마 카드 6종 + 테스트 | 2026-06-25 |
| B-2 | 협공 동점/전멸/부활 의식 pending rules | 2026-06-25 |
| B-3 | 상호작용 선택 프로토콜 (choices) | 2026-06-25 |
| B-4 | 클라이언트 UX — 선택 모드 UI | 2026-06-26 |
| C-1 | 로비 도입 (screen 상태 관리) | 2026-06-26 |
| C-2 | 솔로 플레이 (SimpleAI) | 2026-06-26 |
| C-3 | 덱 편성 화면 (DeckEditor + localStorage) | 2026-06-26 |
| C-4 | 카드 호버 패널 개선 | 2026-06-26 |
| C-7 | AI 개선 (전투 시뮬, 선택 처리) | 2026-06-26 |
| C-8b | 카드 desc·스탯 오버레이 | 2026-06-26 |
| C-8c | 행동 불가 피드백 (토스트, dim) | 2026-06-26 |
| C-8d | 카드 효과 수정 (용사, 미후왕) | 2026-06-26 |
| C-9 | 환경 UI 표시 (HUD 칩) | 2026-06-26 |
| C-10 | 게임 중 메뉴 + 항복 | 2026-06-26 |
| C-11 | 로그 패널 토글 | 2026-06-26 |
| C-12 | 턴 전환 연출 (BannerSystem) | 2026-06-26 |
| C-13 | 플레이 카드 연출 + 카드 크기 확대 | 2026-06-26 |
| C-14 | 카드 상호작용 효과·애니메이션 | 2026-06-26 |
| C-15 | 카드 효과·전투 연출 강화 (ParticleSystem) | 2026-06-29 |
| E-1~E-8 | 전장 그리드 (전열5·후열4, 이동, 협공 인접) | 2026-06-26 |
| G-1 | settle loop FIFO 검증 — 이미 올바름 | 2026-06-26 |
| G-2 | 리팩터링 불필요 (G-1에서 확인) | 2026-06-26 |
| G-3 | 연쇄 트리거 테스트 (`rules-settle.test.ts`, 9 tests) | 2026-06-26 |

현재 테스트: **164/164 통과** (13 파일, `src/engine` 삭제로 엔진 전용 테스트 5개 제거).

### 2026-07-03 `src/engine`(레거시 MTG 스타일 참조 엔진) 완전 삭제

- 게임 본체와 무관해진 지 오래된 레거시 코드라 사용자 요청으로 디렉터리 전체
  삭제. `src/engine/`(13개 파일) + 이를 구동하던 테스트 5종(`engine.test.ts`,
  `stack.test.ts`, `combat.test.ts`, `triggers.test.ts`, `tests/helpers.ts`)
  제거. `rules*.test.ts`는 전부 `src/rules`만 사용해 영향 없음.
- 문서에서 "두 코드베이스(활성=rules/client, 레거시=engine)" 프레이밍 제거 —
  루트 `CLAUDE.md`/`README.md`, `src/client/CLAUDE.md`, `src/rules/CLAUDE.md`,
  `src/rules/README.md`에서 engine 언급 정리. `package.json` description도
  "MTG-style" 문구 제거.
- `npm test`(164/164) + typecheck 클린.

### 2026-07-03 D-2 구현: 미공개 유닛은 배경 조건·공격에서 존재하지 않는 것으로 취급

- **`queries.isRevealed(state, unitId)` 신설**: `pendingPlays`/`openingPlays`
  큐에 해당 `unitId`가 남아 있으면 미공개. `개입`/강제 효과로 즉시 처리된
  카드는 애초에 큐에 안 남으므로 항상 공개 상태.
- **존재 판정 계열에 반영**: `unitsOnSide`(→ `wisdomOnSide`/`maxWisdomOnSide`/
  `hasPowerAtLeastOnSide`가 사용), `hasUnitNamed`, `hasUnitWithCardOnField`,
  `hasKeywordOnAnyField` 전부 미공개 유닛을 풀에서 제외 — 배경 조건 판정이
  자동으로 미공개 유닛을 못 본다.
- **공격 계열에 반영**: `canAttack`(공격자 자신이 미공개면 불가),
  `attackableTargets`(공격자·대상 양쪽 미공개 제외), `coopBlockersFor`(미공개
  유닛은 협공 블로커 후보에서 제외).
- **버그 수정 (부수 발견)**: `#maybeStartMain`이 오프닝 처리 후 `openingPlays`
  큐를 비우지 않고 있어서, 메인 페이즈 시작 후에도 오프닝에 낸 유닛이 영구히
  "미공개" 취급되던 회귀를 유발할 뻔함 — 처리 루프 끝에 큐를 비우도록 수정.
- **테스트 갱신**: 기존 "오프닝에 낸 유닛은 같은 오프닝 내 후속 배치 배경
  조건에 즉시 인식된다"는 테스트가 새 설계와 정면으로 충돌해 뒤집음(같은
  오프닝에서 낸 카드는 아직 큐에 남아 미공개이므로 이제 실패해야 정상) —
  제목·assertion 모두 D-2에 맞게 갱신. 신규 회귀 테스트 2종 추가
  (`rules-journey.test.ts` "D-2 미공개 유닛 취급": 미공개 삼장법사로 사오정
  못 냄 + 공개 후 가능, 미공개 유닛은 이번 턴 공격 불가 + 공개 후 가능).
- 문서 갱신: `src/rules/README.md`("미공개(unrevealed) 유닛 (D-2)" 절 신설),
  루트 `CLAUDE.md`.

### 2026-07-03 이동 인터랙션 + 행동 불가 체인 + AI 선택 격리 (게임 디자인 검토 후속 3)

- **이동(move)이 클라이언트에서 전혀 불가능했던 버그 수정** (`InteractionLayer.ts`):
  룰 엔진(`gameCore.ts`)엔 `move` 액션이 있고 로그 처리도 있었는데 입력 레이어가
  move intent를 한 번도 emit하지 않았음. 유닛 선택(attackPending 진입) 조건을
  `canAttack` 단독에서 `canActAtAll`(공격 또는 인접 빈 칸 이동 가능)로 확장,
  선택 후 인접 빈 칸 클릭 시 `move` intent를 emit하는 `tryMoveClick` 추가.
  추가로 `onDown`이 카드 아닌 클릭을 무조건 attackPending 취소로 처리해 이동
  목적지 클릭 자체가 씹히던 버그도 같이 수정(`canMoveTargetAt`으로 이동 후보
  칸이면 취소 보류). **우클릭 컨텍스트 메뉴·칸 점유 시 스왑은 아직 미구현**
  (C-17 나머지 범위).
- **손오공~제천대성 행동 불가 체인 누락 수정**: 테마 스펙상 미후왕~제천대성
  전부 "행동 불가"인데 실제론 `cannotAttack`만 있고(미후왕 제외) `cannotMove`가
  하나도 없어서 진화 후 정상적으로 공격/이동이 가능했음. 네 카드
  (`MonkeyKing`/`SonWukong`/`Pilmaon`/`JeCheonDaeSung`) 모두 `cannotMove: true`
  추가 (`evolveTo`가 진화마다 `initialKeywords`로 키워드를 재계산하므로 체인
  전체에 자동 반영).
- **AI 자신의 choice request가 사람에게 뜨던 버그 수정** (`InteractionLayer.ts`
  `beginChoosing`): `choice:request`의 `player`가 로컬 사람이 아니면(= AI 자신의
  카드 선택) 사람 쪽 선택 UI에 진입하지 않도록 가드 추가. 기존엔 SimAI가 이미
  자기 몫을 자동 처리하는데도 사람 쪽 UI가 같이 떠서 상대 턴에 사람이 선택을
  강요당했음.
- **`CardHoverPanel.ts` 배경 칩 개선**: `unitWisdom`/`dead` 조건이 switch에서
  빠져 있어 라벨이 "?"로 표시되던 문제 수정, `unit` 조건 칩에 `side` 접미어
  ((아군)/(상대)) 표시 추가(엔진은 이미 side 스코프 적용했는데 UI 라벨이 안
  보여줘서 왜 막히는지 알 수 없었음), 진화 대상(`evolveTarget`) 미리보기 칩
  ("▣ 진행 대상" 섹션)을 신설해 손오공/전단공덕불 같은 토큰 카드도 클릭해서
  스탯을 확인 가능하게 함.
- 브라우저(Chrome MCP, 이미 떠 있는 5173 포트)로 이동·행동불가·AI 선택 격리
  모두 실제 클릭 검증 완료. 테스트 184/184, typecheck 클린.

### 2026-07-02 저오능/사오정 side 스코프 + 프리셋 덱 정비 (게임 디자인 검토 후속 2)

- **저오능/사오정 배경을 `unit` 조건 + `side: 'own'`으로 수정**: 기존엔 상대
  필드의 삼장법사로도 배경이 충족됐음(`PlayCondition`의 `unit` 케이스가 side를
  안 받았음). `types.ts`의 `unit` 조건에 `side?` 필드 추가, `hasUnitNamed`가
  `player`/`side`를 받게 시그니처 변경, `conditions.ts`에서 전달. 위대한 불은
  세션 21 결론(덱 카피 수가 빈도를 잡는다) 유지로 부동 미부여 그대로 둠.
- **클라이언트 프리셋 덱 전면 교체** (`src/client/decks.ts`): 기존 `monkey`(우공이산
  버그로 죽어있던 덱)·얇은 `heroic`을 폐기하고 4종으로 재구성 — `basic`(바닐라
  대조군), `heroic`(용사 레벨업+결속/액티브+교회+성검+모험의 시작→마왕 체인),
  `journey`(삼장법사+저오능+사오정+미후왕 — 여정 완주 시 두 진화 체인이 동시에
  발동), `cult`(사교의 의식→첫~마지막 의식 희생 체인→사특한 신). 각 15장, 헤드리스
  스모크 테스트로 실제 체인이 완주되는지 확인(journey: 3턴 만에 전단공덕불 진화
  + 상대 전장 제거로 승리, cult: 사교도 8장+첫 번째 의식 패에 확보 — 둘 다 확인 후
  임시 테스트 삭제).
- 테스트 3종 추가 (`rules-journey.test.ts`: 저오능/사오정 상대 삼장법사 배경 거부 2,
  아군 삼장법사 배경 허용 1).

### 2026-07-02 룰 수정 3건 (게임 디자인 검토 후속)

- **우공이산 환경 타입 수정**: `지형:산` → `장소:산`. 미후왕의 배경(`장소:산`)과
  타입이 어긋나 미후왕이 게임 내 어떤 수단으로도 플레이 불가였던 버그 —
  원숭이 진화 체인 전체가 봉인되어 있었다.
- **패배 판정 시점 이동**: 기존엔 `#finishEndTurn`이 settle **전에** 판정해,
  종말+복수자 조합에서 복수자가 소환되고도 시전자가 패배했다. 이제 턴 종료
  효과·강제 능력이 모두 정산된 뒤(상대 턴 시작 전) 판정하고, **패배 확정 시
  다음 턴을 시작하지 않는다** (turnStart 미발행).
- **공격 사거리 차폐 도입**: 기존 `ATTACK_TARGETS`(상대 전열만 타격 가능 —
  후열이 절대 안전지대)를 `ATTACK_LANES` + 차폐 모델로 교체. 유닛이 있는 칸만
  거리로 세고 빈 칸은 거리 0: 후열 공격자는 아군 전열에 가로막히고, 상대
  전열이 빈 레인으로는 상대 후열까지 직접 공격 가능. `attackableTargets`가
  단일 소스라 gameCore 검증·SimAI 모두 자동 반영.
- 테스트 7종 추가 (`rules-loop.test.ts`: 미후왕 플레이, 패배 판정 타이밍 2,
  사거리 차폐 4). 문서 갱신: `RULES.md`, `src/rules/README.md`, 루트 `CLAUDE.md`.

### 2026-07-02 문서 현행화 (MTG 엔진 레거시화 반영)

- **배경**: `src/engine`(MTG 스타일)은 초기 참조 예시였고 지금은 게임 본체와
  거의 무관해짐. 문서가 이를 반영하지 못하고 있었음.
- **수정**: 루트 `README.md` 전면 재작성(MTG 엔진 소개 → 커스텀 룰셋 Canvas 게임
  소개 + engine을 "레거시 참조 구현" 절로 격하). 루트 `CLAUDE.md`의 "Two
  codebases" 프레이밍을 "활성=rules/client, 레거시=engine"으로 조정 + stale
  테스트 수(48→172) 갱신. `src/engine/CLAUDE.md` 헤더를 레거시로 명시.
- `src/rules`는 삭제/이동 없음 — 문서 프레이밍만 정리.

### 2026-06-29 룰 변경: 카드 장수 제한 제거 + 개입 키워드

- **카드 장수 제한 제거**: 턴당 1장 → 제한 없음. `playedThisTurn` 필드 삭제.
- **턴 종료 처리**: `play` 액션 시 카드는 `pendingPlays` 큐에 쌓이고, `pass` 시 순서대로 `onPlay` 처리.
  유닛 소환(필드 배치)은 여전히 즉시 처리.
- **`개입` 키워드**: 해당 키워드가 있는 카드는 큐 건너뛰고 즉시 `onPlay` 처리 (예: 기본 체력물약).

### 2026-07-01 협공 reaction window 버그 수정

- **문제**: `attack` 액션의 `blockers`를 공격자가 지정하는 구조라 PvP에서 협공이
  죽은 메커니즘이었음(공격자가 자청해서 블로커를 모을 리 없음).
- **수정**: 지략 opt-in과 동일한 reaction 패턴 적용 — `attack`은 attacker/target만
  받고, 협공 가능한 수비 유닛이 있으면 `state.pendingAttack`을 설정해 보류한 뒤
  수비측의 새 액션 `resolveAttack`(`blockerIds`)을 기다린다. 상세는 `README.md`
  "협공 reaction window" 절. `src/client`(App.ts/InteractionLayer.ts)도 엔진의
  `attackReactionRequest`를 받는 정상 흐름으로 갱신(기존 클라이언트 단 가로채기 제거).
- 테스트: `tests/rules-loop.test.ts`, `tests/rules-pending.test.ts`,
  `tests/rules-enemy-chain.test.ts`의 협공 관련 테스트 갱신. 브라우저로 AI-수비/사람-수비
  양쪽 경로 수동 검증 완료.

---

## 남은 작업

### C. 앱/클라이언트

- [ ] **C-8.** 카드별 이미지. 카드 14종 일러스트 생성·적용. CardSprite 렌더 교체.
      이미지 미완성 시 현재 placeholder 유지.
- [ ] **C-4b.** 전체 디자인 개선. 로비·버튼·보드 전반 게임 테마에 맞는 디자인.
      구체 시안 나오면 착수.
- [ ] **C-5.** 오디오. BGM/효과음. 구체안 미정 → 보류.
- [ ] **C-6.** 환경설정. 음량(오디오 도입 후), 애니메이션 속도 등.
- [x] **C-16.** ✅ 2026-07-03. SimpleAI 판단 개선. `#bestAttack`의
      `desperate = foeUnits.length >= myUnits.length` 조건이 필드 유닛 수만
      비슷해도 참이 되어, 손해 보는 공격(강한 유닛을 공격해 본인 유닛만 소모)도
      그대로 실행되던 게 원인. 이 휴리스틱을 제거하고 공격 시뮬레이션 결과에서
      **실제 적 유닛 처치 여부(`kills`)**로 대체 — 점수가 baseline보다 낮아도
      적을 실제로 죽였다면(동귀어진 등 교환 성립) 채택하고, 아무것도 못 죽이는
      순손실 공격은 거부해 pass로 넘어감. `#simulateAndScore`를 결과 state까지
      반환하는 `#simulate`로 리팩터링. `npm test`(164/164)+typecheck 클린.
      (`src/client/SimAI.ts` — client 코드라 rules 테스트 대상 밖, 브라우저
      preview 인프라 문제로 실제 플레이 검증은 사용자가 직접 확인.)
- [x] **C-17.** 유닛 클릭 시 공격/이동을 명시적으로 고르는 행동 메뉴. **완료
      (2026-07-03):** 우클릭 컨텍스트 메뉴 대신 **클릭 시 뜨는 플로팅 버튼 메뉴**
      (⚔ 공격 / ➤ 이동)로 구현 — 유닛을 클릭하면 바로 공격 대상 선택으로 들어가는
      대신 `actionMenu` 모드가 떠서 사용자가 행동을 먼저 고른다. 새 모드 2개
      (`actionMenu`, `movePending`)를 `InteractionLayer`/`InteractionOverlay`에
      추가: 공격 선택 → 기존 `attackPending`(적 유닛 클릭 → 공격), 이동 선택 →
      `movePending`(인접 빈 칸이 점선 하이라이트로 표시되고 클릭 → 이동). 버튼은
      해당 행동이 불가능하면(`canAttack`/인접 이동 가능 칸 없음) 흐리게 표시되고
      클릭이 무시된다. 브라우저(Chrome MCP, localhost:5173)로 이동·공격 양쪽 다
      실제 클릭까지 검증 완료 — 이동 시 아군 인접 빈 칸 하이라이트, 공격 시 대상
      클릭 → 전투 정상 처리(로그로 확인).
      **부수 발견 버그 수정:** 이동 애니메이션 검증 중
      `ParticleSystem.draw`가 `IndexSizeError`(음수 반지름)로 매 프레임 던져
      렌더 루프가 멈추는 버그를 발견 — 지연 발동 링(`born: now + delay`)이 아직
      시작 전(`t < 0`)인데도 그려지면서 반지름이 음수로 계산됨. `t < 0`이면
      그리지 않고, 반지름은 `Math.max(0, ...)`로 방어하도록 수정
      (`ParticleSystem.ts`).
      **스왑 이동 추가 (2026-07-03):** 이동은 이제 인접 칸이 비어 있지 않아도
      가능 — 아군 유닛이 있으면 실패 대신 **두 유닛의 위치를 맞바꾸고, 둘 다
      이번 턴 행동(`actedThisTurn`)을 소모**한다. `queries.canMove`가 점유 칸일
      때 점유 유닛도 행동 가능(미행동·비함정·`cannotMove` 아님) 조건을 함께
      검사하고, `gameMut.swapUnits` + `gameCore.#move`가 점유 시 스왑 분기를
      탄다. 클라이언트는 `InteractionLayer.tryMoveClick`이 빈 칸 히트 실패 시
      카드 히트(점유 유닛)를 폴백으로 확인하도록 확장. 테스트 갱신
      (`rules-loop.test.ts`: 점유 셀 이동 → 스왑+행동 소모 확인, 이미 행동한
      유닛과는 스왑 불가).
- [x] **C-18.** ✅ 2026-07-03. 오프닝 단계에서 배경(조건) 미충족 카드 dim 처리.
      `BoardRenderer.#dimAlpha`가 기존엔 `state.phase !== 'main'`이면 무조건
      dim을 건너뛰어 오프닝 중엔 배경 미충족 카드도 항상 정상 밝기였음 — 오프닝
      phase 분기를 추가해 `openingDone[local]`이 안 끝난 동안 손패 카드에도
      `canPlayId` 체크로 dim(0.45)을 적용(`canPlay`는 phase 무관하게 조건만
      검사하므로 재사용). 브라우저(서유기 덱)로 미후왕(장소:산 미충족) dim,
      돌원숭이(조건 없음) 정상 밝기 확인. `npm test`(187/187) + typecheck 클린.
- [x] **C-19.** ✅ 2026-07-03. 오프닝→메인 전환 시각적 구분. 기존엔 전환 시
      일반 턴 배너(`showTurn`)를 재사용해 이후 매턴 배너와 구별이 안 됐음.
      `BannerSystem.showPhase`(골드색, 2000ms, 서브라벨 포함 — `showTurn`보다
      길고 눈에 띄게) 신설해 오프닝 완료 시에만 사용(`App.ts` finishOpening
      처리부). 추가로 `Hud`의 phase pill에 `phase-opening`(골드)/`phase-main`
      (파랑) CSS 클래스를 토글해 턴 중에도 현재 단계가 상시 표시되도록 함
      (`styles.ts`). 브라우저(`window.app` 통해 intent 직접 발행)로 pill 색상
      전환 확인. `npm test`(187/187) + typecheck 클린.

---

### D. 룰·게임플레이 점검

- [ ] **D-1.** 재미/방향성 점검 — AI 자동 대전(`tests/ai-balance.test.ts`, SimAI/MctsAI
      양쪽에 실제 룰 엔진을 붙여 대량 시뮬레이션) 기반으로 22회차(2026-07-03~09)에
      걸쳐 진행. 상세 회차별 로그는 **[`D1-playtest-log.md`](./D1-playtest-log.md)** 참조.
      요약:
      - **버그 수정으로 해소된 것**: 협공 reaction window 미해석, 오프닝 휴리스틱의
        콤보 전용 카드 허탕, 상대 필드에 유닛을 선물하는 카드 체인을 AI가 못 읽던
        문제(demon-lord 체인), `checkLoss`가 턴 종료자 아닌 양쪽 필드를 검사하던
        선공 즉사 버그, 사제 능력 라이브락, 이동/공격 평가 순서 라이브락, 트랩 유닛의
        사거리 차폐 버그, SimAI의 무의미 행동 반복(cycle) 라이브락, cult 셋째 의식을
        AI가 안 쓰던 평가 함수 자기모순(reserveExempt 도입) 등 — 전부 코드 수정으로
        해결, 안전판(무한 교착) 0/540 게임까지 확인.
      - **사용자 결정으로 규칙에 반영된 것**: 환경(환경) 전역 공유는 의도된 설계(변경
        없음). 협공 벽처럼 "성립하는 공격이 없는" 진짜 교착을 강제 종료하기 위해
        **황폐(소모전, 35턴부터 매 턴 필드 전체 -1힘)** 규칙 신설. 오행산(trapped)
        유닛이 매 턴 자진 재입산해 황폐를 영구 회피하는 것을 막기 위해 트랩 유닛을
        미공개 유닛과 동일하게(배경/공격/협공/패배판정에서 비존재) 취급하도록 확장.
      - **조사했지만 미해결/사용자 판단 대기로 남은 것**: 미러전 선공 우세(journey는
        후공이 오히려 유리, heroic·cult 미러는 선공 압도), heroic이 압도적 1강으로
        보이는 덱 파워 서열 재역전(카드 밸런스 문제 vs 현재 AI 수준의 한계 구분
        필요), cult가 heroic·journey 상대로 미러전 외엔 거의 못 이기는 근본 상성
        격차, cult 마지막 의식의 "합6 유닛 6마리" 요구가 완주 병목으로 지속.
      - **사고 기록**: 13회차에서 `git checkout -- file`로 두 파일의 미커밋 작업을
        전부 유실할 뻔했다가 dangling stash로 복구([[git-checkout-file-danger]]).
      - 재미 자체(협공/지략/진행 체인이 실제로 재밌는지)의 최종 판정은 여전히
        사람이 직접 플레이해야 함 — AI 시뮬레이션은 밸런스/버그 신호까지만 제공.

- [x] **D-2.** ✅ 2026-07-03. "공개"(pendingPlays 처리) 전 유닛은 배경 조건·
      공격 대상 모두에서 없는 것으로 취급하도록 수정 완료. 상세는 위 "2026-07-03
      D-2 구현" 절 참조.

---

### F. 서유기 테마 카드셋 ✅ 2026-06-26

> 미결 항목 확정 후 구현 착수. 신규 Board 프리미티브 필요.

**미결 정의 (구현 전 반드시 결정)**

- **오행산 상태**: `GameState.trapped: string[]` 추가 여부. 삼장법사의 "꺼낸다" = trapped 해제 후 진행.
- **구원 효과**: "무작위 적을 구원합니다" = `exitUnit` (전장 이탈, 컨트롤 탈취 아님)로 확정.
- **패악질 2번 효과 주체**: "힘/지혜만큼 잃습니다"의 주체 = 피격 아군 유닛 — 확정 필요.
- **삼장법사 진행 시 손행자 이탈 여부**: 진화 제외 조건 명시 필요.
- **저오능 발동 조건**: 삼장법사 power=0이므로 "공격" 대신 "행동"으로 변경 검토.

**신규 프리미티브 (Board/gameMut 확장)**

- `Board.evolve(unitId, newCardId)`: 스탯 유지하며 카드 교체
- `Board.trap(unitId)` / `Board.untrap(unitId)`: 오행산 상태 토글
- `Board.moveToCell(unitId, cell)`: 삼장법사 여정 (E단계 `moveUnit` 재활용 가능)
- `Board.lockHandCard(player, cardId)`: 패악질 1번 효과 (기존 있으면 확인)

**카드 목록**

그룹 1 — 미후왕 체인:
- [x] F-1. 패악질 헬퍼 `Board.mayhemOne` / `Board.mayhemAll`
- [x] F-2. 미후왕 [7/3] (stats 수정) → 손오공
- [x] F-3. 손오공 [12/9] → 필마온
- [x] F-4. 필마온 [13/6] → 제천대성
- [x] F-5. 제천대성 [15/10] → 손행자 (trap self on turnStart)
- [x] F-6. 손행자 [15/10] → 투전승불 (삼장법사 소멸 시 이탈)
- [x] F-7. 투전승불 [92/92] turnEnd exitUnit(구원)
- [x] F-8. 수보리조사 [4/8] onPlay 진행+이탈. **2026-07-03 확정:** 배경(play
      condition) 없음 — 아군 미후왕이 없어도 낼 수 있고, 그 경우 `onPlay`가 진행시킬
      대상이 없어 자신만 이탈하며 허탕. (커밋 안 된 이전 작업에서 `배경:미후왕`
      조건에 `side:'own'`을 붙인 상태였는데, 조건 자체를 없애는 쪽으로 결정하며
      제거함.)

그룹 2 — 삼장법사 순례단:
- [x] F-9. 삼장법사 [0/10] → 전단공덕불 (여정 이동, cell=0 전 유닛 진행). **2026-07-03:**
      `cannotAttack` 제거 — 이제 공격 가능(단, 힘 0이라 상대 힘 0 유닛이 아닌 한
      공격하면 자멸).
- [x] F-10. 전단공덕불 [80/80] turnEnd exitUnit(구원)
- [x] F-11. 저오능 [10/6] → 정단사자 (삼장법사 대신 전투)
- [x] F-12. 정단사자 [50/50] turnStart 환경 제거
- [x] F-13. 사오정 [10/12] → 금신나한 (삼장법사 대신 전투)
- [x] F-14. 금신나한 [60/60, 지략 30]

테스트: `tests/rules-journey.test.ts` ✅ 23 tests

---

## 검증

각 단계: `npm test` + `npm run typecheck`. 브라우저 변경 시 preview 도구.
