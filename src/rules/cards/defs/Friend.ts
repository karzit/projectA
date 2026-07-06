import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import { HEX_ADJACENT } from '../../queries.js';

// "친구"[3/6]. 전개:장소:사교의 소굴. 이 유닛은 적 전장에 등장한다. 상대(원래 주인)
// 턴 시작 시 인접한 무작위 유닛의 힘 혹은 지혜를 무작위로 1 감소시키고, 그 유닛의
// 힘+지혜 합이 0 이하면 "친구"로 변화시킨다. 최후: 상대(원래 주인)가 사교도 1장 획득.
class FriendCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'friend',
    name: '친구',
    kind: 'unit',
    power: 3,
    wisdom: 6,
    desc: '전개:장소:사교의 소굴. 적 전장에 등장. 상대(원래 주인) 턴 시작시 인접한 무작위 유닛의 힘 또는 '
      + '지혜를 1 감소시키고, 힘+지혜 합이 0 이하면 "친구"로 변화. 최후:상대(원래 주인)가 사교도 1장 획득.',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.developEnv('장소', '사교의 소굴');
    if (ctx.unitId) ctx.board.setController(ctx.unitId, ctx.board.otherPlayer(ctx.controller));
  }

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const owner = ctx.controller; // 원래 주인 — 소환 직후(적 전장 이동 전) subscribe 시점의 controller

    ctx.events.on({
      key: `${unitId}:friend-turnstart`,
      controller: owner,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === owner,
      fire: () => {
        const self = ctx.board.getUnit(unitId);
        if (!self) return;
        const fieldOwner = self.controller;
        const candidates = (HEX_ADJACENT[self.cell] ?? [])
          .map((cell) => ctx.board.unitAtCell(fieldOwner, cell))
          .filter((id): id is string => !!id);
        const targetId = ctx.board.pickRandomFrom(candidates);
        if (!targetId) return;
        const stat = ctx.board.pickRandomFrom(['power', 'wisdom']) as 'power' | 'wisdom';
        ctx.board.modifyStat(targetId, stat, -1);
        const target = ctx.board.getUnit(targetId);
        if (target && target.power + target.wisdom <= 0) {
          ctx.board.evolveUnitTo(targetId, 'friend');
        }
      },
    });
  }

  override onDeath(ctx: GameContext): void {
    // onDeath 시점 ctx.controller는 사망 당시 필드 소유자(원래 주인의 상대)이므로,
    // "원래 주인"은 그 반대편이다.
    const originalOwner = ctx.board.otherPlayer(ctx.controller);
    ctx.board.addToHand(originalOwner, 'cultist');
  }
}

export const Friend = new FriendCard();
