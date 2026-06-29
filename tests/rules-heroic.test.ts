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
    expect(g.state.units[king].power).toBe(8);
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

  it('전사: 용사가 레벨업할 때마다 +2/0', () => {
    const g = toMain();
    const hero = place(g, 'A', 'hero'); // 3/3
    const warrior = place(g, 'A', 'warrior'); // 5/2
    const slime = place(g, 'B', 'slime'); // 처치 점수 1 → 레벨1
    act(g, { type: 'attack', player: 'A', attackerId: hero, targetId: slime });
    expect(g.state.units[warrior].power).toBe(7); // 5 + 2
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
    g.board.modifyStat(hero, 'wisdom', 7); // 배경 지혜:10 충족 (3+7)
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
    g.board.modifyStat(hero, 'wisdom', 7);
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
    g.board.modifyStat(hero, 'wisdom', 7);
    const enemy = place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('bomb');
    act(g, { type: 'play', player: 'A', cardId: 'bomb', choices: [enemy] });
    act(g, { type: 'move', player: 'A', unitId: hero, toCell: 1 }); // 행동 발생
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[enemy]).toBeDefined(); // 부동 불발 → 생존
  });

  it('기본 체력물약: 대상 유닛이 이번 턴 동안 +2/0, 턴 종료 시 해제', () => {
    const g = toMain();
    const unit = place(g, 'A', 'stone-monkey'); // 힘2
    g.state.hand.A.push('health-potion');
    act(g, { type: 'play', player: 'A', cardId: 'health-potion', choices: [unit] });
    expect(g.state.units[unit].power).toBe(4);
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.units[unit].power).toBe(2);
  });
});
