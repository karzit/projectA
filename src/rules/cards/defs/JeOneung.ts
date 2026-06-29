import { UnitCard, type CardMeta } from '../Card.js';

class JeOneungCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'je-o-neung',
    name: '저오능',
    kind: 'unit',
    power: 10,
    wisdom: 6,
    keywords: ['승려'],
    evolveTarget: 'jeong-dan-saja',
    desc: '[진행:정단사자]. 아군 삼장법사가 공격받으면 대신 전투.',
    conditions: [{ need: 'unit', name: '삼장법사' }],
  };
}

export const JeOneung = new JeOneungCard();
