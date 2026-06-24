import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class MonkeyKingCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'monkey-king',
    name: '미후왕',
    kind: 'unit',
    power: 6,
    wisdom: 5,
    keywords: ['원숭이', '왕'],
    cannotAttack: true,
    evolveTarget: 'son-wukong',
    conditions: [
      { need: 'unit', name: '돌원숭이' },
      { need: 'env', type: '지형', value: '산' },
    ],
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return; // forced ability only fires from field
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mayhem`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        // 패악질: random destroy on opponent's field (if any units exist)
        const opp = ctx.board.otherPlayer(controller);
        const targets = ctx.board.pickRandom('oppField', opp, 1);
        for (const t of targets) ctx.board.destroyUnit(t);
      },
    });
  }
}

export const MonkeyKing = new MonkeyKingCard();
