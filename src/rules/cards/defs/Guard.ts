import { UnitCard, type CardMeta } from '../Card.js';

// 호위[난입]. 상대가 아군 유닛 하나를 대상으로 할 경우, 다른 무작위 아군 하나가 해당
// 효과를 대신 받는다. 리다이렉트 로직은 Board.resolveTargeting이 '호위' 키워드를 보고
// 처리한다(난입 = 조건 충족 시 즉시 적용되는 수동 반응).
class GuardCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'guard',
    name: '호위',
    kind: 'unit',
    power: 1,
    wisdom: 1,
    keywords: ['호위'],
    desc: '난입: 상대가 아군을 대상으로 하면 다른 무작위 아군이 대신 받습니다.',
  };
}

export const Guard = new GuardCard();
