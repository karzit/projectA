import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 제물준비 체인: 카운트는 상태(state.rituals)가 아니라 카드 자체(remaining)에 있다 —
// 사용하면 그 카드는 소모되고, remaining이 남아 있으면 remaining을 1 줄인 다음
// 카드를 손에 새로 얻는다(마지막 카드는 remaining 0이라 재획득 없이 소모로 끝).
function makeSacrificePrep(remaining: number): Card {
  const id = remaining === 5 ? 'sacrifice-prep' : `sacrifice-prep-${remaining}`;
  const nextId = remaining > 0 ? `sacrifice-prep-${remaining - 1}` : null;
  const summonCount = 6 - remaining; // remaining=5 → 1마리, remaining=0 → 6마리

  class SacrificePrepCard extends Card {
    readonly meta: CardMeta = {
      id,
      name: '제물준비',
      kind: 'spell',
      token: remaining !== 5, // 체인 후속 카드는 생성 전용 토큰 — 덱 편성 불가
      conditions: [
        { need: 'env', type: '장소', value: '사교의 소굴' },
      ],
      desc: nextId
        ? `배경:장소:사교의 소굴. 0/1 희생양을 하나 소환합니다. 이번 게임동안 내 `
          + `희생양이 지혜를 추가로 1 얻고 제물준비가 하나의 희생양을 추가로 `
          + `소환합니다. (${remaining} 남음!)`
        : '배경:장소:사교의 소굴. 0/1 희생양을 하나 소환합니다. 이번 게임동안 내 '
          + '희생양이 지혜를 추가로 1 얻습니다. (마지막)',
    };

    override onPlay(ctx: GameContext): void {
      const controller = ctx.controller;
      for (let i = 0; i < summonCount; i++) ctx.board.summonCard(controller, 'sacrifice-lamb');
      for (const u of ctx.board.unitsOn(controller)) {
        if (u.cardId === 'sacrifice-lamb') u.buffStat('wisdom', 1);
      }
      if (nextId) ctx.board.addToHand(controller, nextId);
    }
  }

  return new SacrificePrepCard();
}

export const SacrificePrep = makeSacrificePrep(5);
export const SacrificePrep4 = makeSacrificePrep(4);
export const SacrificePrep3 = makeSacrificePrep(3);
export const SacrificePrep2 = makeSacrificePrep(2);
export const SacrificePrep1 = makeSacrificePrep(1);
export const SacrificePrep0 = makeSacrificePrep(0);
