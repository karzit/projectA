import { UnitCard, type CardMeta } from '../Card.js';

// 고블린[2/1]. 공격 시 다른 고블린과 함께 공격한다(엔진 _goblinSupporters가 '고블린'
// 키워드를 보고 미행동 아군 고블린의 힘을 합산).
class GoblinCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'goblin',
    name: '고블린',
    kind: 'unit',
    power: 2,
    wisdom: 1,
    keywords: ['고블린'],
    desc: '공격 시 다른 고블린과 함께 공격합니다(힘 합산).',
  };
}

export const Goblin = new GoblinCard();
