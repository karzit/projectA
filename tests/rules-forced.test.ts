import { describe, expect, it } from 'vitest';
import { Game, getDef, performRitual, unitCount, fieldUnitIds } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function toMain(seed = 1): Game {
  const g = new Game({ decks: { A: deck(), B: deck() }, seed });
  g.apply({ type: 'finishOpening', player: 'A' });
  g.apply({ type: 'finishOpening', player: 'B' });
  return g;
}

function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
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

describe('forced abilities — settle loop', () => {
  it('복수자: rises from hand when its side has an empty field', () => {
    const g = toMain();
    g.state.hand.A = ['avenger'];
    g.syncSubscriptions();
    act(g, { type: 'pass', player: 'A' });
    const ids = fieldUnitIds(g.state, 'A');
    expect(ids.length).toBe(1);
    expect(getDef(g.state.units[ids[0]].cardId).name).toBe('복수자');
    expect(g.state.hand.A).not.toContain('avenger');
  });

  it('복수자: does NOT rise while a unit is already on its field', () => {
    const g = toMain();
    g.state.hand.A = ['avenger'];
    place(g, 'A', 'stone-monkey');
    g.syncSubscriptions();
    act(g, { type: 'pass', player: 'A' });
    expect(unitCount(g.state, 'A')).toBe(1);
    expect(g.state.hand.A).toContain('avenger');
  });

  it('배신자: as the highest 힘 AND 지혜 on its side, kills an ally and defects', () => {
    const g = toMain(1);
    g.state.hand.A = [];
    g.state.hand.B = [];
    const traitor = place(g, 'A', 'traitor');
    place(g, 'A', 'stone-monkey');
    act(g, { type: 'pass', player: 'A' });

    // traitor defected to B, some ally was destroyed
    expect(g.state.units[traitor].controller).toBe('B');
    expect(g.state.field.B).toContain(traitor);
    expect(g.state.field.A).not.toContain(traitor);
  });

  it('배신자: fires only once (its ability is once-per-game)', () => {
    const g = toMain();
    place(g, 'A', 'traitor');
    place(g, 'A', 'stone-monkey');
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.firedForced.some((k) => k.endsWith(':betray'))).toBe(true);
  });

  it('마왕: descends from hand once the 부활 의식 ritual reaches 5', () => {
    const g = toMain();
    g.state.hand.B = ['demon-lord'];
    g.syncSubscriptions();
    for (let i = 0; i < 5; i++) performRitual(g.state, '부활의식');
    act(g, { type: 'pass', player: 'A' });
    expect(fieldUnitIds(g.state, 'B').some((id) => g.state.units[id]?.cardId === 'demon-lord')).toBe(true);
    expect(g.state.hand.B).not.toContain('demon-lord');
  });

  it('마왕: stays in hand until the ritual is complete', () => {
    const g = toMain();
    g.state.hand.B = ['demon-lord'];
    g.syncSubscriptions();
    for (let i = 0; i < 4; i++) performRitual(g.state, '부활의식');
    act(g, { type: 'pass', player: 'A' });
    expect(unitCount(g.state, 'B')).toBe(0);
    expect(g.state.hand.B).toContain('demon-lord');
  });
});
