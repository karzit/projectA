import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class TangMonkCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'tang-monk',
    name: '삼장법사',
    kind: 'unit',
    power: 0,
    wisdom: 10,
    keywords: ['승려'],
    cannotAttack: true,
    evolveTarget: 'jeon-dan-gong-deok-bul',
    desc: '공격 불가. [진행:전단공덕불]. 사용 시 아군 오행산 유닛 해방. cell 4에 배치 후 매 턴 cell-1 이동; cell 0 도달 시 모든 아군 진행.',
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

    // cell 4로 강제 이동 (여정 시작점)
    const handle = board.getUnit(unitId);
    if (handle && handle.cell !== 4) {
      // Move to 4 only if cell is free.
      if (!board.unitAtCell(controller, 4)) {
        board.moveUnit(unitId, 4);
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
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        if (ctx.board.getUnit(unitId)) ctx.board.journeyStep(unitId);
      },
    });
  }
}

export const TangMonk = new TangMonkCard();
