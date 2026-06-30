import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// G선생[1/0]. 최후: 다음 상대 턴 시작 시 내 전장에 G선생을 둘 소환한다.
class GTeacherCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'g-teacher',
    name: 'G선생',
    kind: 'unit',
    power: 1,
    wisdom: 0,
    desc: '최후: 다음 상대 턴 시작 시 내 전장에 G선생 2마리 소환.',
  };

  override onDeath(ctx: GameContext): void {
    const owner = ctx.controller;
    const opp = ctx.board.otherPlayer(owner);
    const deadId = ctx.unitId ?? 'g-teacher';
    ctx.events.on({
      key: `g-teacher-respawn:${deadId}`,
      controller: owner,
      once: true,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === opp,
      fire: () => {
        ctx.board.summonCard(owner, 'g-teacher');
        ctx.board.summonCard(owner, 'g-teacher');
      },
    });
  }
}

export const GTeacher = new GTeacherCard();
