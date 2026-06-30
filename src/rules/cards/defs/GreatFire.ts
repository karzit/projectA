import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 불...위대한 불이여![배경:지혜:20]. 모든 유닛에게 -3/0을 부여하고
// 힘이 0 이하인 모든 유닛을 파괴한다.
class GreatFireCard extends Card {
  readonly meta: CardMeta = {
    id: 'great-fire',
    name: '불...위대한 불이여!',
    kind: 'spell',
    conditions: [{ need: 'wisdom', amount: 20 }],
    desc: '배경:지혜 20. 모든 유닛 힘 -3. 힘이 0이하인 유닛 처치.',
  };

  override onPlay(ctx: GameContext): void {
    const all = ctx.board.allFieldUnitIds();
    for (const id of all) ctx.board.modifyStat(id, 'power', -3);
    // 힘 0이 된 유닛 처치 (snapshot — modifyStat 후 재확인)
    for (const id of all) {
      if (ctx.board.getUnit(id) && ctx.board.powerOf(id) === 0) ctx.board.destroyUnit(id);
    }
  }
}

export const GreatFire = new GreatFireCard();
