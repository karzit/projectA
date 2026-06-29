import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 부활 의식: 마왕의 부활 의식을 1회 진행한다. 5회 쌓이면 패에 있던 마왕이
// 자동으로 강림한다(마왕의 static 구독이 ritualCount('부활의식') >= 5 를 검사).
class RevivalRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'revival-ritual',
    name: '부활 의식',
    kind: 'spell',
    desc: "부활 의식 카운터 +1. 5회 달성 시 마왕 강림.",
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.performRitual('부활의식');
  }
}

export const RevivalRitual = new RevivalRitualCard();
