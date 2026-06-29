import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 전사[5/2, 결속, 배경:용사]. 용사가 레벨업할 때마다 +2/0.
// 이중방어: 한 턴에 두 번 협공할 수 있다.
class WarriorCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'warrior',
    name: '전사',
    kind: 'unit',
    power: 5,
    wisdom: 2,
    keywords: ['결속', '이중방어'],
    conditions: [{ need: 'keyword', keyword: '용사' }],
    desc: '결속. 용사가 레벨업할 때마다 +2/0. 한 턴에 2번 방어할 수 있습니다.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:warriorLevel`,
      controller,
      filter: (ev) => ev.kind === 'heroLevelUp' && ev.controller === controller,
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return;
        ctx.board.modifyStat(unitId, 'power', 2);
      },
    });
  }
}

export const Warrior = new WarriorCard();
