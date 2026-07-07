// 덱별 AI 특화 설정. MctsAI의 평가 가중치는 범용 기본값을 쓰지만, 덱마다
// "완주해야 할 체인"이 다르므로(용사 레벨업/원숭이-삼장 순례/의식 제물) 그
// 체인 카드를 들고/펼치는 데 보너스를 줘서 AI가 체인 진행을 우선하게 만든다.
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
  chain: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  unitCount: 3,
  emptyField: 50,
  playable: 2,
  risky: 6,
  keystoneOpp: 4,
  keystoneSelf: 3,
  evolve: 6,
  chain: 0,
};

export interface DeckStrategy {
  // 이 덱의 승리 플랜을 구성하는 체인 카드 id들 — 필드에 있으면 chain 가중치
  // 전액, 손에 있으면 절반 보너스를 받아 AI가 이들을 우선 확보/전개하게 한다.
  chainCardIds?: string[];
  evalWeights?: Partial<EvalWeights>;
}

const DECK_STRATEGIES: Record<string, DeckStrategy> = {
  heroic: {
    // 용사의 모험 체인(모험의 시작→…→마왕성 입성) 본체 + 결속(전사/사제/마법사) —
    // 결속 배경 성립뿐 아니라 체인 스펠 자체를 우선 확보/전개하게 한다.
    chainCardIds: ['adventure-start', 'fate-awakening', 'quest-labyrinth', 'demon-castle', 'hero', 'warrior', 'priest', 'mage'],
    evalWeights: { chain: 10 },
  },
  journey: {
    // 미후왕 진화 체인(돌원숭이→…→제천대성→손행자→투전승불) 본체를 우선 보호해야
    // 삼장법사가 오행산 해방을 걸 시점까지 살아남는다. 순례단(체인 후반을 게이트
    // 하는 배경 유닛)도 함께 챙긴다.
    chainCardIds: [
      'stone-monkey', 'monkey-king', 'son-wukong', 'pilmaon', 'je-cheon-dae-sung', 'son-haengja', 'tu-jeon-seung-bul',
      'tang-monk', 'sa-o-jeong', 'je-o-neung', 'subori-josa',
    ],
    evalWeights: { chain: 10, risky: 9 },
  },
  cult: {
    // 의식 체인(합1→2→3→4→사특한 신) 전 단계 — 지혜 누적 배경이 순서대로 쌓여야
    // 하므로 이 카드들을 최대한 일찍 필드에 붙잡아둔다.
    chainCardIds: ['cult-ritual', 'first-ritual', 'second-ritual', 'third-ritual', 'last-ritual', 'sacrifice-prep', 'cultist'],
    evalWeights: { chain: 8 },
  },
};

export function getDeckStrategy(deckId: string): DeckStrategy {
  return DECK_STRATEGIES[deckId] ?? {};
}

export function resolveWeights(strategy: DeckStrategy | undefined): EvalWeights {
  return { ...DEFAULT_WEIGHTS, ...(strategy?.evalWeights ?? {}) };
}
