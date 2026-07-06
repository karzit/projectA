import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사술-심식[배경:장소:사교의 소굴, 지혜:3x]. 내 총 지혜를 3으로 나눈 x 이하로,
// 상대의 무작위 카드 x장을 다음 턴 동안 낼 수 없도록 한다.
class DarkArtsMindSealCard extends Card {
  readonly meta: CardMeta = {
    id: 'dark-arts-mind-seal',
    name: '사술-심식',
    kind: 'spell',
    conditions: [
      { need: 'env', type: '장소', value: '사교의 소굴' },
      { need: 'wisdom', amount: 3 },
    ],
    desc: '배경:장소:사교의 소굴, 지혜 3 이상. 내 총 지혜÷3=x. 상대의 무작위 카드 x장을 다음 턴 동안 낼 수 없도록 함.',
  };

  override onPlay(ctx: GameContext): void {
    const totalWisdom = ctx.board.unitsOn(ctx.controller).reduce((s, u) => s + u.wisdom, 0);
    const x = Math.floor(totalWisdom / 3);
    const opp = ctx.board.otherPlayer(ctx.controller);
    const hand = [...ctx.board.handOf(opp)];
    for (let i = 0; i < x && hand.length > 0; i++) {
      const picked = ctx.board.pickRandomFrom(hand);
      if (!picked) break;
      ctx.board.lockCard(opp, picked);
      hand.splice(hand.indexOf(picked), 1);
    }
  }
}

export const DarkArtsMindSeal = new DarkArtsMindSealCard();
