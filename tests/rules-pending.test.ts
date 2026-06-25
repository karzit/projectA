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

describe('B-2 협공 동점: 합산 == 공격력 → 전원 생존', () => {
  it('동점이면 공격자와 수비 유닛 모두 생존', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 2); // 힘4
    const def1 = place(g, 'B', 'stone-monkey'); // 힘2
    const def2 = place(g, 'B', 'stone-monkey'); // 힘2  (합산 4 == 4)
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def1, blockers: [def2] });
    expect(g.state.units[atk]).toBeDefined();
    expect(g.state.units[def1]).toBeDefined();
    expect(g.state.units[def2]).toBeDefined();
  });
});

describe('B-2 동시 전멸: 턴 종료자(pass한 플레이어)가 패배', () => {
  it('A의 턴에 1:1 동점 교환으로 양쪽이 비면 A가 패배', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey'); // 힘2
    const def = place(g, 'B', 'stone-monkey'); // 힘2 → 1:1 동점, 양쪽 사망
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(g.state.field.A.length).toBe(0);
    expect(g.state.field.B.length).toBe(0);
    expect(g.state.loser).toBeNull(); // attack은 즉시 패배 판정 안 함
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('A');
  });

  it('B의 턴에 동시에 비면 B가 패배', () => {
    const g = toMain();
    const a = place(g, 'A', 'stone-monkey');
    const b = place(g, 'B', 'stone-monkey');
    act(g, { type: 'pass', player: 'A' }); // 양측 유닛 존재 → 패배 없음, B 턴
    expect(g.state.loser).toBeNull();
    act(g, { type: 'attack', player: 'B', attackerId: b, targetId: a }); // 동점 교환
    act(g, { type: 'pass', player: 'B' });
    expect(g.state.loser).toBe('B');
  });
});

describe('B-2 부활 의식: 전용 의식 카드 5회 → 마왕 강림', () => {
  it('부활 의식 카드를 5번 내면 패의 마왕이 자동 강림', () => {
    const g = new Game({ decks: { A: deck(), B: deck() } });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    place(g, 'A', 'stone-monkey'); // 양측 전장 유지(패배 방지)
    place(g, 'B', 'stone-monkey');
    g.state.hand.A = ['demon-king', ...Array.from({ length: 5 }, () => 'revival-ritual')];
    g.syncSubscriptions(); // 변경된 패 기준으로 마왕의 강림 구독 재등록

    for (let i = 0; i < 5; i++) {
      act(g, { type: 'play', player: 'A', cardId: 'revival-ritual' });
      const summoned = g.state.field.A.some((id) => g.state.units[id].cardId === 'demon-king');
      if (i < 4) expect(summoned).toBe(false);
      else expect(summoned).toBe(true);
      act(g, { type: 'pass', player: 'A' });
      act(g, { type: 'pass', player: 'B' });
    }
    expect(g.state.rituals['부활의식']).toBe(5);
    expect(g.state.hand.A).not.toContain('demon-king'); // 강림하여 패에서 빠짐
  });
});
