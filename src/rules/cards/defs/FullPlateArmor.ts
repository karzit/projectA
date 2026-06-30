import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 풀 플레이트 아머[배경:지혜:12]. 선택한 아군 유닛 하나에게 '공격받을 경우 전투
// 종료시까지 +3/0'을 부여한다('수비강화3' 키워드 — 전투 처리에서 방어 시 +3 힘 적용
// 후 생존 시 복구).
class FullPlateArmorCard extends Card {
  readonly meta: CardMeta = {
    id: 'full-plate-armor',
    name: '풀 플레이트 아머',
    kind: 'spell',
    conditions: [{ need: 'wisdom', amount: 12 }],
    desc: '아군 유닛 하나에게 "공격받을 경우 전투 종료시까지 +3/0"을 부여.',
  };

  override onPlay(ctx: GameContext): void {
    const allies = ctx.board.fieldOf(ctx.controller);
    const [target] = ctx.choices.request({ from: allies, min: 1, max: 1, prompt: '갑옷을 부여할 아군' });
    ctx.board.getUnit(target)?.grantKeyword('수비강화3');
  }
}

export const FullPlateArmor = new FullPlateArmorCard();
