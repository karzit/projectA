import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 기본 체력물약: 내 유닛 하나가 이번 턴 동안 2/0을 얻는다.
// 대상은 choices[0] (내 전장의 유닛 instanceId).
class HealthPotionCard extends Card {
  readonly meta: CardMeta = {
    id: 'health-potion',
    name: '기본 체력물약',
    kind: 'spell',
  };

  override onPlay(ctx: GameContext): void {
    const own = ctx.board.unitsOn(ctx.controller).map((u) => u.instanceId);
    const [targetId] = ctx.choices.request({
      from: own,
      min: 1,
      max: 1,
      prompt: '강화할 내 유닛 1마리 선택',
    });
    ctx.board.getUnit(targetId)?.addTurnBuff('power', 2);
  }
}

export const HealthPotion = new HealthPotionCard();
