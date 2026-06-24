import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { highestInAllStats } from '../../queries.js';

class TraitorCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'traitor',
    name: '배신자',
    kind: 'unit',
    power: 5,
    wisdom: 5,
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return; // only fires from field
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.onStatic({
      key: `${unitId}:betray`,
      controller,
      once: true,
      check: (state) => {
        const top = highestInAllStats(state, controller, ['power', 'wisdom']);
        return !!top && top.instanceId === unitId;
      },
      fire: () => {
        const [target] = ctx.board.pickRandom('ownField', controller, 1);
        if (target) ctx.board.destroyUnit(target);
        ctx.board.setController(unitId, ctx.board.otherPlayer(controller));
      },
    });
  }
}

export const Traitor = new TraitorCard();
