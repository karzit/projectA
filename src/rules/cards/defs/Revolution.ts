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
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    const n = ctx.board.unitCount(opp);
    for (let i = 0; i < n; i++) {
      const [a, b] = ctx.choices.take(2);
      if (a && b) ctx.board.swapStats(a, b);
    }
  }
}

export const Revolution = new RevolutionCard();
