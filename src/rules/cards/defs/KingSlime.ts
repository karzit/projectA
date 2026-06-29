import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 킹슬라임[7/3, 지략 4]. 다른 슬라임이 사망할 때마다 +1/+1.
// 최후: 적 용사에게 지략2를 부여한다.
class KingSlimeCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'king-slime',
    name: '킹슬라임',
    kind: 'unit',
    power: 7,
    wisdom: 3,
    cunning: 4,
    keywords: ['슬라임', '왕'],
    desc: "지략 4. 내 슬라임 파괴 시 힘/지혜 +1/+1. 파괴 시 상대 영웅에게 지략 2 부여.",
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return; // 필드에서만 발동
    const unitId = ctx.unitId;
    ctx.events.on({
      key: `${unitId}:slimeFeast`,
      controller: ctx.controller,
      // 다른 슬라임의 사망 (자신 제외)
      filter: (ev) => ev.kind === 'unitDied' && ev.name === '슬라임' && ev.instanceId !== unitId,
      fire: () => {
        ctx.board.modifyStat(unitId, 'power', 1);
        ctx.board.modifyStat(unitId, 'wisdom', 1);
      },
    });
  }

  override onDeath(ctx: GameContext): void {
    // 최후: 적(상대) 전장의 용사에게 지략2 부여
    const opp = ctx.board.otherPlayer(ctx.controller);
    for (const u of ctx.board.unitsOn(opp)) {
      if (u.cardId === 'hero') u.grantCunning(2);
    }
  }
}

export const KingSlime = new KingSlimeCard();
