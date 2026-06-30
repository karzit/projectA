import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 성검[개입. 배경: 힘 10 이상의 용사]. 아군 용사에게 '이 유닛을 대상으로 하는 주문에
// 대해 지략 5를 얻습니다'를 부여한다('성검' 키워드 — resolveTargeting이 주문 무효화에 사용).
class HolySwordCard extends Card {
  readonly meta: CardMeta = {
    id: 'holy-sword',
    name: '성검',
    kind: 'spell',
    keywords: ['개입'],
    conditions: [
      { need: 'keyword', keyword: '용사' },
      { need: 'powerPresent', amount: 10, side: 'own' },
    ],
    desc: '개입. 아군 용사에게 "자신을 대상으로 하는 주문에 대해 지략 5"를 부여.',
  };

  override onPlay(ctx: GameContext): void {
    for (const id of ctx.board.fieldOf(ctx.controller)) {
      if (ctx.board.unitHasKeyword(id, '용사')) ctx.board.getUnit(id)?.grantKeyword('성검');
    }
  }
}

export const HolySword = new HolySwordCard();
