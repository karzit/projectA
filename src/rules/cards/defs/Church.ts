import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 교회[배경: 이미 사망한 용사]. 아군 용사를 부활시킨다. 모든 강화효과는 유지되고
// 현재 경험치만 0으로 리셋된다(최대치는 유지). 턴 종료 시 처리.
class ChurchCard extends Card {
  readonly meta: CardMeta = {
    id: 'church',
    name: '교회',
    kind: 'spell',
    conditions: [{ need: 'dead', keyword: '용사', side: 'own' }],
    desc: '사망한 아군 용사를 부활(강화효과 유지, 현재 경험치 0으로 리셋).',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.reviveFromGraveyard(ctx.controller, '용사');
  }
}

export const Church = new ChurchCard();
