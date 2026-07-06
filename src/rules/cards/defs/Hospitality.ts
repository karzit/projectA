import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 환대[배경:지혜:9, 장소:사교의 소굴]. 다음 턴 시작까지 적 유닛을 아군 유닛으로
// 간주한다 — 배경조건 판정과 아군을 대상으로 하는 카드 효과가 적 유닛도 포함한다
// (공격/이동 등 행동에는 영향 없음).
class HospitalityCard extends Card {
  readonly meta: CardMeta = {
    id: 'hospitality',
    name: '환대',
    kind: 'spell',
    conditions: [
      { need: 'env', type: '장소', value: '사교의 소굴' },
      { need: 'wisdom', amount: 9 },
    ],
    desc: '배경:장소:사교의 소굴, 지혜 9 이상. 다음 턴 시작까지 적 유닛을 아군 유닛으로 간주(배경조건/아군 대상 카드).',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.setHospitality(true);
  }
}

export const Hospitality = new HospitalityCard();
