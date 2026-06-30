import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 목 없는 기사의 머리[0/6, 지략6]. 움직일 수 없다. 최후: 적 용사에게 지략2 부여.
class HeadlessKnightHeadCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'headless-knight-head',
    name: '목 없는 기사의 머리',
    kind: 'unit',
    power: 0,
    wisdom: 6,
    cunning: 6,
    cannotMove: true,
    desc: '지략 6. 움직일 수 없습니다. 최후: 적 용사에게 지략 2 부여.',
  };

  override onDeath(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    for (const u of ctx.board.unitsOn(opp)) {
      if (u.cardId === 'hero') u.grantCunning(2);
    }
  }
}

export const HeadlessKnightHead = new HeadlessKnightHeadCard();
