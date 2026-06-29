import { UnitCard, type CardMeta } from '../Card.js';

class SaOJeongCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'sa-o-jeong',
    name: '사오정',
    kind: 'unit',
    power: 10,
    wisdom: 12,
    keywords: ['승려'],
    evolveTarget: 'geumshin-nahan',
    desc: '[진행:금신나한]. 아군 삼장법사가 공격받으면 대신 전투.',
    conditions: [{ need: 'unit', name: '삼장법사' }],
  };
}

export const SaOJeong = new SaOJeongCard();
