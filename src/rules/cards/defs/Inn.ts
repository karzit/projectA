import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 여관[부동]. 이번 턴 아무도 행동하지 않았다면, 모든 아군의 능력치 감소(부정적 턴버프)를 제거한다.
class InnCard extends Card {
  readonly meta: CardMeta = {
    id: 'inn',
    name: '여관',
    kind: 'spell',
    keywords: ['부동'],
    desc: '부동. 이번 턴 아무도 행동하지 않았다면 모든 아군의 능력치 감소를 제거.',
  };

  override onPlay(ctx: GameContext): void {
    if (!ctx.board.noActionThisTurn()) return; // 부동 미충족
    ctx.board.clearNegativeTurnBuffs(ctx.controller);
  }
}

export const Inn = new InnCard();
