import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class FoolishOldManCard extends Card {
  readonly meta: CardMeta = {
    id: 'foolish-old-man',
    name: '우공이산',
    kind: 'spell',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.developEnv('지형', '산');
  }
}

export const FoolishOldMan = new FoolishOldManCard();
