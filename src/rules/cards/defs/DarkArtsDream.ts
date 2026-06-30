import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사술-환몽[배경:장소:사교의 소굴, 지혜:3x]. 내 총 지혜를 3으로 나눈 x 이하의
// 힘을 가진 적 유닛 하나를 내 전장으로 가져온다.
class DarkArtsDreamCard extends Card {
  readonly meta: CardMeta = {
    id: 'dark-arts-dream',
    name: '사술-환몽',
    kind: 'spell',
    conditions: [
      { need: 'env', type: '장소', value: '사교의 소굴' },
      { need: 'wisdom', amount: 3 },
    ],
    desc: '배경:장소:사교의 소굴, 지혜 3 이상. 내 총 지혜÷3=x. 적 중 힘≤x인 유닛 하나를 아군으로 전환.',
  };

  override onPlay(ctx: GameContext): void {
    const totalWisdom = ctx.board.unitsOn(ctx.controller).reduce((s, u) => s + u.wisdom, 0);
    const x = Math.floor(totalWisdom / 3);
    const opp = ctx.board.otherPlayer(ctx.controller);
    const targets = ctx.board.unitsOn(opp)
      .filter((u) => u.power <= x)
      .map((u) => u.instanceId);
    if (targets.length === 0) return;
    const [chosen] = ctx.choices.request({ from: targets, min: 1, max: 1, prompt: `힘 ${x} 이하의 적 유닛 선택` });
    ctx.board.setController(chosen, ctx.controller);
  }
}

export const DarkArtsDream = new DarkArtsDreamCard();
