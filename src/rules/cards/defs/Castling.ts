import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 캐슬링[배경:지혜:8. 개입]. 아군 유닛 둘의 위치를 교환한다.
class CastlingCard extends Card {
  readonly meta: CardMeta = {
    id: 'castling',
    name: '캐슬링',
    kind: 'spell',
    keywords: ['개입'],
    conditions: [{ need: 'wisdom', amount: 8 }],
    desc: '개입. 배경:지혜 8. 아군 유닛 두 개의 위치를 교환.',
  };

  override onPlay(ctx: GameContext): void {
    const allies = ctx.board.fieldOf(ctx.controller);
    if (allies.length < 2) return;
    const [a, b] = ctx.choices.request({ from: allies, min: 2, max: 2, prompt: '위치를 교환할 아군 2마리' });
    ctx.board.swapPositions(a, b);
  }
}

export const Castling = new CastlingCard();
