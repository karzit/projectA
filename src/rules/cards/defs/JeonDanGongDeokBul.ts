import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class JeonDanGongDeokBulCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'jeon-dan-gong-deok-bul',
    name: '전단공덕불',
    kind: 'unit',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    power: 80,
    wisdom: 80,
    keywords: ['승려', '불'],
    desc: '매 턴 종료 시 무작위 적 유닛 1개를 구원(전장에서 이탈)시킨다.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:salvation`,
      controller,
      filter: (ev) => ev.kind === 'turnEnd' && ev.active === controller,
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return;
        const opp = ctx.board.otherPlayer(controller);
        const targets = ctx.board.fieldOf(opp);
        if (targets.length === 0) return;
        const picked = ctx.board.pickRandomFrom(targets)!;
        ctx.board.exitUnit(picked);
      },
    });
  }
}

export const JeonDanGongDeokBul = new JeonDanGongDeokBulCard();
