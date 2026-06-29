import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class SonWukongCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'son-wukong',
    name: '손오공',
    kind: 'unit',
    power: 12,
    wisdom: 9,
    keywords: ['원숭이', '왕'],
    evolveTarget: 'pilmaon',
    desc: '[진행:필마온]. 턴 시작 시 패악질 전부 발동.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhemAll`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => ctx.board.mayhemAll(unitId),
    });
  }
}

export const SonWukong = new SonWukongCard();
