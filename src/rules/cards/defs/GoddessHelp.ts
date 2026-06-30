import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 여신의 도움[배경:용사. 결속. 부동]. 이번 턴 아무도 행동하지 않았다면, 선택한 적 유닛
// 하나의 능력치(힘/지혜)를 절반(내림)으로 만든다.
class GoddessHelpCard extends Card {
  readonly meta: CardMeta = {
    id: 'goddess-help',
    name: '여신의 도움',
    kind: 'spell',
    keywords: ['결속', '부동'],
    conditions: [{ need: 'keyword', keyword: '용사' }],
    desc: '결속·부동. 이번 턴 무행동 시 적 유닛 하나의 능력치를 절반으로.',
  };

  override onPlay(ctx: GameContext): void {
    if (!ctx.board.noActionThisTurn()) return; // 부동 미충족
    const enemies = ctx.board.fieldOf(ctx.board.otherPlayer(ctx.controller));
    const [chosen] = ctx.choices.request({ from: enemies, min: 1, max: 1, prompt: '능력치를 절반으로 만들 적' });
    const target = ctx.board.resolveTargeting(chosen, { kind: 'spell' });
    if (target === null) return; // 호위/성검 등
    const p = ctx.board.powerOf(target);
    const w = ctx.board.wisdomOf(target);
    ctx.board.modifyStat(target, 'power', Math.floor(p / 2) - p);
    ctx.board.modifyStat(target, 'wisdom', Math.floor(w / 2) - w);
  }
}

export const GoddessHelp = new GoddessHelpCard();
