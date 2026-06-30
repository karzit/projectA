import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 해골 병사[5/1]. 최후: 해골을 소환한다.
class SkeletonSoldierCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'skeleton-soldier',
    name: '해골 병사',
    kind: 'unit',
    power: 5,
    wisdom: 1,
    desc: '최후: 해골을 소환합니다.',
  };

  override onDeath(ctx: GameContext): void {
    ctx.board.summonCard(ctx.controller, 'skeleton');
  }
}

export const SkeletonSoldier = new SkeletonSoldierCard();
