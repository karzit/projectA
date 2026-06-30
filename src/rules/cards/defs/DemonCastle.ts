import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 마왕성 입성: 전개(지역:마왕성) + 적 전장에 마왕을 소환한다.
class DemonCastleCard extends Card {
  readonly meta: CardMeta = {
    id: 'demon-castle',
    name: '마왕성 입성',
    kind: 'spell',
    desc: '[전개:지역:마왕성]. 상대 전장에 마왕 소환.',
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    ctx.board.developEnv('지역', '마왕성');
    ctx.board.summonCard(opp, 'demon-lord');
  }
}

export const DemonCastle = new DemonCastleCard();
