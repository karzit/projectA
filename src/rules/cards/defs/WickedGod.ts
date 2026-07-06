import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사특한 신[6/6]. 등장: 이번 게임동안 내 사교도들에게 "최후: 사특한 신을 소환합니다"를 부여.
// 최후: 이번 게임동안 내 모든 사특한 신이 +3/+3을 얻습니다.
class WickedGodCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'wicked-god',
    name: '사특한 신',
    kind: 'unit',
    power: 6,
    wisdom: 6,
    keywords: ['사특한 신'],
    desc: '등장: 내 사교도 사망 시 사특한 신 소환. 최후: 모든 아군 사특한 신 +3/+3.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    // 내 사교도가 사망할 때마다 새 사특한 신을 소환한다.
    ctx.events.on({
      key: `${unitId}:wickedGodSpawn`,
      controller,
      filter: (ev) => ev.kind === 'unitDied' && ev.controller === controller && ev.cardId === 'cultist',
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return; // 이 사특한 신이 이미 죽었으면 스킵
        ctx.board.summonCard(controller, 'wicked-god');
      },
    });
  }

  override onDeath(ctx: GameContext): void {
    const controller = ctx.controller;
    // 모든 살아있는 아군 사특한 신에게 +1/+1
    for (const u of ctx.board.unitsOn(controller)) {
      if (u.cardId === 'wicked-god') {
        ctx.board.modifyStat(u.instanceId, 'power', 3);
        ctx.board.modifyStat(u.instanceId, 'wisdom', 3);
      }
    }
  }
}

export const WickedGod = new WickedGodCard();
