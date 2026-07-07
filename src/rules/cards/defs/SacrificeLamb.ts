import { UnitCard, type CardMeta } from '../Card.js';

// 희생양[0/1]. 제물준비의 생성 전용 토큰 — 매 제물준비 발동마다 지혜가 누적으로 오른다.
class SacrificeLambCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'sacrifice-lamb',
    name: '희생양',
    kind: 'unit',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    power: 0,
    wisdom: 1,
    desc: '제물준비로만 소환됨. 제물준비가 발동할 때마다 지혜 +1.',
  };
}

export const SacrificeLamb = new SacrificeLambCard();
