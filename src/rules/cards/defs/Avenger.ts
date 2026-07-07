import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { inHand, unitCount } from '../../queries.js';

class AvengerCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'avenger',
    name: '복수자',
    kind: 'unit',
    power: 3,
    wisdom: 2,
    desc: "내 전장이 비면, 패에 있을 경우 자동으로 소환된다.",
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
      // 손에 없으면 check도 거짓이어야 한다 — fire가 no-op인데 check만 참이면
      // settle 루프가 매번 SETTLE_LIMIT까지 공회전한다(필드 빔 + 복수자 사망 후).
      check: (state) => unitCount(state, controller) === 0 && inHand(state, controller, this.id),
      fire: () => {
        if (ctx.board.isInHand(controller, this.id)) {
          ctx.board.summon(controller, this.id);
        }
      },
    });
  }
}

export const Avenger = new AvengerCard();
