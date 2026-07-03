import { describe, expect, it } from 'vitest';
import { Game, unitCount } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function mixedDeck(): string[] {
  return ['foolish-old-man', ...Array.from({ length: 14 }, () => 'stone-monkey')];
}

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function game(): Game {
  return new Game({ decks: { A: deck(), B: deck() } });
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

// Directly place a unit on a field (bypassing hand) for combat scenarios.
function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
}

describe('opening phase', () => {
  it('both sides place up to 3, then the main phase begins with A', () => {
    const g = game();
    expect(g.state.phase).toBe('opening');
    let cell = 0;
    for (const p of ['A', 'B'] as PlayerId[]) {
      cell = 0;
      for (let i = 0; i < 3; i++) act(g, { type: 'placeOpening', player: p, cardId: 'stone-monkey', cell: cell++ });
    }
    expect(g.state.phase).toBe('main');
    expect(g.state.active).toBe('A');
    expect(unitCount(g.state, 'A')).toBe(3);
    expect(unitCount(g.state, 'B')).toBe(3);
    expect(g.state.hand.A.length).toBe(12);
  });

  it('finishOpening lets a player stop early', () => {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(unitCount(g.state, 'A')).toBe(1);
  });

  it('rejects a 4th opening card', () => {
    const g = game();
    for (let i = 0; i < 3; i++) act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: i });
    expect(g.apply({ type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 3 }).error).toBeTruthy();
  });

  it('rejects placing in an occupied cell', () => {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    expect(g.apply({ type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 }).error).toBeTruthy();
  });

  it('opening effects are deferred — environment not changed until opening ends', () => {
    const g = new Game({ decks: { A: mixedDeck(), B: deck() } });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'foolish-old-man', cell: 0 });
    expect(g.state.environment['장소']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'A' });
    expect(g.state.environment['장소']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(g.state.environment['장소']).toBe('산');
  });

  it('opening unit is NOT yet revealed for 배경 conditions of same-opening placements (D-2)', () => {
    // 오프닝에 낸 카드도 openingPlays 큐에 쌓여 있다가 양쪽 오프닝 완료 시 일괄
    // 처리된다 — 아직 처리 전이므로 같은 오프닝에서 낸 삼장법사는 저오능의
    // "아군 삼장법사" 배경에 아직 존재하지 않는 것으로 취급된다.
    const g = new Game({ decks: { A: ['tang-monk', 'je-o-neung', ...Array.from({length:13},()=>'stone-monkey')], B: deck() } });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'tang-monk', cell: 0 });
    expect(() => act(g, { type: 'placeOpening', player: 'A', cardId: 'je-o-neung', cell: 1 })).toThrow();
  });

  it('opening effects resolve A first, then B (선턴 이점)', () => {
    const g = new Game({
      decks: { A: mixedDeck(), B: ['foolish-old-man', ...Array.from({length:14},()=>'stone-monkey')] },
    });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'foolish-old-man', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'foolish-old-man', cell: 0 });
    expect(g.state.environment['장소']).toBeUndefined();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    expect(g.state.phase).toBe('main');
    expect(g.state.environment['장소']).toBe('산');
  });
});

describe('main phase turns', () => {
  function toMain(): Game {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('pass ends the turn; play and attack do not', () => {
    const g = toMain();
    expect(g.state.active).toBe('A');
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.active).toBe('B');
    act(g, { type: 'play', player: 'B', cardId: 'stone-monkey' });
    expect(g.state.active).toBe('B');
    expect(unitCount(g.state, 'B')).toBe(2);
    act(g, { type: 'pass', player: 'B' });
    expect(g.state.active).toBe('A');
  });

  it('can play multiple cards in the same turn', () => {
    const g = toMain();
    act(g, { type: 'play', player: 'A', cardId: 'stone-monkey', cell: 0 });
    expect(g.apply({ type: 'play', player: 'A', cardId: 'stone-monkey', cell: 1 }).error).toBeFalsy();
  });

  it('each unit can attack once per turn; same unit cannot attack twice', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 3); // power 6 > stone-monkey 3
    // Ensure atk can reach def1 (cell 0 attacks opp cell 0)
    const def1 = place(g, 'B', 'stone-monkey'); // auto cell 1 (cell 0 occupied)
    const def2 = place(g, 'B', 'stone-monkey'); // auto cell 2
    // Make targets reachable: move atk to cell that can hit def1's cell
    const atkUnit = g.state.units[atk];
    const def1Unit = g.state.units[def1];
    // Force positions so atk (cell N) can attack def1's cell
    g.state.field[atkUnit.controller][atkUnit.cell] = null;
    g.state.field[def1Unit.controller][def1Unit.cell] = null;
    atkUnit.cell = 1; g.state.field['A'][1] = atk;
    def1Unit.cell = 1; g.state.field['B'][1] = def1;
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def2 }).error).toBeTruthy();
  });

  it('different units can each attack once in the same turn', () => {
    const g = toMain();
    const atk1 = place(g, 'A', 'stone-monkey');
    const atk2 = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk1, 'power', 3);
    g.board.modifyStat(atk2, 'power', 3);
    const def1 = place(g, 'B', 'stone-monkey');
    const def2 = place(g, 'B', 'stone-monkey');
    // Align cells so attacks are in range
    const reposition = (id: string, player: PlayerId, cell: number) => {
      const u = g.state.units[id];
      g.state.field[player][u.cell] = null;
      u.cell = cell;
      g.state.field[player][cell] = id;
    };
    reposition(atk1, 'A', 1); reposition(def1, 'B', 1);
    reposition(atk2, 'A', 3); reposition(def2, 'B', 3);
    act(g, { type: 'attack', player: 'A', attackerId: atk1, targetId: def1 });
    act(g, { type: 'attack', player: 'A', attackerId: atk2, targetId: def2 });
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.state.units[def2]).toBeUndefined();
    expect(g.state.active).toBe('A');
  });

  it('rejects acting out of turn', () => {
    const g = toMain();
    expect(g.apply({ type: 'pass', player: 'B' }).error).toBeTruthy();
  });

  it('blocks playing a card whose 배경 is unmet', () => {
    const g = toMain();
    g.state.hand.A.push('monkey-king');
    expect(g.apply({ type: 'play', player: 'A', cardId: 'monkey-king' }).error).toBeTruthy();
  });

  it('우공이산(장소:산) 전개 후 미후왕을 낼 수 있다', () => {
    const g = new Game({
      decks: { A: ['monkey-king', 'foolish-old-man', ...Array.from({ length: 13 }, () => 'stone-monkey')], B: deck() },
    });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    act(g, { type: 'play', player: 'A', cardId: 'foolish-old-man' });
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'pass', player: 'B' });
    expect(g.state.environment['장소']).toBe('산');
    expect(g.apply({ type: 'play', player: 'A', cardId: 'monkey-king', cell: 1 }).error).toBeUndefined();
  });
});

describe('power combat', () => {
  function toMain(): Game {
    const g = game();
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  // Helper: move unit to the given cell (test-only direct manipulation).
  function reposition(g: Game, id: string, player: PlayerId, cell: number): void {
    const u = g.state.units[id];
    g.state.field[player][u.cell] = null;
    u.cell = cell;
    g.state.field[player][cell] = id;
  }

  it('higher power destroys lower power', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 3); // power 6 > stone-monkey 3
    const def = place(g, 'B', 'stone-monkey');
    reposition(g, atk, 'A', 1); reposition(g, def, 'B', 1);
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(g.state.units[def]).toBeUndefined();
    expect(g.state.units[atk]).toBeDefined();
    expect(g.state.field.B[1]).toBeNull();
  });

  it('equal power destroys both', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    const def = place(g, 'B', 'stone-monkey');
    reposition(g, atk, 'A', 1); reposition(g, def, 'B', 1);
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: def });
    expect(g.state.units[atk]).toBeUndefined();
    expect(g.state.units[def]).toBeUndefined();
  });

  it('cannot attack your own unit', () => {
    const g = toMain();
    const a1 = place(g, 'A', 'traitor');
    const a2 = place(g, 'A', 'avenger');
    expect(g.apply({ type: 'attack', player: 'A', attackerId: a1, targetId: a2 }).error).toBeTruthy();
  });

  it('cannot attack a target outside attack range', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    const def = place(g, 'B', 'stone-monkey');
    // Put atk in cell 0 (attacks opp cells 0,1) and def in cell 4 (out of range)
    reposition(g, atk, 'A', 0); reposition(g, def, 'B', 4);
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def }).error).toBeTruthy();
  });
});

describe('이동 (move)', () => {
  function toMain(): Game {
    const g = game();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('유닛이 인접 빈 셀로 이동할 수 있다', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey'); // auto-assigned cell 0
    act(g, { type: 'move', player: 'A', unitId: u, toCell: 1 }); // 0→1 adjacent
    expect(g.state.units[u].cell).toBe(1);
    expect(g.state.field.A[0]).toBeNull();
    expect(g.state.field.A[1]).toBe(u);
  });

  it('이동 후 같은 턴 공격 불가', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey');
    const def = place(g, 'B', 'stone-monkey');
    // reposition so after move, unit would be in range
    g.state.units[u].cell = 0; g.state.field.A[0] = u;
    g.state.units[def].cell = 1; g.state.field.B[1] = def;
    act(g, { type: 'move', player: 'A', unitId: u, toCell: 1 });
    expect(g.apply({ type: 'attack', player: 'A', attackerId: u, targetId: def }).error).toBeTruthy();
  });

  it('공격 후 같은 턴 이동 불가', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(u, 'power', 3);
    const def = place(g, 'B', 'stone-monkey');
    g.state.units[u].cell = 1; g.state.field.A[1] = u;
    g.state.units[def].cell = 1; g.state.field.B[1] = def;
    act(g, { type: 'attack', player: 'A', attackerId: u, targetId: def });
    expect(g.apply({ type: 'move', player: 'A', unitId: u, toCell: 0 }).error).toBeTruthy();
  });

  it('비인접 셀로 이동 불가', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey'); // cell 0
    expect(g.apply({ type: 'move', player: 'A', unitId: u, toCell: 3 }).error).toBeTruthy();
  });

  it('점유된 인접 셀로 이동 → 두 유닛 위치 교환 + 둘 다 행동 소모', () => {
    const g = toMain();
    const u1 = place(g, 'A', 'stone-monkey'); // cell 0
    const u2 = place(g, 'A', 'stone-monkey'); // cell 1
    expect(g.apply({ type: 'move', player: 'A', unitId: u1, toCell: 1 }).error).toBeUndefined();
    expect(g.state.units[u1].cell).toBe(1);
    expect(g.state.units[u2].cell).toBe(0);
    expect(g.state.field.A[1]).toBe(u1);
    expect(g.state.field.A[0]).toBe(u2);
    expect(g.state.actedThisTurn).toContain(u1);
    expect(g.state.actedThisTurn).toContain(u2);
  });

  it('이미 행동한 유닛과는 스왑 불가', () => {
    const g = toMain();
    const u1 = place(g, 'A', 'stone-monkey'); // cell 0
    const u2 = place(g, 'A', 'stone-monkey'); // cell 1
    const def = place(g, 'B', 'stone-monkey'); // cell 0 — u2의 공격 대상 (제자리에서 행동만 소모)
    g.board.modifyStat(u2, 'power', 3); // u2가 이겨서 생존한 채 cell 1에 남도록
    act(g, { type: 'attack', player: 'A', attackerId: u2, targetId: def });
    expect(g.apply({ type: 'move', player: 'A', unitId: u1, toCell: 1 }).error).toBeTruthy();
  });

  it('턴이 끝나면 행동 제한 초기화', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey');
    place(g, 'B', 'stone-monkey'); // B 전장 유지(pass 시 패배 방지)
    act(g, { type: 'move', player: 'A', unitId: u, toCell: 1 });
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'pass', player: 'B' });
    // A의 새 턴: 다시 이동 가능
    expect(g.apply({ type: 'move', player: 'A', unitId: u, toCell: 0 }).error).toBeUndefined();
  });
});

describe('협공 (cooperative defense)', () => {
  // Auto-assign positions (empty field, toMain with finishOpening):
  //   atk → A[0], def1 → B[0], def2 → B[1]
  //   A[0] attacks B[0,1] → def1 in range; B[0]↔B[1] adjacent → def2 can cooperate.
  function toMain(): Game {
    const g = game();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('수비 합산 > 공격자: 전원 생존', () => {
    const g = toMain();
    const atk  = place(g, 'A', 'stone-monkey'); // A[0], power 2
    const def1 = place(g, 'B', 'stone-monkey'); // B[0], power 2 (primary target)
    const def2 = place(g, 'B', 'stone-monkey'); // B[1], power 2 (adjacent to def1)
    // 공격 선언 — 협공 가능한 def2가 있으므로 즉시 해결되지 않고 수비측 반응을 기다린다.
    const r = g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    expect(r.attackReactionRequest).toBeDefined();
    expect(r.attackReactionRequest!.player).toBe('B');
    expect(r.attackReactionRequest!.blockable).toEqual([def2]);
    // 수비측이 def2를 합류시킨다 — 합산 4 > atk 2 → 전원 생존
    act(g, { type: 'resolveAttack', player: 'B', blockerIds: [def2] });
    expect(g.state.units[atk]).toBeDefined();
    expect(g.state.units[def1]).toBeDefined();
    expect(g.state.units[def2]).toBeDefined();
  });

  it('수비 합산 <= 공격자: 수비 유닛 전원 파괴', () => {
    const g = toMain();
    const atk  = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 10); // power 12
    const def1 = place(g, 'B', 'stone-monkey'); // B[0], power 2
    const def2 = place(g, 'B', 'stone-monkey'); // B[1], power 2; adjacent to B[0]
    // 합산 4 <= 12 → 전원 파괴
    g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    act(g, { type: 'resolveAttack', player: 'B', blockerIds: [def2] });
    expect(g.state.units[atk]).toBeDefined();
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.state.units[def2]).toBeUndefined();
  });

  it('비인접 셀 유닛은 협공 불가 (반응 창 자체가 열리지 않는다)', () => {
    const g = toMain();
    const atk  = place(g, 'A', 'stone-monkey'); // A[0], power 2
    const def1 = place(g, 'B', 'stone-monkey'); // B[0], power 2
    // Skip B[1], put non-adjacent unit at B[3] (not adjacent to B[0])
    g.state.field.B[1] = 'dummy'; // reserve slot so next summon goes to B[2]
    g.state.field.B[2] = 'dummy';
    const def2 = place(g, 'B', 'stone-monkey'); // B[3], not adjacent to B[0]
    g.state.field.B[1] = null;
    g.state.field.B[2] = null;
    // def2가 협공 후보에 없으므로(비인접) 즉시 단독 1:1로 해결된다 — 동점이라 둘 다 사망.
    const r = g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def1 });
    expect(r.error).toBeUndefined();
    expect(r.attackReactionRequest).toBeUndefined();
    expect(g.state.units[atk]).toBeUndefined();
    expect(g.state.units[def1]).toBeUndefined();
    expect(g.state.units[def2]).toBeDefined(); // 협공에 관여하지 않았으므로 무사
  });

  it('협공에 참여한 유닛은 같은 턴 다시 협공 불가', () => {
    const g = toMain();
    // Auto layout: atk1→A[0], atk2→A[1], def1→B[0], blocker→B[1], def2→B[2]
    // Place blocker before def2 so blocker lands at B[1] (adjacent to both B[0] and B[2])
    const atk1    = place(g, 'A', 'stone-monkey'); // A[0]
    const atk2    = place(g, 'A', 'stone-monkey'); // A[1]
    const def1    = place(g, 'B', 'stone-monkey'); // B[0]
    const blocker = place(g, 'B', 'stone-monkey'); // B[1] — adjacent to B[0] AND B[2]
    const def2    = place(g, 'B', 'stone-monkey'); // B[2]
    // atk1(A[0]) attacks def1(B[0]) in range; blocker(B[1]) adj to def1(B[0]) ✓ — 협공 합류
    g.apply({ type: 'attack', player: 'A', attackerId: atk1, targetId: def1 });
    act(g, { type: 'resolveAttack', player: 'B', blockerIds: [blocker] });
    // atk2(A[1]) attacks def2(B[2]) in range; blocker는 이미 이번 턴 협공했으므로 후보에서 제외
    // → 다른 후보가 없으므로 즉시 단독 1:1로 해결된다(동점이라 둘 다 사망).
    const r = g.apply({ type: 'attack', player: 'A', attackerId: atk2, targetId: def2 });
    expect(r.error).toBeUndefined();
    expect(r.attackReactionRequest).toBeUndefined();
    expect(g.state.units[atk2]).toBeUndefined();
    expect(g.state.units[def2]).toBeUndefined();
    expect(g.state.units[blocker]).toBeDefined(); // 재협공하지 않았으므로 무사
  });

  it('협공에 참여한 유닛도 해당 턴 공격 가능', () => {
    const g = toMain();
    // atk→A[0], def→B[0], blocker→B[1] (adjacent to def)
    const atk     = place(g, 'A', 'stone-monkey'); // A[0]
    const def     = place(g, 'B', 'stone-monkey'); // B[0]
    const blocker = place(g, 'B', 'stone-monkey'); // B[1], adjacent to B[0]
    g.board.modifyStat(blocker, 'power', 10); // 협공 성공용
    g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def });
    act(g, { type: 'resolveAttack', player: 'B', blockerIds: [blocker] });
    act(g, { type: 'pass', player: 'A' });
    // B 턴: blocker(B[1])가 atk(A[0])을 공격 — ATTACK_LANES[1]=[0,1,2] ✓
    expect(g.apply({ type: 'attack', player: 'B', attackerId: blocker, targetId: atk }).error).toBeUndefined();
  });
});

describe('loss condition', () => {
  it('emptying a side\'s field at turn end causes a loss', () => {
    const g = game();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    const lone = place(g, 'B', 'stone-monkey');
    const killer = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(killer, 'power', 3); // power 5 (stone-monkey 2+3)
    // Align cells: killer cell 1, lone cell 1 (in attack range 0-2 of cell 1)
    const killerU = g.state.units[killer];
    const loneU = g.state.units[lone];
    g.state.field['A'][killerU.cell] = null; killerU.cell = 1; g.state.field['A'][1] = killer;
    g.state.field['B'][loneU.cell] = null;   loneU.cell = 1;   g.state.field['B'][1] = lone;
    // Clear B's other units so that after lone dies B's field is empty
    for (let c = 0; c < 9; c++) {
      const id = g.state.field.B[c];
      if (id && id !== lone) { delete g.state.units[id]; g.state.field.B[c] = null; }
    }
    act(g, { type: 'attack', player: 'A', attackerId: killer, targetId: lone });
    expect(g.state.units[lone]).toBeUndefined();
    expect(g.state.loser).toBeNull();
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('B');
  });

  it('패배 판정은 턴 종료 효과 정산 후 — 종말로 비운 전장을 복수자가 되살리면 시전자가 산다', () => {
    const g = new Game({
      decks: { A: ['end-of-days', 'avenger', ...Array.from({ length: 13 }, () => 'stone-monkey')], B: deck() },
    });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    g.board.modifyStat(g.state.field.A[0]!, 'wisdom', 20); // 종말 배경(단일 유닛 지혜 20) 충족
    act(g, { type: 'play', player: 'A', cardId: 'end-of-days' });
    act(g, { type: 'pass', player: 'A' });
    // 종말이 양쪽 전장을 비움 → 판정 전 settle에서 복수자가 A 전장에 자동 소환 → B만 빈 채 판정
    expect(unitCount(g.state, 'A')).toBe(1);
    expect(g.state.loser).toBe('B');
  });

  it('턴 종료 효과로 양쪽 전장이 비면(구제 수단 없음) 패스한 쪽이 패배한다', () => {
    const g = new Game({
      decks: { A: ['end-of-days', ...Array.from({ length: 14 }, () => 'stone-monkey')], B: deck() },
    });
    act(g, { type: 'placeOpening', player: 'A', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'placeOpening', player: 'B', cardId: 'stone-monkey', cell: 0 });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    g.board.modifyStat(g.state.field.A[0]!, 'wisdom', 20);
    act(g, { type: 'play', player: 'A', cardId: 'end-of-days' });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('A');
  });
});

describe('공격 사거리 — 유닛이 없는 칸은 거리 0으로 접힌다 (차폐)', () => {
  function emptyMain(): Game {
    const g = game();
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    return g;
  }

  it('상대 전열이 차 있으면 그 뒤 후열은 사거리 밖이다', () => {
    const g = emptyMain();
    const atk = g.board.summon('A', 'stone-monkey', 0); // 레인 0·1
    g.board.summon('B', 'stone-monkey', 0);
    g.board.summon('B', 'stone-monkey', 1);
    const back = g.board.summon('B', 'stone-monkey', 5); // 레인 0·1 뒤
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: back }).error).toBeTruthy();
  });

  it('상대 전열이 빈 레인으로는 후열을 직접 공격할 수 있다', () => {
    const g = emptyMain();
    const atk = g.board.summon('A', 'stone-monkey', 0);
    g.board.modifyStat(atk, 'power', 3);
    const back = g.board.summon('B', 'stone-monkey', 5); // 전열 0·1이 빈 상태
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: back });
    expect(g.state.units[back]).toBeUndefined();
  });

  it('후열 공격자는 같은 레인의 아군 전열 유닛에 가로막힌다', () => {
    const g = emptyMain();
    const atk = g.board.summon('A', 'stone-monkey', 5); // 레인 0·1
    g.board.summon('A', 'stone-monkey', 0);
    g.board.summon('A', 'stone-monkey', 1);
    const def = g.board.summon('B', 'stone-monkey', 0);
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def }).error).toBeTruthy();
  });

  it('아군 전열이 빈 레인으로는 후열에서도 공격할 수 있다', () => {
    const g = emptyMain();
    const atk = g.board.summon('A', 'stone-monkey', 5);
    const def = g.board.summon('B', 'stone-monkey', 0);
    expect(g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: def }).error).toBeFalsy();
  });
});
