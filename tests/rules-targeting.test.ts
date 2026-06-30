import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
}

function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
}

function toMain(): Game {
  const g = new Game({ decks: { A: deck(), B: deck() } });
  act(g, { type: 'finishOpening', player: 'A' });
  act(g, { type: 'finishOpening', player: 'B' });
  return g;
}

describe('타겟팅 리액션 파이프라인', () => {
  it('호위: 대상이 다른 무작위 아군으로 리다이렉트 (resolveTargeting)', () => {
    const g = toMain();
    const hero = place(g, 'B', 'hero');
    const guard = place(g, 'B', 'guard');
    // 다른 아군이 guard 하나뿐 → 결정적으로 guard로 리다이렉트
    expect(g.board.resolveTargeting(hero, { kind: 'attack' })).toBe(guard);
  });

  it('호위: 전투 공격이 호위 유닛으로 넘어간다', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey'); // 힘 2
    const hero = place(g, 'B', 'hero'); // 3/3 (B cell0)
    const guard = place(g, 'B', 'guard'); // 1/1 (B cell1)
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: hero });
    expect(g.state.units[hero]).toBeDefined();   // 원래 대상은 보호됨
    expect(g.state.units[guard]).toBeUndefined(); // 호위가 대신 맞고 파괴
    expect(g.state.units[atk]).toBeDefined();     // 공격자(2) > 호위(1)
  });

  it('호위가 없으면 리다이렉트 없음', () => {
    const g = toMain();
    const hero = place(g, 'B', 'hero');
    expect(g.board.resolveTargeting(hero, { kind: 'attack' })).toBe(hero);
  });

  it('성검: 자신을 대상으로 하는 wisdom-gated 주문을 지략 5로 무효화', () => {
    const g = toMain();
    const hero = place(g, 'B', 'hero');
    g.board.getUnit(hero)!.grantKeyword('성검');
    // 실효 지략 0+5 = 5
    expect(g.board.resolveTargeting(hero, { kind: 'spell', wisdomAmount: 5 })).toBeNull(); // 무효화
    expect(g.board.resolveTargeting(hero, { kind: 'spell', wisdomAmount: 6 })).toBe(hero); // 임계 초과 → 통과
    // 전투 공격에는 성검 무효화가 적용되지 않음
    expect(g.board.resolveTargeting(hero, { kind: 'attack' })).toBe(hero);
  });

  it('성검 없으면 주문 무효화 없음', () => {
    const g = toMain();
    const hero = place(g, 'B', 'hero');
    expect(g.board.resolveTargeting(hero, { kind: 'spell', wisdomAmount: 5 })).toBe(hero);
  });
});
