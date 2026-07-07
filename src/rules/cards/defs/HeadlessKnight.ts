import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 목 없는 기사[7/0]. 패배하지 않는다(전투로 파괴되지 않음). 단, 아군 전장에 '목 없는
// 기사의 머리'가 없으면 파괴된다(정적 조건). 등장 시 인접 칸에 머리가 함께 소환된다
// (소환은 퀘스트 카드 onPlay에서 처리).
class HeadlessKnightCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'headless-knight',
    name: '목 없는 기사',
    kind: 'unit',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    power: 7,
    wisdom: 0,
    combatImmune: true,
    desc: '패배하지 않습니다. 아군 전장에 목 없는 기사의 머리가 없으면 파괴됩니다.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return; // 필드에서만
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.onStatic({
      key: `${unitId}:needHead`,
      controller,
      once: false,
      check: () => !!ctx.board.getUnit(unitId) &&
        !ctx.board.hasUnitWithCardOnField(controller, 'headless-knight-head'),
      fire: () => ctx.board.destroyUnit(unitId),
    });
  }
}

export const HeadlessKnight = new HeadlessKnightCard();
