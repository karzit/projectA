import { UnitCard, type CardMeta } from '../Card.js';

// 토큰: 모험의 시작 / 퀘스트 / 용사 등이 소환한다. 작고 연약하다.
// (테마 문서의 '1/1 슬라임' 언급도 있으나 카드 정의는 1/0으로 통일.)
class SlimeCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'slime',
    name: '슬라임',
    kind: 'unit',
    power: 1,
    wisdom: 0,
    keywords: ['슬라임'],
    desc: "기본 몬스터.",
  };
}

export const Slime = new SlimeCard();
