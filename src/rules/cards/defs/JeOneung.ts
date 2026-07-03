import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

class JeOneungCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'je-o-neung',
    name: '저오능',
    kind: 'unit',
    power: 10,
    wisdom: 6,
    keywords: ['승려', '대리방어'],
    evolveTarget: 'jeong-dan-saja',
    desc: '[진행:정단사자]. 배경:아군 삼장법사. 삼장법사가 이탈(사망)하면 같이 이탈.',
    conditions: [{ need: 'unit', name: '삼장법사', side: 'own' }],
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;
    ctx.events.on({
      key: `${unitId}:followTangMonkJeO`,
      controller,
      filter: (ev) => ev.kind === 'unitDied' && ev.cardId === 'tang-monk' && ev.controller === controller,
      fire: () => {
        if (ctx.board.getUnit(unitId)) ctx.board.exitUnit(unitId);
      },
    });
  }
}

export const JeOneung = new JeOneungCard();
