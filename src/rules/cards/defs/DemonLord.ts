import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 마왕[44/44]. 협력하지 않는다(협공 블로커 불가 + 협공 수비 받기 불가). 최후: 자신의
// 컨트롤러가 패배한다.
class DemonLordCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'demon-lord',
    name: '마왕',
    kind: 'unit',
    power: 44,
    wisdom: 44,
    cannotCooperate: true,
    desc: '협력하지 않습니다. 최후: 패배합니다.',
  };

  override onDeath(ctx: GameContext): void {
    ctx.board.declareLoss(ctx.controller);
  }
}

export const DemonLord = new DemonLordCard();
