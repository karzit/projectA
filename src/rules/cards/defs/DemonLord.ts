import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 마왕[44/44]. 아군과 협력하지 않는다(협공 블로커 불가; 협공 수비는 받을 수 있음).
// 최후: 자신의 컨트롤러가 패배한다. 직접 소환 불가 — 마왕성 입성(상대 전장에 소환)
// 으로만 등장한다.
class DemonLordCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'demon-lord',
    name: '마왕',
    kind: 'unit',
    token: true, // 생성 전용 토큰 — 덱 편성 불가
    power: 44,
    wisdom: 44,
    cannotCooperate: true,
    cannotSummon: true,
    desc: '직접 소환 불가. 아군과 협력하지 않습니다. 최후: 패배합니다.',
  };

  override onDeath(ctx: GameContext): void {
    ctx.board.declareLoss(ctx.controller);
  }
}

export const DemonLord = new DemonLordCard();
