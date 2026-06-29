import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class JeCheonDaeSungCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'je-cheon-dae-sung',
    name: '제천대성',
    kind: 'unit',
    power: 15,
    wisdom: 10,
    keywords: ['원숭이', '왕'],
    evolveTarget: 'son-haengja',
    desc: '[진행:손행자]. 턴 시작 시 패악질 전부 발동 후 오행산에 갇힘 (삼장법사가 해방).',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhemTrap`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return;
        ctx.board.mayhemAll(unitId);
        // Trap self in 오행산 after 패악질.
        if (ctx.board.getUnit(unitId)) ctx.board.trap(unitId);
      },
    });
  }
}

export const JeCheonDaeSung = new JeCheonDaeSungCard();
