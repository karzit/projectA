import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사제[2/4, 결속, 배경:용사]. 용사가 레벨업할 때마다 +0/1.
// 공격 대신: 아군 유닛 하나에게 이 유닛 지혜의 25%만큼 힘을 턴 종료시까지 부여한다.
class PriestCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'priest',
    name: '사제',
    kind: 'unit',
    power: 2,
    wisdom: 4,
    keywords: ['결속'],
    activeAbility: true,
    conditions: [{ need: 'keyword', keyword: '용사' }],
    desc: '결속. 용사가 레벨업할 때마다 +0/1. 공격 대신 아군에게 지혜 25%만큼 힘을 턴 종료까지 부여.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:priestLevel`,
      controller,
      filter: (ev) => ev.kind === 'heroLevelUp' && ev.controller === controller,
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return;
        ctx.board.modifyStat(unitId, 'wisdom', 1);
      },
    });
  }

  override onAbility(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const allies = ctx.board.fieldOf(ctx.controller).filter((id) => id !== ctx.unitId);
    const [target] = ctx.choices.request({ from: allies, min: 1, max: 1, prompt: '힘을 부여할 아군' });
    const amount = Math.floor(ctx.board.wisdomOf(ctx.unitId) * 0.25);
    if (amount > 0) ctx.board.addTurnBuff(target, 'power', amount);
  }
}

export const Priest = new PriestCard();
