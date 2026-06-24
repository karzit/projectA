import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { unitCount } from '../../queries.js';

class AvengerCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'avenger',
    name: '복수자',
    kind: 'unit',
    power: 3,
    wisdom: 2,
  };

  override subscribe(ctx: GameContext): void {
    const controller = ctx.controller;
    const key = ctx.unitId
      ? `${ctx.unitId}:rise`
      : `${controller}:hand:avenger:rise`;
    ctx.events.onStatic({
      key,
      controller,
      once: false,
      check: (state) => unitCount(state, controller) === 0,
      fire: () => {
        if (ctx.board.isInHand(controller, this.id)) {
          ctx.board.summon(controller, this.id);
        }
      },
    });
  }
}

export const Avenger = new AvengerCard();
