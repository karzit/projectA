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

// 사교도 덱: 승리 플랜은 의식 체인 완주(1→2→3→6 제물 → 사특한 신) 후 사교도
// 사망마다 신이 증식하는 스노볼. 기본 전투 스코어로는 "아군 6마리 희생"이 순손실
// 로만 보이므로, 체인 진행도(손에 든 의식의 깊이)·제물 준비도·손패로 돌아오는
// 사교도·필드의 사특한 신을 명시적으로 가치화해 체인을 밟을 동기를 만든다.
class CultSimAI extends SimAI {
  protected override extraEvaluate(state: GameState): number {
    let chain = 0;
    let fodder = 0;
    
    // 이번 턴에 유닛이 행동했는지 여부 (부동 체크용)
    const hasActed = state.actedThisTurn.length > 0;

    for (const cardId of state.hand[this.player]) {
      const def = CARD_REGISTRY.getDef(cardId);
      if (!def.keywords?.includes('의식')) continue;
      const need = wisdomNeed(cardId);
      
      // 1. 체인 진행도: 손에 든 의식 자체의 가치는 적당히 유지 (Dud Play 방지)
      chain += need * 4;
      
      // 2. 제물 준비도 검사
      const ready = myFieldUnits(state, this.player)
        .filter((id) => {
          const u = state.units[id];
          return u && u.power + u.wisdom === need;
        }).length;
        
      // [수정] 제물이 아직 부족할 때: 제물 유닛을 필드에 '유지'하는 것에 강한 보상
      // 눈앞의 1:1 전투 이득보다 제물 1마리 살려두는 게 더 가치 있게 만듭니다.
      if (ready < need) {
        fodder += ready * 15; 
      }
      
      // [수정] 제물이 완벽히 갖춰졌고, 이번 턴에 '부동'을 깨지 않았다면 최고 우선순위 부여
      if (need > 0 && ready >= need) {
        if (!hasActed) {
          // 지금 당장 의식을 완수할 수 있는 상태라면 확실하게 밀어줍니다.
          chain += need * 40; 
        } else {
          // 이미 행동해버려 이번 턴에 의식이 안 된다면, 다음 턴을 위해 제물을 무조건 보존
          fodder += ready * 25; 
        }
      }
    }

    // [수정] 손패의 사교도 가중치 하향 (8 -> 3)
    // 사교도를 손에 쥐고만 있는 트롤링을 방지하고 필드 전개를 유도합니다.
    const handCultists = countHandKeyword(state, this.player, '사교도') * 3;
    const gods = countKeyword(state, this.player, '사특한 신') * 50;

    return totalStat(state, this.player, 'wisdom') * 2
      + countKeyword(state, this.player, '사교도') * 5 // 필드 사교도 우대
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
    // 다음 레벨업(피보나치 임계 expMax) 임박도 — 처치 누적치(exp)가 임계에
    // 가까울수록 가중치를 키워 "완주 직전" 상태를 다른 행동보다 우대한다
    // (GPT 제안 9순위: 스토리 진행도. journey의 evolutionProximity와 같은 결).
    const levelUpProximity = myFieldUnits(state, this.player)
      .reduce((s, id) => {
        const u = state.units[id];
        if (!u || !u.expMax) return s;
        return s + Math.min(u.exp ?? 0, u.expMax) / u.expMax;
      }, 0) * 8;
    return countKeyword(state, this.player, '결속') * 4
      + totalStat(state, this.player, 'cunning')
      + (state.heroKillScore[this.player] ?? 0) * 0.5
      + levelUpProximity
      + this.keystoneScore(state, this.player, 6);
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
      + this.evolutionProximity(state, this.player, 10)
      + this.keystoneScore(state, this.player, 8);
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
