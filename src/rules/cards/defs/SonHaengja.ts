import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class SonHaengjaCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'son-haengja',
    name: '손행자',
    kind: 'unit',
    power: 15,
    wisdom: 8,
    keywords: ['원숭이', '왕'],
    evolveTarget: 'tu-jeon-seung-bul',
    desc: '[진행:투전승불]. 삼장법사가 소멸하면 같이 이탈.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    // 삼장법사 소멸 시 같이 이탈
    ctx.events.on({
      key: `${unitId}:followTangMonk`,
      controller,
      filter: (ev) => ev.kind === 'unitDied' && ev.cardId === 'tang-monk' && ev.controller === controller,
      fire: () => {
        if (ctx.board.getUnit(unitId)) ctx.board.exitUnit(unitId);
      },
    });
  }
}

export const SonHaengja = new SonHaengjaCard();
