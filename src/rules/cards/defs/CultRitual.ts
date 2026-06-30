import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사교의 의식: 전개:장소:사교의 소굴, '첫 번째 의식' 한 장을 패에 넣는다.
class CultRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'cult-ritual',
    name: '사교의 의식',
    kind: 'spell',
    desc: '전개:장소:사교의 소굴. 첫 번째 의식 획득.',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.developEnv('장소', '사교의 소굴');
    ctx.board.addToHand(ctx.controller, 'first-ritual');
  }
}

export const CultRitual = new CultRitualCard();
