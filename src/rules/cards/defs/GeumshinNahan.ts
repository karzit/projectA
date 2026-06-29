import { UnitCard, type CardMeta } from '../Card.js';

class GeumshinNahanCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'geumshin-nahan',
    name: '금신나한',
    kind: 'unit',
    power: 60,
    wisdom: 60,
    cunning: 30,
    keywords: ['신장'],
    desc: '지략 30.',
  };
}

export const GeumshinNahan = new GeumshinNahanCard();
