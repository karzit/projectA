// 덱별 AI 특화 설정. MctsAI의 평가 가중치는 범용 기본값을 쓰지만, 덱마다
// "완주해야 할 체인"이 다르므로(용사 퀘스트/원숭이-삼장 순례/의식 제물) 체인
// 진행 상태에 점수를 매겨 AI가 체인 전진을 우선하게 만든다.
// 카드 이름을 직접 나열하지만, 이건 엔진(MctsAI 평가 함수 자체)이 아니라
// "이 덱이 뭘 노리는가"라는 덱 단위 설정이라 CLAUDE.md의 "conditions/keywords만
// 본다" 규약과 충돌하지 않는다(그 규약은 evaluateState 본체에 적용됨).
export interface EvalWeights {
  unitCount: number;
  emptyField: number;
  playable: number;
  risky: number;
  keystoneOpp: number;
  keystoneSelf: number;
  evolve: number;
  heroExp: number;
  cunningBlock: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  unitCount: 3,
  emptyField: 50,
  playable: 2,
  risky: 6,
  keystoneOpp: 4,
  keystoneSelf: 3,
  evolve: 6,
  heroExp: 6,
  cunningBlock: 5,
};

export interface DeckStrategy {
  // 체인 카드별 진행 점수 — 필드에 있으면 전액, 손에 있으면 절반.
  // **뒤 단계일수록 점수를 키울 것.** 균일 점수(구 chainCardIds)의 함정:
  // 체인 스펠을 내면 자기 손패 보너스를 잃고 다음 단계 카드로 같은 보너스를
  // 돌려받아 순이득 0이 되고, 스펠의 부작용(용사 퀘스트는 상대에게 몬스터를
  // 주고, 의식은 아군을 제물로 바침)만 남아 평가상 항상 손해 → AI가 체인을
  // 무기한 미룬다(계측: 모험의 시작 평균 22턴, last-ritual 플레이 0건).
  // 단계마다 점수가 부작용 비용보다 크게 뛰어야 전진 기울기가 생긴다.
  chainCards?: Record<string, number>;
  // 환경 진행 점수 — `${type}:${value}` 키가 현재 환경에 있으면 가산.
  // 전개형 체인(용사 퀘스트)의 진행 마커는 소모된 스펠이 아니라 환경에
  // 남으므로, 체인 스펠이 소모되어도 이 점수가 진행도를 평가에 유지시킨다.
  // 환경은 전역 공유라 상대가 같은 type을 덮으면 점수도 함께 사라진다(의도 —
  // 스토리가 실제로 후퇴한 것).
  envScores?: Record<string, number>;
  // 자기 필드에 항상 비워둘 칸 수. 토큰 생산 엔진(제물준비→희생양) 덱은 필드가
  // 가득 차면 토큰 소환이 그냥 버려지므로(엔진 규칙) 칸을 남겨둬야 체인이 돈다.
  // 부족분 1칸당 페널티가 유닛 하나 더 내는 이득(~10)보다 크게 걸려, AI가
  // 남는 유닛을 손패에 대기시킨다. 부수 효과: 전열부터 채우는 배치 습관과
  // 합쳐지면 빈 칸이 후열에 몰려 토큰(희생양)이 후열 = 차폐 칸에 소환된다.
  reserveCells?: number;
  // reserveCells 판정에서 "비어 있는 것"으로 치는 카드 — 예약이 지키려는 바로
  // 그 토큰(희생양)이 칸을 차지했다고 예약 위반 페널티를 물리면, 토큰을 낳는
  // 행동(제물준비) 자체가 평가상 순손실이 되어 엔진이 영영 안 돈다(계측:
  // second-ritual을 30턴 넘게 들고 sum-2 제물 0~1마리에서 정체 — 제물준비
  // 플레이 자체를 회피). 예약은 "토큰이 아닌 유닛"의 필드 포화만 막아야 한다.
  reserveExempt?: string[];
  // 손패/대기큐에 있는 체인 카드 중, 내는 순간 "상대 전장에 강한 몬스터를 넘기는"
  // 등 큰 위험을 감수하는 카드의 최소 준비 기준 — 카드ID → 요구하는 자기 필드
  // 총 힘. 자기 필드 총 힘이 이 기준에 못 미치면 그 카드의 손패/대기 점수를
  // 비례해서 깎는다(필드에 이미 낸 뒤에는 적용 안 함 — 되돌릴 방법이 없으므로).
  // 실측: heroic이 13턴 만에 마왕성(demon-castle)까지 밀어붙여 cult에게 44/44
  // 마왕을 넘기고, 이후 22턴을 소모전으로 갈리다 턴35 황폐에 패배(로그 3/3판 동일
  // 패턴). 필드가 준비되기 전까지는 그 마지막 한 걸음을 서두를 유인을 줄인다.
  chainGate?: Record<string, number>;
  evalWeights?: Partial<EvalWeights>;
}

const DECK_STRATEGIES: Record<string, DeckStrategy> = {
  heroic: {
    // 퀘스트 스펠 자체는 소모품이라 낮게(보유 유도 정도), 진행의 본체는
    // envScores의 지역/장소 전개. 각 단계의 환경 점프가 "상대 전장에 퀘스트
    // 몬스터를 소환해주는" 재료비(슬라임~마왕 44/44)를 상회하도록 설정 —
    // 마왕성 150은 마왕(힘 44)을 넘겨주고도 순이득이 남는 크기다.
    chainCards: {
      'adventure-start': 6, 'quest-slime': 8, 'fate-awakening': 10, 'quest-labyrinth': 12, 'demon-castle': 14,
      'hero': 10, 'warrior': 10, 'priest': 10, 'mage': 10,
    },
    envScores: {
      '지역:시작의 마을': 15,
      '장소:슬라임 동굴': 30,
      '지역:왕성': 45,
      '장소:지하 미궁': 60,
      '지역:마왕성': 150,
    },
    // demon-castle(마왕성 입성)은 내는 즉시 상대 전장에 힘44 마왕을 헌납한다.
    // 자기 필드 총 힘이 45(마왕과 맞먹는 체급 — 계측 결과 턴9~13에 이미 31~39에
    // 도달해 있어 25 기준은 무의미했다) 에 못 미치면 손패 점수를 비례해 깎는다.
    // 실측(디버그 로그 3/3판, selfPower 계측): 게이트 없이는 13턴 만에(심하면 9턴)
    // 마왕성까지 밀어붙여 22턴을 소모전으로 갈리다 패배.
    chainGate: { 'demon-castle': 45 },
    // 밸런스 계측(2026-07-09, ai-balance-stats 누적 ~800판/덱): 전체 승률
    // heroic 43% vs journey 54% / cult 52%로 heroic만 저조. 특히 heroic이
    // 선공(A)으로 cult와 붙으면 9%(11/123)까지 떨어지는데 cult가 선공일 땐
    // 48%로 정상 범위 — heroic이 선공일 때만 초반에 과다 노출되어 cult의
    // 빠른 제물 스노우볼에 무너지는 패턴으로 보인다. journey는 risky:9로 이미
    // 같은 종류의 위험 회피를 걸어 두고 있고(전체 54%로 양호) 그 값을 그대로
    // 재사용 — 기본값(6)보다 위험한 공격/블록을 덜 시도해 초반 노출을 줄이는
    // 소극적 보정. 다음 주기 계측으로 heroic vs cult 선공 승률이 개선되는지
    // 확인할 것.
    evalWeights: { risky: 9 },
  },
  journey: {
    // 미후왕 진화 체인 본체 + 순례단(체인 후반을 게이트하는 배경 유닛) 보호.
    // 완주율 47%로 이미 동작하는 균일 점수(구 chain:10과 등가)라 손대지 않는다.
    chainCards: {
      'stone-monkey': 10, 'monkey-king': 10, 'son-wukong': 10, 'pilmaon': 10,
      'je-cheon-dae-sung': 10, 'son-haengja': 10, 'tu-jeon-seung-bul': 10,
      'tang-monk': 10, 'sa-o-jeong': 10, 'je-o-neung': 10, 'subori-josa': 10,
    },
    evalWeights: { risky: 9 },
  },
  cult: {
    // 의식 체인(합1→2→3→6)의 각 의식 카드는 다음 단계로 갈수록 2배씩 —
    // 의식 하나를 내면(손패 절반 손실) 다음 의식+사교도 획득이 제물 비용
    // (희생양/사교도 필드 손실)을 덮고도 남아야 전진이 평가상 순이득이 된다.
    // 최종 보상 사특한 신은 죽어도 사교도 사망마다 재소환되는 승리 조건이라
    // 사실상 승리에 준하는 500. 희생양(8)은 힘 0이라 risky 패널티(6)에
    // 밀려 버려지지 않도록 그보다 크게, G선생(4)은 합1 제물로 보유 유도.
    chainCards: {
      'cult-ritual': 6,
      // 제물준비 체인도 단계 점수를 키운다(의식과 같은 원리) — 균일 6이면
      // "prep을 내면 손패 절반(3)을 잃고 다음 prep으로 3을 돌려받아" 순이득 0,
      // 남는 건 희생양의 risky 페널티뿐이라 전진 기울기가 없다. 단계당 +2로
      // prep 플레이 자체가 평가상 순이득이 되게 한다.
      'sacrifice-prep': 6, 'sacrifice-prep-4': 8, 'sacrifice-prep-3': 10,
      'sacrifice-prep-2': 12, 'sacrifice-prep-1': 14, 'sacrifice-prep-0': 16,
      'sacrifice-lamb': 8,
      'g-teacher': 4,
      'stone-monkey': 6, // 합3 제물(2/1) — 세 번째 의식의 희생양 부족분을 메운다
      'cultist': 8,
      // 의식 간 격차가 곧 "의식을 내는 턴"의 평가 순이득이다. 의식은 부동이라
      // 그 턴의 공격 전부(좋은 턴 기준 +30~40)를 포기하는 기회비용이 있으므로,
      // 격차가 그보다 작으면 조건이 다 갖춰져도 공격이 항상 이겨 무한 연기된다
      // (계측: sum-2 희생양 2 + second-ritual 보유 상태로 끝까지 미룸).
      'first-ritual': 20, 'second-ritual': 80, 'third-ritual': 200, 'last-ritual': 500,
      'wicked-god': 800,
    },
    // 소굴은 heroic 퀘스트의 지역/장소 전개가 같은 type('장소')을 덮어써 지워
    // 버린다 — 10이면 사교도(손패 절반 4 vs 필드 8)를 아껴 소굴을 복구할 유인이
    // 필드 소환 이득에 밀려 사라진 소굴을 방치한다(계측: 소굴 소실 후 제물준비
    // 영구 봉인). 사교도 한 장을 손에 물고 있다가 되까는 것이 이득이 되는 크기.
    envScores: { '장소:사교의 소굴': 25 },
    // 제물준비 한 발동의 최대 동시 희생양(후반 배치 2~3마리)이 들어갈 자리.
    // 0이면 개막에 필드를 9/9로 채워 희생양이 전부 소환 실패 → 체인 영구 정지
    // (계측: 필드 포화 상태로 second-ritual을 30턴 넘게 사장시키다 패배).
    // 희생양은 reserveExempt로 예약 판정에서 빈 칸 취급 — 예약이 지키려는 토큰
    // 자체를 예약 위반으로 처벌해 제물준비가 순손실이 되던 자기모순을 끊는다.
    // 사교도도 동일한 이유로 예외 처리한다 — heroic의 지역/장소 전개가 소굴을
    // 덮어쓰면 사교도를 다시 내 소굴을 복구해야 하는데(envScores 25가 그 유인),
    // reserveCells:3이 사교도 플레이 자체를 예약 위반으로 걸어 유인을 깔아뭉갠다
    // (실측: 디버그 로그에서 cultist가 손패에 25턴 그대로 방치 — 소굴 소실 →
    // sacrifice-prep 조건 영구 봉인 → 25턴 순수 pass 스톨).
    reserveCells: 3,
    reserveExempt: ['sacrifice-lamb', 'cultist'],
  },
};

export function getDeckStrategy(deckId: string): DeckStrategy {
  return DECK_STRATEGIES[deckId] ?? {};
}

export function resolveWeights(strategy: DeckStrategy | undefined): EvalWeights {
  return { ...DEFAULT_WEIGHTS, ...(strategy?.evalWeights ?? {}) };
}
