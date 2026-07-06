import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 힘+지혜 합이 정확히 targetSum인 아군 유닛 instanceId 목록 반환
function alliesWithSum(ctx: GameContext, targetSum: number): string[] {
  return ctx.board.unitsOn(ctx.controller)
    .filter((u) => u.power + u.wisdom === targetSum)
    .map((u) => u.instanceId);
}

// 공통 의식 onPlay: N명의 아군(힘+지혜===sum) 희생 → 사교도 N장 획득 → 부동이면 nextRitual 획득
function performRitual(ctx: GameContext, sum: number, count: number, nextRitual: string | null): void {
  const candidates = alliesWithSum(ctx, sum);
  if (candidates.length < count) return; // 조건 불충족
  const chosen = ctx.choices.request({
    from: candidates,
    min: count,
    max: count,
    prompt: `힘+지혜가 ${sum}인 아군 ${count}마리 희생`,
  });
  for (const id of chosen) ctx.board.destroyUnit(id);
  for (let i = 0; i < count; i++) ctx.board.addToHand(ctx.controller, 'cultist');
  if (nextRitual && ctx.board.noActionThisTurn()) {
    ctx.board.addToHand(ctx.controller, nextRitual);
  }
}

// --- 첫 번째 의식 ---
class FirstRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'first-ritual',
    name: '첫 번째 의식',
    kind: 'spell',
    // '부동': 다음 의식 획득 절이 noActionThisTurn 게이트(여관과 같은 키워드).
    keywords: ['의식', '부동'],
    conditions: [
      { need: 'wisdom', amount: 1 },
    ],
    desc: '배경:지혜 1. 힘+지혜=1인 아군 1마리 희생 → 사교도 1장. 부동:두 번째 의식 획득.',
  };
  override onPlay(ctx: GameContext): void { performRitual(ctx, 1, 1, 'second-ritual'); }
}

// --- 두 번째 의식 ---
class SecondRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'second-ritual',
    name: '두 번째 의식',
    kind: 'spell',
    keywords: ['의식', '부동'],
    conditions: [
      { need: 'wisdom', amount: 2 },
    ],
    desc: '배경:지혜 2. 힘+지혜=2인 아군 2마리 희생 → 사교도 2장. 부동:세 번째 의식 획득.',
  };
  override onPlay(ctx: GameContext): void { performRitual(ctx, 2, 2, 'third-ritual'); }
}

// --- 세 번째 의식 ---
class ThirdRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'third-ritual',
    name: '세 번째 의식',
    kind: 'spell',
    keywords: ['의식', '부동'],
    conditions: [
      { need: 'wisdom', amount: 3 },
    ],
    desc: '배경:지혜 3. 힘+지혜=3인 아군 3마리 희생 → 사교도 3장. 부동:마지막 의식 획득.',
  };
  override onPlay(ctx: GameContext): void { performRitual(ctx, 3, 3, 'last-ritual'); }
}

// --- 마지막 의식 ---
class LastRitualCard extends Card {
  readonly meta: CardMeta = {
    id: 'last-ritual',
    name: '마지막 의식',
    kind: 'spell',
    keywords: ['의식', '부동'],
    conditions: [
      { need: 'wisdom', amount: 6 },
    ],
    desc: '배경:지혜 6. 힘+지혜=6인 아군 6마리 희생 → 사교도 6장. 부동:사특한 신 소환.',
  };
  override onPlay(ctx: GameContext): void {
    const sum = 6;
    const count = 6;
    const candidates = alliesWithSum(ctx, sum);
    if (candidates.length < count) return;
    const chosen = ctx.choices.request({
      from: candidates,
      min: count,
      max: count,
      prompt: `힘+지혜가 ${sum}인 아군 ${count}마리 희생`,
    });
    for (const id of chosen) ctx.board.destroyUnit(id);
    for (let i = 0; i < count; i++) ctx.board.addToHand(ctx.controller, 'cultist');
    if (ctx.board.noActionThisTurn()) {
      ctx.board.summonCard(ctx.controller, 'wicked-god');
    }
  }
}

export const FirstRitual = new FirstRitualCard();
export const SecondRitual = new SecondRitualCard();
export const ThirdRitual = new ThirdRitualCard();
export const LastRitual = new LastRitualCard();
