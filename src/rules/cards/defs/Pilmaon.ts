import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class PilmaonCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'pilmaon',
    name: '필마온',
    kind: 'unit',
    power: 13,
    wisdom: 6,
    keywords: ['원숭이', '왕'],
    evolveTarget: 'je-cheon-dae-sung',
    desc: '[진행:제천대성]. 턴 시작 시 패악질 1개 발동 후 즉시 진행.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhem+evolve`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        ctx.board.mayhemOne(unitId);
        // Immediately evolve to 제천대성 if still alive.
        if (ctx.board.getUnit(unitId)) ctx.board.evolveUnit(unitId);
      },
    });
  }
}

export const Pilmaon = new PilmaonCard();
