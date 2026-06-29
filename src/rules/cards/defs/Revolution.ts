import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class RevolutionCard extends Card {
  readonly meta: CardMeta = {
    id: 'revolution',
    name: '혁명',
    kind: 'spell',
    conditions: [
      { need: 'wisdom', amount: 15, side: 'own' },
      { need: 'noPowerAtLeast', amount: 7, side: 'own' },
    ],
    desc: "전장 유닛을 짝수로 선택해 짝끼리 힘/지혜를 교환.",
  };

  override onPlay(ctx: GameContext): void {
    // up-to-N: 적 유닛 수만큼 스탯 교환을 할 수 있다. 플레이어가 (짝수 개의)
    // 유닛을 골라 연속 짝끼리 교환한다. 0개(교환 안 함)도 허용.
    const opp = ctx.board.otherPlayer(ctx.controller);
    const maxPairs = ctx.board.unitCount(opp);
    const picked = ctx.choices.request({
      from: ctx.board.allFieldUnitIds(),
      min: 0,
      max: maxPairs * 2,
      prompt: '스탯을 교환할 유닛들을 짝수로 선택 (앞에서부터 둘씩 교환)',
    });
    for (let i = 0; i + 1 < picked.length; i += 2) {
      ctx.board.swapStats(picked[i], picked[i + 1]);
    }
  }
}

export const Revolution = new RevolutionCard();
