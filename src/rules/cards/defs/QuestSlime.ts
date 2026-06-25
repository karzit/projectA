import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 퀘스트 - 슬라임 토벌: 전개(장소:슬라임 동굴) + 적 전장에 슬라임 2마리와
// 킹슬라임 1마리를 소환한다.
class QuestSlimeCard extends Card {
  readonly meta: CardMeta = {
    id: 'quest-slime',
    name: '퀘스트 - 슬라임 토벌',
    kind: 'spell',
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    ctx.board.developEnv('장소', '슬라임 동굴');
    ctx.board.summonCard(opp, 'slime');
    ctx.board.summonCard(opp, 'slime');
    ctx.board.summonCard(opp, 'king-slime');
  }
}

export const QuestSlime = new QuestSlimeCard();
