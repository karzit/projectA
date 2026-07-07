import { describe, expect, it } from 'vitest';
import { Game, unitCount } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
  // 협공 가능한 (incidental) 수비 유닛이 있어도 이 헬퍼를 쓰는 테스트는 기본적으로
  // 단독 방어를 의도하므로 자동으로 opt-out 한다. 협공 자체를 테스트할 때는
  // g.apply()로 직접 attack을 선언하고 resolveAttack을 명시적으로 호출할 것.
  if (r.attackReactionRequest) {
    const r2 = g.apply({ type: 'resolveAttack', player: r.attackReactionRequest.player, blockerIds: [] });
    if (r2.error) throw new Error(r2.error);
  }
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

function reposition(g: Game, id: string, player: PlayerId, cell: number): void {
  const u = g.state.units[id];
  if (u.cell !== cell) {
    g.state.field[player][u.cell] = null;
    u.cell = cell;
    g.state.field[player][cell] = id;
  }
}

describe('B-2 협공 동점: 합산 == 공격력 → 전원 생존', () => {
  it('동점이면 공격자와 수비 유닛 모두 생존', () => {
    const g = toMain();
    // Auto-assign: atk→A[0], def1→B[0], def2→B[1] (B[0]↔B[1] adjacent)
    const atk  = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 2); // 힘4
    const def1 = place(g, 'B', 'stone-monkey'); // 힘2, B[0]
    const def2 = place(g, 'B', 'stone-monkey'); // 힘2, B[1] adjacent to B[0]
    // 합산 4 == 4 → 전원 생존
    g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    act(g, { type: 'resolveAttack', player: 'B', blockerIds: [def2] });
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
    reposition(g, atk, 'A', 1); reposition(g, def, 'B', 1);
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(unitCount(g.state, 'A')).toBe(0);
    expect(unitCount(g.state, 'B')).toBe(0);
    expect(g.state.loser).toBeNull(); // attack은 즉시 패배 판정 안 함
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('A');
  });

  it('B의 턴에 동시에 비면 B가 패배', () => {
    const g = toMain();
    const a = place(g, 'A', 'stone-monkey');
    const b = place(g, 'B', 'stone-monkey');
    reposition(g, a, 'A', 1); reposition(g, b, 'B', 1);
    act(g, { type: 'pass', player: 'A' }); // 양측 유닛 존재 → 패배 없음, B 턴
    expect(g.state.loser).toBeNull();
    act(g, { type: 'attack', player: 'B', attackerId: b, targetId: a }); // 동점 교환
    act(g, { type: 'pass', player: 'B' });
    expect(g.state.loser).toBe('B');
  });
});
