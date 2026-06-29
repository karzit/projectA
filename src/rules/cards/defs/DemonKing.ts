import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { ritualCount } from '../../queries.js';

class DemonKingCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'demon-king',
    name: '마왕',
    kind: 'unit',
    power: 10,
    wisdom: 10,
    allKeywords: true,
    cannotSummon: true,
    desc: "직접 소환 불가. 부활 의식 5회 달성 시 강림. 모든 키워드 보유.",
  };

  override subscribe(ctx: GameContext): void {
    const controller = ctx.controller;
    const key = ctx.unitId
      ? `${ctx.unitId}:descend`
      : `${controller}:hand:demon-king:descend`;
    ctx.events.onStatic({
      key,
      controller,
      once: true,
      check: (state) => ritualCount(state, '부활의식') >= 5,
      fire: () => {
        if (ctx.board.isInHand(controller, this.id)) {
          ctx.board.summon(controller, this.id);
        }
      },
    });
  }
}

export const DemonKing = new DemonKingCard();
