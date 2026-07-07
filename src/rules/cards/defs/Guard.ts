import { Card, type CardMeta } from '../Card.js';

// 호위[난입]. 유닛이 아닌 주문(배경조건 없음) — 필드에 놓이지 않고 손에 대기하다가,
// 상대가 아군 유닛 하나를 대상으로 하는 순간 손에서 자동 발동(소모)되어 다른 무작위
// 아군 하나가 해당 효과를 대신 받는다. 리다이렉트 로직은 Board.resolveTargeting이
// 손패의 '호위' 키워드 카드를 찾아 처리한다(난입 = 조건 충족 시 손에서 즉시 발동).
class GuardCard extends Card {
  readonly meta: CardMeta = {
    id: 'guard',
    name: '호위',
    kind: 'spell',
    keywords: ['호위'],
    desc: '난입: 상대가 아군을 대상으로 하면 이 카드가 손에서 발동되어 다른 무작위 아군이 대신 받습니다.',
  };
}

export const Guard = new GuardCard();
