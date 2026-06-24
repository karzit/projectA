import { UnitCard, type CardMeta } from '../Card.js';

class StoneMonkeyCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'stone-monkey',
    name: '돌원숭이',
    kind: 'unit',
    power: 2,
    wisdom: 1,
    keywords: ['원숭이'],
  };
}

export const StoneMonkey = new StoneMonkeyCard();
