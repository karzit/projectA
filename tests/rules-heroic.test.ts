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
  return g.state.field[p]
    .filter((id): id is string => !!id)
    .map((id) => g.state.units[id].cardId);
}

describe('영웅담 테마', () => {
  it('모험의 시작: 지역 전개 + 적 전장 슬라임 소환 + 퀘스트 카드 획득', () => {
    const g = toMain();
    g.state.hand.A.push('adventure-start');
    act(g, { type: 'play', player: 'A', cardId: 'adventure-start' });
    expect(g.state.hand.A).not.toContain('adventure-start');
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect(g.state.environment['지역']).toBe('시작의 마을');
    expect(namesOn(g, 'B')).toContain('slime');
    expect(g.state.hand.A).toContain('quest-slime');
  });

  it('퀘스트 - 슬라임 토벌: 장소 전개 + 적 전장에 슬라임 2 + 킹슬라임 1', () => {
    const g = toMain();
    g.state.hand.A.push('quest-slime');
    act(g, { type: 'play', player: 'A', cardId: 'quest-slime' });
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect(g.state.environment['장소']).toBe('슬라임 동굴');
    const b = namesOn(g, 'B');
    expect(b.filter((c) => c === 'slime').length).toBe(2);
    expect(b).toContain('king-slime');
  });

  it('용사: 환경이 변할 때마다 힘/지혜 +1/+1', () => {
    const g = toMain();
    const heroId = place(g, 'A', 'hero');
    g.state.hand.A.push('foolish-old-man'); // 지형:산 전개 → 환경 변화
    act(g, { type: 'play', player: 'A', cardId: 'foolish-old-man' });
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect(g.state.units[heroId].power).toBe(4);
    expect(g.state.units[heroId].wisdom).toBe(4);
  });

  it('킹슬라임: 다른 슬라임이 죽을 때마다 +1/+1', () => {
    const g = toMain();
    const atk = place(g, 'A', 'stone-monkey'); // 힘2 > 슬라임 힘1
    const king = place(g, 'B', 'king-slime');
    const slime = place(g, 'B', 'slime');
    act(g, { type: 'attack', player: 'A', attackerId: atk, targetId: slime });
    expect(g.state.units[slime]).toBeUndefined();
    expect(g.state.units[king].power).toBe(6); // 5 + 1
    expect(g.state.units[king].wisdom).toBe(4);
  });

  it('킹슬라임 최후: 죽을 때 적 용사에게 지략 2 부여', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero');
    const king = place(g, 'B', 'king-slime');
    const killer = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(killer, 'power', 6); // 힘8 > 킹슬라임 힘7
    expect(g.state.units[hero].cunning).toBe(0);
    act(g, { type: 'attack', player: 'A', attackerId: killer, targetId: king });
    expect(g.state.units[king]).toBeUndefined();
    expect(g.state.units[hero].cunning).toBe(2);
  });

  it('용사 레벨링: 소환 시 exp 0/1, 적 처치 시 레벨업 + +1/+1 + 진행도 갱신', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 3/3
    expect(g.state.units[hero].level).toBe(0);
    expect(g.state.units[hero].exp).toBe(0);
    expect(g.state.units[hero].expMax).toBe(1);
    const slime = place(g, 'B', 'slime'); // 1/0 → 처치 점수 1
    act(g, { type: 'attack', player: 'A', attackerId: hero, targetId: slime });
    expect(g.state.units[slime]).toBeUndefined();
    // 점수 1 → 피보나치 1단계 돌파 → 레벨1, +1/+1
    expect(g.state.units[hero].level).toBe(1);
    expect(g.state.units[hero].power).toBe(4);
    expect(g.state.units[hero].wisdom).toBe(4);
    expect(g.state.units[hero].exp).toBe(1);
    expect(g.state.units[hero].expMax).toBe(2); // 다음 임계 = 2
  });

  it('결속: 한 턴에 결속 카드 한 장만 낼 수 있다', () => {
    const g = toMain();
    place(g, 'A', 'hero'); // 배경:용사 충족
    place(g, 'B', 'stone-monkey'); // B가 빈 전장으로 패배하지 않도록
    g.state.hand.A.push('warrior', 'priest');
    act(g, { type: 'play', player: 'A', cardId: 'warrior' });
    const r = g.apply({ type: 'play', player: 'A', cardId: 'priest' });
    expect(r.error).toMatch(/결속/);
    // 턴이 지나면 다시 낼 수 있다
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'pass', player: 'B' });
    const r2 = g.apply({ type: 'play', player: 'A', cardId: 'priest' });
    expect(r2.error).toBeUndefined();
  });

  it('전사: 용사가 레벨업할 때마다 +1/0', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 3/3
    const warrior = place(g, 'A', 'warrior'); // 3/2
    const slime = place(g, 'B', 'slime'); // 처치 점수 1 → 레벨1
    act(g, { type: 'attack', player: 'A', attackerId: hero, targetId: slime });
    expect(g.state.units[warrior].power).toBe(4); // 3 + 1
    expect(g.state.units[warrior].wisdom).toBe(2);
  });

  it('사제: 공격 대신 아군에게 지혜 25%만큼 힘 부여 (턴 종료 시 해제)', () => {
    const g = toMain();
    place(g, 'A', 'hero');
    const priest = place(g, 'A', 'priest'); // 지혜 4 → 25% = 1
    const ally = place(g, 'A', 'stone-monkey'); // 힘 2
    act(g, { type: 'ability', player: 'A', unitId: priest, choices: [ally] });
    expect(g.state.units[ally].power).toBe(3);
    expect(g.state.actedThisTurn).toContain(priest);
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[ally].power).toBe(2);
  });

  it('마법사: 공격 대신 무작위 적 힘 감소 (턴 종료 시 복구)', () => {
    const g = toMain();
    place(g, 'A', 'hero');
    const mage = place(g, 'A', 'mage'); // 지혜 4 → 25% = 1
    const enemy = place(g, 'B', 'stone-monkey'); // 힘 2
    act(g, { type: 'ability', player: 'A', unitId: mage });
    expect(g.state.units[enemy].power).toBe(1);
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy].power).toBe(2);
  });

  it('폭탄: 부동 충족 시 힘 10 이하 적 파괴 (턴 종료 시 처리)', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero');
    g.board.modifyStat(hero, 'wisdom', 17); // 배경 지혜:20 충족 (3+17)
    const enemy = place(g, 'B', 'stone-monkey'); // 힘 2 ≤ 10 → 파괴
    g.state.hand.A.push('bomb');
    act(g, { type: 'play', player: 'A', cardId: 'bomb', choices: [enemy] });
    expect(g.state.units[enemy]).toBeDefined(); // 아직 미처리
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy]).toBeUndefined();
  });

  it('폭탄: 힘 10 초과 적은 힘 -5', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero');
    g.board.modifyStat(hero, 'wisdom', 17);
    const enemy = place(g, 'B', 'stone-monkey');
    g.board.modifyStat(enemy, 'power', 9); // 2+9 = 11 > 10 → -5
    g.state.hand.A.push('bomb');
    act(g, { type: 'play', player: 'A', cardId: 'bomb', choices: [enemy] });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy].power).toBe(6);
  });

  it('폭탄: 부동 미충족(아군이 행동함) 시 불발', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // cell 0 (auto)
    g.board.modifyStat(hero, 'wisdom', 17);
    const enemy = place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('bomb');
    act(g, { type: 'play', player: 'A', cardId: 'bomb', choices: [enemy] });
    act(g, { type: 'move', player: 'A', unitId: hero, toCell: 1 }); // 행동 발생
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy]).toBeDefined(); // 부동 불발 → 생존
  });

  it('교회: 사망한 아군 용사를 강화효과 유지한 채 부활 (현재 exp만 리셋)', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 3/3
    place(g, 'A', 'stone-monkey'); // A 전장이 비어 패배하지 않도록
    const killer = place(g, 'B', 'stone-monkey'); // B 전장 채우기 + 처형자
    g.board.modifyStat(killer, 'power', 20);
    g.board.modifyStat(hero, 'power', 5); // 강화 → 힘 8
    g.board.setHeroProgress(hero, 5, 11, 13); // exp 11/13 가정
    // 용사 사망 (적 강타) — B턴에 처리하기 위해 먼저 A가 pass
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'attack', player: 'B', attackerId: killer, targetId: hero });
    expect(g.state.units[hero]).toBeUndefined(); // 용사 사망
    // A턴: 교회 발동
    act(g, { type: 'pass', player: 'B' });
    g.state.hand.A.push('church');
    act(g, { type: 'play', player: 'A', cardId: 'church' });
    act(g, { type: 'pass', player: 'A' });
    const revived = g.state.field.A.filter((id): id is string => !!id).map((id) => g.state.units[id])
      .find((u) => u.cardId === 'hero');
    expect(revived).toBeDefined();
    expect(revived!.power).toBe(8); // 강화 유지
    expect(revived!.exp).toBe(0);   // 현재 경험치 리셋
    expect(revived!.expMax).toBe(13); // 최대치 유지
  });

  it('풀 플레이트 아머: 공격받을 때 전투 동안 +3/0 (생존 시 복구)', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 힘 3
    g.board.modifyStat(hero, 'wisdom', 9); // 배경 지혜:12 충족 (3+9)
    const atk = place(g, 'B', 'stone-monkey'); // B 전장 채우기 + 이후 공격자
    g.board.modifyStat(atk, 'power', 3); // 힘 5
    g.state.hand.A.push('full-plate-armor');
    act(g, { type: 'play', player: 'A', cardId: 'full-plate-armor', choices: [hero] });
    act(g, { type: 'pass', player: 'A' }); // 부여 처리
    // B턴: 힘 5 공격 → 용사 힘 3이지만 전투 중 +3 = 6 → 공격자(5) 파괴, 용사 생존
    act(g, { type: 'attack', player: 'B', attackerId: atk, targetId: hero });
    expect(g.state.units[atk]).toBeUndefined(); // 공격자 파괴 (armor로 6 > 5)
    expect(g.state.units[hero]).toBeDefined();  // 용사 생존
    // 전투 후 armor +3 복구. 단 공격자(힘5/지혜0) 처치로 피보나치 4단계 레벨업 → +4/+4.
    // 따라서 3(기본) + 4(레벨) = 7 (armor 미복구였다면 10).
    expect(g.state.units[hero].power).toBe(7);
  });

  it('기본 체력물약: 대상 유닛이 이번 턴 동안 +2/0, 턴 종료 시 해제', () => {
    const g = toMain();
    const unit = place(g, 'A', 'stone-monkey'); // 힘2
    g.board.modifyStat(unit, 'wisdom', 3); // 지혜 4 → 배경 충족
    g.state.hand.A.push('health-potion');
    act(g, { type: 'play', player: 'A', cardId: 'health-potion', choices: [unit] });
    expect(g.state.units[unit].power).toBe(4);
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[unit].power).toBe(2);
  });
});
