import { UnitCard, type CardMeta } from '../Card.js';

// 해골[2/0]. 해골 병사의 최후로 소환된다.
class SkeletonCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'skeleton',
    name: '해골',
    kind: 'unit',
    power: 2,
    wisdom: 0,
    desc: '작은 언데드.',
  };
}

export const Skeleton = new SkeletonCard();
