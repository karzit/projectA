import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
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

function namesOn(g: Game, p: PlayerId): string[] {
  return g.state.field[p].filter((id): id is string => !!id).map((id) => g.state.units[id].cardId);
}

describe('영웅담 적 퀘스트 체인', () => {
  it('퀘스트-슬라임토벌이 운명의 자각을 패에 추가', () => {
    const g = toMain();
    g.state.hand.A.push('quest-slime');
    act(g, { type: 'play', player: 'A', cardId: 'quest-slime' });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.hand.A).toContain('fate-awakening');
  });

  it('운명의 자각: 지역:왕성 + 고블린 2 + 미궁 탐험 획득', () => {
    const g = toMain();
    g.state.hand.A.push('fate-awakening');
    act(g, { type: 'play', player: 'A', cardId: 'fate-awakening' });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.environment['지역']).toBe('왕성');
    expect(namesOn(g, 'B').filter((c) => c === 'goblin').length).toBe(2);
    expect(g.state.hand.A).toContain('quest-labyrinth');
  });

  it('미궁 탐험: 해골병사 2 + 목없는기사 + 머리 + 마왕성 입성 획득', () => {
    const g = toMain();
    g.state.hand.A.push('quest-labyrinth');
    act(g, { type: 'play', player: 'A', cardId: 'quest-labyrinth' });
    act(g, { type: 'pass', player: 'A' });
    const b = namesOn(g, 'B');
    expect(b.filter((c) => c === 'skeleton-soldier').length).toBe(2);
    expect(b).toContain('headless-knight');
    expect(b).toContain('headless-knight-head');
    expect(g.state.hand.A).toContain('demon-castle');
  });

  it('해골 병사 최후: 해골을 소환', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey'); // 힘 2
    g.board.modifyStat(atk, 'power', 4); // 힘 6 > 해골병사 5
    const soldier = place(g, 'B', 'skeleton-soldier');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: soldier });
    expect(g.state.units[soldier]).toBeUndefined();
    expect(namesOn(g, 'B')).toContain('skeleton');
  });

  it('목 없는 기사: 전투로 파괴되지 않지만, 머리가 없으면 파괴된다', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(atk, 'power', 20); // 압도적 힘
    const knight = place(g, 'B', 'headless-knight'); // 7/0, combatImmune
    const head = place(g, 'B', 'headless-knight-head');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: knight });
    expect(g.state.units[knight]).toBeDefined(); // 전투 면역 — 생존
    // 머리를 제거하면 정적 조건으로 기사 파괴
    g.board.destroyUnit(head);
    act(g, { type: 'pass', player: 'A' }); // settle에서 정적 조건 발동
    expect(g.state.units[knight]).toBeUndefined();
  });

  it('마왕: 아군과 협력하지 않지만(블로커 불가), 협공 수비의 대상은 될 수 있다 + 최후 시 컨트롤러 패배', () => {
    const g = toMain();
    place(g, 'A', 'stone-monkey'); // A 비패배용
    const demon = place(g, 'B', 'demon-lord'); // 44/44
    const ally = place(g, 'B', 'stone-monkey');
    const atk = place(g, 'A', 'stone-monkey');
    // 마왕은 협공 수비를 받을 수 있다 — 인접 아군(ally)이 있으면 반응 창이 열린다.
    const r = g.apply({ type: 'attack', player: 'A', attackerId: atk, targetId: demon });
    expect(r.error).toBeUndefined();
    expect(r.attackReactionRequest).toBeDefined();
    expect(r.attackReactionRequest?.blockable).toContain(ally);
    // ally를 합류시키지 않고 단독 방어 — 기존 시나리오(마왕 44/44 단독 생존) 재현
    const r2 = g.apply({ type: 'resolveAttack', player: r.attackReactionRequest!.player, blockerIds: [] });
    expect(r2.error).toBeUndefined();
    expect(g.state.units[demon]).toBeDefined(); // 44/44는 살아남고
    expect(g.state.units[atk]).toBeUndefined(); // 공격자만 사망
    expect(g.state.units[ally]).toBeDefined(); // 협공에 관여하지 않았으므로 무사
    // 마왕 최후 → B 패배
    g.board.destroyUnit(demon);
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.loser).toBe('B');
  });

  it('고블린 떼: 인접 고블린만 힘 합산, 패배 시 전원 파괴', () => {
    const g = toMain();
    const lead = g.board.summon('A', 'goblin', 1); // 선두 cell1 (인접: 0,2,5,6)
    const s0 = g.board.summon('A', 'goblin', 0);    // 인접
    const s2 = g.board.summon('A', 'goblin', 2);    // 인접 → 합 6
    const enemy = g.board.summon('B', 'stone-monkey', 0); // 힘 2
    g.board.modifyStat(enemy, 'power', 3); // 힘 5 < 6 → 적 파괴
    act(g, { type: 'attack', player: 'A', attackerId: lead, targetId: enemy });
    expect(g.state.units[enemy]).toBeUndefined();
    // 모두 생존(승리)
    expect(g.state.units[lead]).toBeDefined();
    expect(g.state.units[s0]).toBeDefined();
    expect(g.state.units[s2]).toBeDefined();
  });

  it('고블린 떼: 합산 힘이 모자라면 참여 고블린 전원 파괴', () => {
    const g = toMain();
    const lead = g.board.summon('A', 'goblin', 1);
    const s0 = g.board.summon('A', 'goblin', 0); // 합 4
    place(g, 'A', 'stone-monkey'); // A 비패배용
    const enemy = g.board.summon('B', 'stone-monkey', 0);
    g.board.modifyStat(enemy, 'power', 8); // 힘 10 > 4 → 고블린 전원 파괴
    act(g, { type: 'attack', player: 'A', attackerId: lead, targetId: enemy });
    expect(g.state.units[lead]).toBeUndefined();
    expect(g.state.units[s0]).toBeUndefined();
    expect(g.state.units[enemy]).toBeDefined();
  });

  it('여관: 부동 시 아군의 능력치 감소(부정적 턴버프) 제거', () => {
    const g = toMain();
    const u = place(g, 'A', 'stone-monkey'); // 힘 2
    g.board.addTurnBuff(u, 'power', -1); // 힘 -1 → 현재 힘 1
    expect(g.state.units[u].power).toBe(1);
    g.state.hand.A.push('inn');
    act(g, { type: 'play', player: 'A', cardId: 'inn' });
    act(g, { type: 'pass', player: 'A' }); // 아무도 행동 안 함 → 부동
    expect(g.state.units[u].power).toBe(2); // 감소 취소
  });

  it('여신의 도움: 부동 시 적 유닛 능력치 절반', () => {
    const g = toMain();
    place(g, 'A', 'hero'); // 배경:용사
    const enemy = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(enemy, 'power', 8); // 힘 10
    g.board.modifyStat(enemy, 'wisdom', 5); // 지혜 6
    g.state.hand.A.push('goddess-help');
    act(g, { type: 'play', player: 'A', cardId: 'goddess-help', choices: [enemy] });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy].power).toBe(5); // 10 → 5
    expect(g.state.units[enemy].wisdom).toBe(3); // 6 → 3
  });
});
