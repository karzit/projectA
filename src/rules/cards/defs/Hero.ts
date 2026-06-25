import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 용사[5/5]. 환경이 변화할 때마다 슬라임(토큰) 1마리를 얻는다.
class HeroCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'hero',
    name: '용사',
    kind: 'unit',
    power: 5,
    wisdom: 5,
    keywords: ['용사'],
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return; // 필드에서만 발동
    const controller = ctx.controller;
    ctx.events.on({
      key: `${ctx.unitId}:envGrowth`,
      controller,
      filter: (ev) => ev.kind === 'envChanged',
      fire: () => {
        ctx.board.summonCard(controller, 'slime');
      },
    });
  }
}

export const Hero = new HeroCard();
