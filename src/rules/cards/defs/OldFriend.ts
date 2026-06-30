import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 내 오랜 친구여[배경:지혜:30]. 선택한 유닛이 전장의 모든 다른 유닛과 1:1 전투한다.
// 아군도 포함.
class OldFriendCard extends Card {
  readonly meta: CardMeta = {
    id: 'old-friend',
    name: '내 오랜 친구여',
    kind: 'spell',
    conditions: [{ need: 'wisdom', amount: 30 }],
    desc: '배경:지혜 30. 아군 유닛 하나가 공격 가능한 모든 유닛(아군 포함)과 순서대로 전투.',
  };

  override onPlay(ctx: GameContext): void {
    const allies = ctx.board.fieldOf(ctx.controller);
    const [chosen] = ctx.choices.request({ from: allies, min: 1, max: 1, prompt: '전투할 아군 유닛' });
    const others = [...ctx.board.allFieldUnitIds()].filter((id) => id !== chosen);
    for (const target of others) {
      if (!ctx.board.getUnit(chosen)) break;
      if (!ctx.board.getUnit(target)) continue;
      ctx.board.resolveCombat1v1(chosen, target);
    }
  }
}

export const OldFriend = new OldFriendCard();
