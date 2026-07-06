// 덱별로 특화된 SimAI 파생 클래스 + 팩토리. 기본 SimAI(../SimAI.js)는 덱을
// 모르는 범용 그리디 AI이고, 여기서는 `SimAI#extraEvaluate`/`#extraOpeningScore`
// 훅만 오버라이드해 각 프리셋 덱 고유의 승리 조건에 가중치를 얹는다 — 카드
// 이름을 하드코딩하지 않고 키워드/스탯/배경 조건 같은 일반 신호로만 판단한다.
import { SimAI } from '../SimAI.js';
import { CARD_REGISTRY } from '../../rules/index.js';
import type { GameState, PlayerId } from '../../rules/index.js';
import type { EventManager } from '../core/EventManager.js';

function myFieldUnits(state: GameState, player: PlayerId): string[] {
  return state.field[player].filter((id): id is string => !!id);
}

function totalStat(state: GameState, player: PlayerId, stat: 'power' | 'wisdom' | 'cunning'): number {
  return myFieldUnits(state, player).reduce((s, id) => s + (state.units[id]?.[stat] ?? 0), 0);
}

function countKeyword(state: GameState, player: PlayerId, keyword: string): number {
  return myFieldUnits(state, player)
    .filter((id) => CARD_REGISTRY.getDef(state.units[id]!.cardId).keywords?.includes(keyword))
    .length;
}

// 손패의 특정 키워드 카드 수 (필드가 아니라 아직 안 낸 카드).
function countHandKeyword(state: GameState, player: PlayerId, keyword: string): number {
  return state.hand[player]
    .filter((id) => CARD_REGISTRY.getDef(id).keywords?.includes(keyword))
    .length;
}

// 배경 조건의 지혜 임계값 (없으면 0). 의식 체인에서는 임계값 = 제물 수 = 힘+지혜
// 합이라 체인 진행도·제물 준비도 계산의 단일 신호로 쓸 수 있다.
function wisdomNeed(cardId: string): number {
  const cond = CARD_REGISTRY.getDef(cardId).conditions?.find((c) => c.need === 'wisdom');
  return cond && 'amount' in cond ? cond.amount : 0;
}

// 아직 진행(진화)이 남은 필드 유닛 수 — evolveTarget 메타가 있는 유닛은 체인의
// 중간 단계이므로 살아남는 것 자체가 미래 가치다.
function countEvolvable(state: GameState, player: PlayerId): number {
  return myFieldUnits(state, player)
    .filter((id) => !!CARD_REGISTRY.getDef(state.units[id]!.cardId).evolveTarget)
    .length;
}

// 키스톤 유닛 보호 가중치: 내 카드(손패+필드)의 배경 조건이 이름/키워드로
// 요구하는 아군 필드 유닛은 "죽으면 덱 플랜이 무너지는" 유닛이다(삼장법사가
// 죽으면 저오능/사오정을 못 내고 이미 낸 것도 동반 이탈, 용사가 죽으면
// 전사/사제/마법사/성검이 전부 잠김). 의존 카드 수(캡 4)에 비례해 가산해
// 시뮬레이션에서 키스톤이 죽는 교환을 강하게 기피하게 만든다.
function keystoneScore(state: GameState, player: PlayerId, weight: number): number {
  const neededNames = new Map<string, number>();
  const neededKeywords = new Map<string, number>();
  const dependentCards = [
    ...state.hand[player],
    ...myFieldUnits(state, player).map((id) => state.units[id]!.cardId),
  ];
  for (const cardId of dependentCards) {
    for (const cond of CARD_REGISTRY.getDef(cardId).conditions ?? []) {
      if (cond.need === 'unit' && cond.side !== 'opponent') {
        neededNames.set(cond.name, (neededNames.get(cond.name) ?? 0) + 1);
      } else if (cond.need === 'keyword') {
        neededKeywords.set(cond.keyword, (neededKeywords.get(cond.keyword) ?? 0) + 1);
      }
    }
  }
  if (neededNames.size === 0 && neededKeywords.size === 0) return 0;

  let score = 0;
  for (const id of myFieldUnits(state, player)) {
    const def = CARD_REGISTRY.getDef(state.units[id]!.cardId);
    const deps = (neededNames.get(def.name) ?? 0)
      + (def.keywords ?? []).reduce((s, k) => s + (neededKeywords.get(k) ?? 0), 0);
    if (deps > 0) score += Math.min(deps, 4) * weight;
  }
  return score;
}

// 사교도 덱: 승리 플랜은 의식 체인 완주(1→2→3→6 제물 → 사특한 신) 후 사교도
// 사망마다 신이 증식하는 스노볼. 기본 전투 스코어로는 "아군 6마리 희생"이 순손실
// 로만 보이므로, 체인 진행도(손에 든 의식의 깊이)·제물 준비도·손패로 돌아오는
// 사교도·필드의 사특한 신을 명시적으로 가치화해 체인을 밟을 동기를 만든다.
class CultSimAI extends SimAI {
  protected override extraEvaluate(state: GameState): number {
    let chain = 0;
    let fodder = 0;
    for (const cardId of state.hand[this.player]) {
      const def = CARD_REGISTRY.getDef(cardId);
      if (!def.keywords?.includes('의식')) continue;
      const need = wisdomNeed(cardId);
      // 체인 진행도: 깊은 의식을 손에 쥘수록(임계값 1<2<3<6) 진행된 상태.
      chain += need * 3;
      // 제물 준비도: 이 의식은 힘+지혜 합 == 임계값인 아군이 임계값 마리 필요 —
      // 준비된 제물 수(필요분까지만)를 우대해 제물 유닛을 소환/보존하게 한다.
      const ready = myFieldUnits(state, this.player)
        .filter((id) => {
          const u = state.units[id];
          return u && u.power + u.wisdom === need;
        }).length;
      fodder += Math.min(ready, need) * 2;
    }
    // 의식이 희생시킨 사교도는 같은 수만큼 손패로 돌아온다(재소환 가능) — 손의
    // 사교도를 필드 사교도에 준하는 가치로 쳐야 희생이 순손실로 평가되지 않는다.
    const handCultists = countHandKeyword(state, this.player, '사교도') * 8;
    // 사특한 신: 이후 내 사교도가 죽을 때마다 신이 또 소환되는 승리 엔진.
    const gods = countKeyword(state, this.player, '사특한 신') * 50;
    return totalStat(state, this.player, 'wisdom') * 2
      + countKeyword(state, this.player, '사교도') * 3
      + chain + fodder + handCultists + gods;
  }

  protected override extraOpeningScore(_state: GameState, cardId: string): number {
    return (CARD_REGISTRY.getDef(cardId).wisdom ?? 0) * 2;
  }
}

// 영웅담 덱: 전사/사제/마법사(결속 키워드)가 서로를 지원해야 용사 레벨업·성검
// 등 후속 체인이 돌아간다 — 결속 유닛 수와 지략(상대 지혜 카드 봉쇄) 총합에
// 더해, 처치 점수(피보나치 레벨업 진행도)와 용사(키스톤 — 죽으면 결속 카드가
// 전부 잠김) 보호를 가산한다.
class HeroicSimAI extends SimAI {
  protected override extraEvaluate(state: GameState): number {
    return countKeyword(state, this.player, '결속') * 4
      + totalStat(state, this.player, 'cunning')
      + (state.heroKillScore[this.player] ?? 0) * 0.5
      + keystoneScore(state, this.player, 6);
  }

  protected override extraOpeningScore(_state: GameState, cardId: string): number {
    return (CARD_REGISTRY.getDef(cardId).cunning ?? 0) * 2;
  }
}

// 서유기 덱: 삼장법사 여정 완주로 저오능/사오정/원숭이 왕 계열이 한꺼번에
// 진화한다 — 대리방어(호위) 계열과 원숭이/왕 계열 유닛 수에 더해, 아직 진화가
// 남은 유닛(체인 중간 단계)과 삼장법사(키스톤 — 죽으면 저오능/사오정 동반
// 이탈 + 여정 진화 전멸) 보호를 가산한다.
class JourneySimAI extends SimAI {
  protected override extraEvaluate(state: GameState): number {
    return countKeyword(state, this.player, '대리방어') * 3
      + countKeyword(state, this.player, '왕') * 3
      + countEvolvable(state, this.player) * 4
      + keystoneScore(state, this.player, 8);
  }
}

const DECK_AI: Record<string, new (player: PlayerId, events: EventManager, getState: () => GameState) => SimAI> = {
  cult: CultSimAI,
  heroic: HeroicSimAI,
  journey: JourneySimAI,
};

// deckId에 맞는 특화 AI를 만든다. 모르는 덱(예: basic, 사용자 커스텀 덱)은
// 범용 SimAI로 그대로 대체된다.
export function createSimAI(
  player: PlayerId,
  events: EventManager,
  getState: () => GameState,
  deckId?: string,
): SimAI {
  const Ctor = (deckId && DECK_AI[deckId]) || SimAI;
  return new Ctor(player, events, getState);
}
