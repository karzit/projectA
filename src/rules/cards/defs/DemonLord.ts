import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { ritualCount } from '../../queries.js';

// 마왕[44/44]. 협력하지 않는다(협공 블로커 불가 + 협공 수비 받기 불가). 최후: 자신의
// 컨트롤러가 패배한다. 직접 소환 불가 — 마왕성 입성(상대 전장에 소환) 또는 부활 의식
// 5회 누적(자기 패에서 강림)으로만 등장한다.
class DemonLordCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'demon-lord',
    name: '마왕',
    kind: 'unit',
    power: 44,
    wisdom: 44,
    cannotCooperate: true,
    cannotSummon: true,
    desc: '직접 소환 불가. 협력하지 않습니다. 최후: 패배합니다.',
  };

  override subscribe(ctx: GameContext): void {
    const controller = ctx.controller;
    const key = ctx.unitId
      ? `${ctx.unitId}:descend`
      : `${controller}:hand:demon-lord:descend`;
    ctx.events.onStatic({
      key,
      controller,
      once: true,
      check: (state) => ritualCount(state, '부활의식') >= 5,
      fire: () => {
        if (ctx.board.isInHand(controller, this.id)) {
          ctx.board.summon(controller, this.id);
        }
      },
    });
  }

  override onDeath(ctx: GameContext): void {
    ctx.board.declareLoss(ctx.controller);
  }
}

export const DemonLord = new DemonLordCard();
