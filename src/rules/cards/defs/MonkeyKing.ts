import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class MonkeyKingCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'monkey-king',
    name: '미후왕',
    kind: 'unit',
    power: 7,
    wisdom: 3,
    keywords: ['원숭이', '왕'],
    cannotAttack: true,
    cannotMove: true,
    evolveTarget: 'son-wukong',
    desc: "행동 불가. [진행:손오공]. 턴 시작 시 패악질 발동.",
    conditions: [
      { need: 'env', type: '장소', value: '산' },
    ],
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhem`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => ctx.board.mayhemOne(unitId),
    });
  }

}

export const MonkeyKing = new MonkeyKingCard();
