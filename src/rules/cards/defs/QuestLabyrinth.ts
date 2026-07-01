import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 퀘스트 - 미궁 탐험: 전개(장소:지하 미궁) + 적 전장에 해골 병사 2 + 목 없는 기사 1
// (인접 칸에 머리 동반 소환) + '마왕성 입성' 획득.
class QuestLabyrinthCard extends Card {
  readonly meta: CardMeta = {
    id: 'quest-labyrinth',
    name: '퀘스트 - 미궁 탐험',
    kind: 'spell',
    desc: '[전개:장소:지하 미궁]. 상대에게 해골 병사 2 + 목 없는 기사(+머리) 소환. 마왕성 입성 획득.',
  };

  override onPlay(ctx: GameContext): void {
    const opp = ctx.board.otherPlayer(ctx.controller);
    ctx.board.developEnv('장소', '지하 미궁');
    ctx.board.summonCard(opp, 'skeleton-soldier');
    ctx.board.summonCard(opp, 'skeleton-soldier');
    const knightId = ctx.board.summonCard(opp, 'headless-knight');
    // 인접 칸에 머리 동반 소환 (인접 빈 칸이 없으면 자동 배치). 기사가 소환되지
    // 못했으면(전장 가득 참) 머리도 소환하지 않는다.
    const knightHandle = ctx.board.getUnit(knightId);
    if (knightHandle) {
      const headCell = ctx.board.freeAdjacentCell(opp, knightHandle.cell);
      ctx.board.summonCard(opp, 'headless-knight-head', headCell ?? undefined);
    }
    ctx.board.addToHand(ctx.controller, 'demon-castle');
  }
}

export const QuestLabyrinth = new QuestLabyrinthCard();
