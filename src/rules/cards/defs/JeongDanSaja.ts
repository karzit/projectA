import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class JeongDanSajaCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'jeong-dan-saja',
    name: '정단사자',
    kind: 'unit',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    power: 50,
    wisdom: 50,
    keywords: ['신장'],
    desc: '매 턴 시작 시 현재 환경 중 무작위 1개를 제거.',
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:clearEnv`,
      controller,
      filter: (ev) => ev.kind === 'turnStart' && ev.active === controller,
      fire: () => {
        if (!ctx.board.getUnit(unitId)) return;
        const types = ctx.board.environmentTypes();
        if (types.length === 0) return;
        const picked = ctx.board.pickRandomFrom(types)!;
        ctx.board.removeEnvironment(picked);
      },
    });
  }
}

export const JeongDanSaja = new JeongDanSajaCard();
