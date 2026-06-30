import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 마법사[1/4, 결속, 배경:용사]. 용사가 레벨업할 때마다 +0/+1.
// 공격 대신: 무작위 적 하나의 힘을 이 유닛 지혜의 25%만큼 턴 종료시까지 감소시킨다.
class MageCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'mage',
    name: '마법사',
    kind: 'unit',
    power: 1,
    wisdom: 4,
    keywords: ['결속'],
    activeAbility: true,
    conditions: [{ need: 'keyword', keyword: '용사' }],
    desc: '결속. 용사가 레벨업할 때마다 +0/+1. 공격 대신 무작위 적의 힘을 지혜 25%만큼 턴 종료까지 감소.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:mageLevel`,
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
    const [picked] = ctx.board.pickRandom('oppField', ctx.controller, 1);
    if (!picked) return;
    // 호위(난입)로 대상이 다른 적 아군에게 넘어갈 수 있다.
    const enemyId = ctx.board.resolveTargeting(picked, { kind: 'spell' });
    if (enemyId === null) return;
    const want = Math.floor(ctx.board.wisdomOf(ctx.unitId) * 0.25);
    // 0 미만 클램프로 인한 버프 해제 오버슈트를 막기 위해 실제 감소량은 현재 힘 이하로 제한.
    const amount = Math.min(want, ctx.board.powerOf(enemyId));
    if (amount > 0) ctx.board.addTurnBuff(enemyId, 'power', -amount);
  }
}

export const Mage = new MageCard();
