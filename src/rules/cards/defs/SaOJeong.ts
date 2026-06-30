import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class SaOJeongCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'sa-o-jeong',
    name: '사오정',
    kind: 'unit',
    power: 10,
    wisdom: 12,
    keywords: ['승려'],
    evolveTarget: 'geumshin-nahan',
    desc: '[진행:금신나한]. 배경:삼장법사. 삼장법사가 이탈(사망)하면 같이 이탈.',
    conditions: [{ need: 'unit', name: '삼장법사' }],
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:followTangMonkSaO`,
      controller,
      filter: (ev) => ev.kind === 'unitDied' && ev.cardId === 'tang-monk' && ev.controller === controller,
      fire: () => {
        if (ctx.board.getUnit(unitId)) ctx.board.exitUnit(unitId);
      },
    });
  }
}

export const SaOJeong = new SaOJeongCard();
