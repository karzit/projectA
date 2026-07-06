import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사술-환통[배경:장소:사교의 소굴, 지혜:3x]. 내 총 지혜를 3으로 나눈 x 이하로,
// 이번 턴 동안 지혜가 가장 낮은 적 유닛 x장의 힘을 x만큼 감소시킨다.
class DarkArtsTurmoilCard extends Card {
  readonly meta: CardMeta = {
    id: 'dark-arts-turmoil',
    name: '사술-환통',
    kind: 'spell',
    conditions: [
      { need: 'env', type: '장소', value: '사교의 소굴' },
      { need: 'wisdom', amount: 3 },
    ],
    desc: '배경:장소:사교의 소굴, 지혜 3 이상. 내 총 지혜÷3=x. 이번 턴 동안 지혜가 가장 낮은 적 유닛 x장의 힘을 x만큼 감소.',
  };

  override onPlay(ctx: GameContext): void {
    const totalWisdom = ctx.board.unitsOn(ctx.controller).reduce((s, u) => s + u.wisdom, 0);
    const x = Math.floor(totalWisdom / 3);
    if (x <= 0) return;
    const opp = ctx.board.otherPlayer(ctx.controller);
    const targets = ctx.board.unitsOn(opp)
      .sort((a, b) => a.wisdom - b.wisdom)
      .slice(0, x);
    for (const u of targets) {
      const amount = Math.min(x, u.power);
      if (amount > 0) ctx.board.addTurnBuff(u.instanceId, 'power', -amount);
    }
  }
}

export const DarkArtsTurmoil = new DarkArtsTurmoilCard();
