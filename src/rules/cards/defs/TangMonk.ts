import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class TangMonkCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'tang-monk',
    name: '삼장법사',
    kind: 'unit',
    power: 0,
    wisdom: 10,
    keywords: ['승려', '대리방어필요'],
    evolveTarget: 'jeon-dan-gong-deok-bul',
    conditions: [{ need: 'trapped', side: 'own' }],
    desc: '배경: 아군 오행산 유닛 존재. [진행:전단공덕불]. 사용 시 아군 오행산 유닛 해방. '
      + '일반 유닛처럼 직접 공격/이동 가능 — cell 0에 도달한 채로 턴을 마치면 모든 아군 진행.',
  };

  override onPlay(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    const board = ctx.board;

    // 오행산에 갇힌 아군 유닛 해방 + 진행
    for (const id of board.fieldOf(controller)) {
      if (id !== unitId && board.isTrapped(id)) {
        board.untrap(id);
        board.evolveUnit(id);
      }
    }
  }

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:journey`,
      controller,
      filter: (ev) => ev.kind === 'turnEnd' && ev.active === controller,
      fire: () => {
        if (ctx.board.getUnit(unitId)) ctx.board.checkJourneyArrival(unitId);
      },
    });
  }
}

export const TangMonk = new TangMonkCard();
