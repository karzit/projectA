import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class SuboriJosaCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'subori-josa',
    name: '수보리조사',
    kind: 'unit',
    power: 4,
    wisdom: 8,
    keywords: ['선인'],
    desc: '사용 시 전장의 아군 미후왕을 즉시 진행시키고 자신은 이탈.',
  };

  override onPlay(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const controller = ctx.controller;
    // 전장의 미후왕 진행
    for (const id of ctx.board.fieldOf(controller)) {
      if (ctx.board.getUnit(id)?.cardId === 'monkey-king') {
        ctx.board.evolveUnit(id);
      }
    }
    // 자신 이탈
    ctx.board.exitUnit(ctx.unitId);
  }
}

export const SuboriJosa = new SuboriJosaCard();
