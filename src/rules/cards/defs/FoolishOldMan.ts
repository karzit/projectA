import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class FoolishOldManCard extends Card {
  readonly meta: CardMeta = {
    id: 'foolish-old-man',
    name: '우공이산',
    kind: 'spell',
    keywords: ['개입'],
    desc: "개입. [전개:장소:산].",
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.developEnv('장소', '산');
  }
}

export const FoolishOldMan = new FoolishOldManCard();
