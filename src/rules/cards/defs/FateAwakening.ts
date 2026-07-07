import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 운명의 자각: 전개(지역:왕성) + 적 전장에 고블린 2마리 소환 + '퀘스트 - 미궁 탐험' 획득.
class FateAwakeningCard extends Card {
  readonly meta: CardMeta = {
    id: 'fate-awakening',
    name: '운명의 자각',
    kind: 'spell',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    desc: '[전개:지역:왕성]. 상대 전장에 고블린 2마리 소환. 퀘스트-미궁 탐험 획득.',
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    ctx.board.developEnv('지역', '왕성');
    ctx.board.summonCard(opp, 'goblin');
    ctx.board.summonCard(opp, 'goblin');
    ctx.board.addToHand(ctx.controller, 'quest-labyrinth');
  }
}

export const FateAwakening = new FateAwakeningCard();
