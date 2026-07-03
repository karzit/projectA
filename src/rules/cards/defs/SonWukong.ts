import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class SonWukongCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'son-wukong',
    name: '손오공',
    kind: 'unit',
    power: 12,
    wisdom: 8,
    keywords: ['원숭이', '왕'],
    cannotAttack: true,
    cannotMove: true,
    evolveTarget: 'pilmaon',
    desc: '행동 불가. [진행:필마온]. 턴 시작 시 패악질 전부 발동 후 즉시 진행.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhemAll+evolve`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        ctx.board.mayhemAll(unitId);
        if (ctx.board.getUnit(unitId)) ctx.board.evolveUnit(unitId);
      },
    });
  }
}

export const SonWukong = new SonWukongCard();
