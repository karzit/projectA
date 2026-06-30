import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 폭탄[배경:용사, 지혜:10. 부동]. 대상 적 유닛의 힘을 5 감소시킨다.
// 힘이 10 이하라면 대신 파괴한다. 턴 종료(pass) 시 처리되며, 이번 턴 아무도
// 행동하지 않았을 때만(부동) 발동한다.
class BombCard extends Card {
  readonly meta: CardMeta = {
    id: 'bomb',
    name: '폭탄',
    kind: 'spell',
    keywords: ['부동'],
    conditions: [{ need: 'wisdom', amount: 20 }],
    desc: '부동. 대상 적의 힘을 5 감소(힘 10 이하면 파괴). 이번 턴 아무도 행동하지 않아야 발동.',
  };

  override onPlay(ctx: GameContext): void {
    if (!ctx.board.noActionThisTurn()) return; // 부동 미충족 — 불발
    const enemies = ctx.board.fieldOf(ctx.board.otherPlayer(ctx.controller));
    const [chosen] = ctx.choices.request({ from: enemies, min: 1, max: 1, prompt: '폭탄 대상' });
    // 호위(난입)로 대상이 다른 적 아군에게 넘어갈 수 있다.
    const target = ctx.board.resolveTargeting(chosen, { kind: 'spell', wisdomAmount: 20 });
    if (target === null) return; // 성검 등으로 무효화
    if (ctx.board.powerOf(target) <= 10) ctx.board.destroyUnit(target);
    else ctx.board.modifyStat(target, 'power', -5);
  }
}

export const Bomb = new BombCard();
