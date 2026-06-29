import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 모험의 시작: 전개(지역:시작의 마을) + 적 전장에 슬라임 1마리 소환
// + 퀘스트-슬라임 토벌 한 장을 패에 얻는다.
class AdventureStartCard extends Card {
  readonly meta: CardMeta = {
    id: 'adventure-start',
    name: '모험의 시작',
    kind: 'spell',
    desc: "[전개:지역:시작의 마을]. 상대 전장에 슬라임 소환. 퀘스트-슬라임토벌 획득.",
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    ctx.board.developEnv('지역', '시작의 마을');
    ctx.board.summonCard(opp, 'slime');
    ctx.board.addToHand(ctx.controller, 'quest-slime');
  }
}

export const AdventureStart = new AdventureStartCard();
