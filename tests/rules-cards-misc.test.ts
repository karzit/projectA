// Coverage for cards with no prior test references (audit finding, 2026-07-01):
// Castling, CultRitual, Cultist, DarkArtsDream, EndOfDays, GTeacher, GreatFire,
// HolySword, OldFriend, SacredRituals (first/last-ritual), WickedGod.
//
// second-ritual / third-ritual reuse the exact same `performRitual` helper as
// first-ritual/last-ritual (see cards/defs/SacredRituals.ts) with only the sum/
// count/next-card parameterized — first + last exercise the shared logic (the
// sacrifice, cultist payout, and the 부동-gated next-card branch) end to end,
// so the two middle steps aren't separately retested.

import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
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
  return g.state.field[p]
    .filter((id): id is string => !!id)
    .map((id) => g.state.units[id].cardId);
}

describe('캐슬링', () => {
  it('개입: 아군 두 유닛의 위치를 즉시 교환한다', () => {
    const g = toMain();
    const a = place(g, 'A', 'stone-monkey'); // cell 0
    const b = place(g, 'A', 'stone-monkey'); // cell 1
    g.board.modifyStat(a, 'wisdom', 7); // 배경 지혜:8 충족 (7+1 = 8)
    g.state.hand.A.push('castling');
    act(g, { type: 'play', player: 'A', cardId: 'castling', choices: [a, b] });
    expect(g.state.units[a].cell).toBe(1);
    expect(g.state.units[b].cell).toBe(0);
    expect(g.state.field.A[0]).toBe(b);
    expect(g.state.field.A[1]).toBe(a);
  });
});

describe('사교 테마: 사교의 의식 / 사교도', () => {
  it('사교의 의식: 턴 종료 시 장소 전개 + 첫 번째 의식 획득', () => {
    const g = toMain();
    g.state.hand.A.push('cult-ritual');
    act(g, { type: 'play', player: 'A', cardId: 'cult-ritual' });
    expect(g.state.environment['장소']).toBeUndefined(); // 아직 미처리
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.environment['장소']).toBe('사교의 소굴');
    expect(g.state.hand.A).toContain('first-ritual');
  });

  it('사교도: 소환은 즉시, 장소 전개는 턴 종료 시', () => {
    const g = toMain();
    g.state.hand.A.push('cultist');
    act(g, { type: 'play', player: 'A', cardId: 'cultist' });
    expect(namesOn(g, 'A')).toContain('cultist'); // 유닛 소환은 즉시
    expect(g.state.environment['장소']).toBeUndefined();
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.environment['장소']).toBe('사교의 소굴');
  });
});

describe('사술-환몽', () => {
  it('배경(장소:사교의 소굴, 지혜3) 충족 시 힘≤x인 적 유닛을 아군으로 전환', () => {
    const g = toMain();
    g.board.developEnv('장소', '사교의 소굴');
    const ally = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(ally, 'wisdom', 2); // 총 지혜 3 → x = floor(3/3) = 1
    const weakEnemy = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(weakEnemy, 'power', -1); // 힘 1 ≤ x
    const strongEnemy = place(g, 'B', 'stone-monkey'); // 힘 2 > x — 대상 아님
    g.state.hand.A.push('dark-arts-dream');
    act(g, { type: 'play', player: 'A', cardId: 'dark-arts-dream', choices: [weakEnemy] });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[weakEnemy].controller).toBe('A');
    expect(g.state.units[strongEnemy].controller).toBe('B');
  });
});

describe('종말', () => {
  it('배경(단일 유닛 지혜 20) 충족 시 모든 유닛/환경 파괴 후 지역:황무지 전개', () => {
    const g = toMain();
    const caster = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(caster, 'wisdom', 19); // 20
    const ally2 = place(g, 'A', 'stone-monkey');
    const enemy = place(g, 'B', 'stone-monkey');
    g.board.developEnv('지형', '산');
    g.state.hand.A.push('end-of-days');
    act(g, { type: 'play', player: 'A', cardId: 'end-of-days' });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[caster]).toBeUndefined();
    expect(g.state.units[ally2]).toBeUndefined();
    expect(g.state.units[enemy]).toBeUndefined();
    expect(g.state.environment['지형']).toBeUndefined();
    expect(g.state.environment['지역']).toBe('황무지');
  });
});

describe('G선생', () => {
  it('최후: 다음 상대 턴 시작 시 G선생 2마리 소환', () => {
    const g = toMain();
    const gt = place(g, 'A', 'g-teacher');
    place(g, 'A', 'stone-monkey'); // A 비패배용 (G선생만 있으면 사망 시 필드 빔)
    g.board.destroyUnit(gt); // unitDied pending event
    act(g, { type: 'pass', player: 'A' }); // settle: onDeath 구독 등록 → turnStart(B) 발동
    expect(namesOn(g, 'A').filter((c) => c === 'g-teacher').length).toBe(2);
  });
});

describe('불...위대한 불이여!', () => {
  it('배경(지혜 20) 충족 시 모든 유닛 힘 -3, 0 이하는 파괴', () => {
    const g = toMain();
    const caster = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(caster, 'wisdom', 19); // 20
    g.board.modifyStat(caster, 'power', 4); // 힘 6 → -3 = 3, 생존
    const weakAlly = place(g, 'A', 'stone-monkey'); // 힘 2 → -3 = 0(clamp) → 파괴
    const strongEnemy = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(strongEnemy, 'power', 5); // 힘 7 → -3 = 4, 생존
    g.state.hand.A.push('great-fire');
    act(g, { type: 'play', player: 'A', cardId: 'great-fire' });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[caster].power).toBe(3);
    expect(g.state.units[weakAlly]).toBeUndefined();
    expect(g.state.units[strongEnemy].power).toBe(4);
  });
});

describe('성검', () => {
  it('개입: 배경(용사 존재 + 아군 힘 10 이상) 충족 시 아군 용사에게 성검 키워드 부여', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 힘3, 키워드 '용사'
    g.board.modifyStat(hero, 'power', 7); // 힘 10 → powerPresent:10 충족
    g.state.hand.A.push('holy-sword');
    act(g, { type: 'play', player: 'A', cardId: 'holy-sword' }); // 개입 → 즉시
    expect(g.state.units[hero].keywords).toContain('성검');
  });
});

describe('내 오랜 친구여', () => {
  it('배경(지혜 30) 충족 시 선택한 아군이 다른 모든 유닛과 순서대로 전투', () => {
    const g = toMain();
    const champion = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(champion, 'power', 18); // 힘 20 — 아래 모든 상대를 이김
    g.board.modifyStat(champion, 'wisdom', 29); // 지혜 30 충족
    const weakAlly = place(g, 'A', 'stone-monkey'); // 힘 2 — 챔피언에게 패배
    const enemy1 = place(g, 'B', 'stone-monkey');
    const enemy2 = place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('old-friend');
    act(g, { type: 'play', player: 'A', cardId: 'old-friend', choices: [champion] });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[champion]).toBeDefined(); // 힘 20 — 모두 이김
    expect(g.state.units[weakAlly]).toBeUndefined();
    expect(g.state.units[enemy1]).toBeUndefined();
    expect(g.state.units[enemy2]).toBeUndefined();
  });
});

describe('사특한 신 의식 체인 (첫 번째 의식 / 마지막 의식)', () => {
  it('첫 번째 의식: 힘+지혜=1인 아군 희생 → 사교도 획득, 부동 충족 시 두 번째 의식도 획득', () => {
    const g = toMain();
    g.board.developEnv('장소', '사교의 소굴');
    const sacrifice = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(sacrifice, 'power', -2); // 힘0 + 지혜1 = 1
    g.state.hand.A.push('first-ritual');
    act(g, { type: 'play', player: 'A', cardId: 'first-ritual', choices: [sacrifice] });
    act(g, { type: 'pass', player: 'A' }); // 이번 턴 아무 행동도 안 함 → 부동 충족
    expect(g.state.units[sacrifice]).toBeUndefined();
    expect(g.state.hand.B).not.toContain('cultist'); // 상대 손패는 안 건드림
    const handAfter = g.state.hand.A;
    expect(handAfter.filter((c) => c === 'cultist').length).toBe(1);
    expect(handAfter).toContain('second-ritual');
  });

  it('첫 번째 의식: 부동 불충족(이번 턴 행동함) 시 두 번째 의식은 획득하지 못한다', () => {
    const g = toMain();
    g.board.developEnv('장소', '사교의 소굴');
    const sacrifice = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(sacrifice, 'power', -2); // 힘0 + 지혜1 = 1
    const mover = place(g, 'A', 'stone-monkey');
    g.state.hand.A.push('first-ritual');
    act(g, { type: 'play', player: 'A', cardId: 'first-ritual', choices: [sacrifice] });
    act(g, { type: 'move', player: 'A', unitId: mover, toCell: 2 }); // mover는 cell1 (자동배치), cell2는 인접 빈칸
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.hand.A.filter((c) => c === 'cultist').length).toBe(1); // 희생 보상은 받음
    expect(g.state.hand.A).not.toContain('second-ritual'); // 부동 불충족 → 다음 의식 없음
  });

  it('마지막 의식: 힘+지혜=6인 아군 6마리 희생 → 사교도 6장 + 부동 충족 시 사특한 신 소환', () => {
    const g = toMain();
    g.board.developEnv('장소', '사교의 소굴');
    const sacrifices: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = place(g, 'A', 'stone-monkey');
      g.board.modifyStat(id, 'power', 3); // 힘5 + 지혜1 = 6
      sacrifices.push(id);
    }
    g.state.hand.A.push('last-ritual');
    act(g, { type: 'play', player: 'A', cardId: 'last-ritual', choices: sacrifices });
    act(g, { type: 'pass', player: 'A' });
    for (const id of sacrifices) expect(g.state.units[id]).toBeUndefined();
    expect(g.state.hand.A.filter((c) => c === 'cultist').length).toBe(6);
    expect(namesOn(g, 'A')).toContain('wicked-god');
  });
});

describe('사특한 신', () => {
  it('최후: 살아있는 아군 사특한 신 전원 +1/+1', () => {
    const g = toMain();
    const wg1 = g.board.summonCard('A', 'wicked-god');
    const wg2 = g.board.summonCard('A', 'wicked-god');
    const attacker = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(attacker, 'power', 10); // wg1을 파괴할 수 있을 만큼
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'attack', player: 'B', attackerId: attacker, targetId: wg1 });
    expect(g.state.units[wg1]).toBeUndefined(); // 최후 발동
    expect(g.state.units[wg2].power).toBe(7); // 6 + 1
    expect(g.state.units[wg2].wisdom).toBe(7);
  });

  it('등장(구독): 내 사교도가 사망하면 사특한 신을 추가 소환', () => {
    const g = toMain();
    const wg = g.board.summonCard('A', 'wicked-god');
    const cultist = place(g, 'A', 'cultist');
    const attacker = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(attacker, 'power', 2); // 힘4 > 사교도 힘3
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'attack', player: 'B', attackerId: attacker, targetId: cultist });
    expect(g.state.units[cultist]).toBeUndefined();
    expect(g.state.units[wg]).toBeDefined(); // 기존 사특한 신 생존
    expect(namesOn(g, 'A').filter((c) => c === 'wicked-god').length).toBe(2); // 새로 1마리 추가 소환
  });
});

describe('정단사자', () => {
  it('매 턴 시작 시(자신 컨트롤러) 환경 중 무작위 1개를 제거', () => {
    const g = toMain();
    place(g, 'A', 'jeong-dan-saja');
    place(g, 'B', 'stone-monkey'); // B 비패배용
    g.board.developEnv('지형', '산');
    act(g, { type: 'pass', player: 'A' }); // B 턴 시작 — 정단사자 컨트롤러(A) 아님, 미발동
    expect(g.state.environment['지형']).toBe('산');
    act(g, { type: 'pass', player: 'B' }); // A 턴 시작 — 발동, 유일한 환경 하나 제거
    expect(g.state.environment['지형']).toBeUndefined();
  });
});
