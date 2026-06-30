import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 함정![배경:지혜:15]. 적 전장 한 칸을 선택한다. 그 칸에 다음에 들어온 유닛의 힘을
// 5 감소시킨다(힘 5미만이면 처치). 이미 있는 유닛엔 발동하지 않는다. 상대는 모른다.
class TrapCard extends Card {
  readonly meta: CardMeta = {
    id: 'trap',
    name: '함정!',
    kind: 'spell',
    conditions: [{ need: 'wisdom', amount: 15 }],
    desc: '배경:지혜 15. 적 전장 한 칸에 함정 설치. 이후 그 칸에 들어온 유닛 힘 -5(5미만이면 처치).',
  };

  override onPlay(ctx: GameContext): void {
    const allCells = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
    const [cellStr] = ctx.choices.request({ from: allCells, min: 1, max: 1, prompt: '함정을 설치할 적 전장 칸 번호' });
    ctx.board.setTrap(ctx.controller, parseInt(cellStr, 10));
  }
}

export const Trap = new TrapCard();
