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
  return g.state.field[p].map((id) => g.state.units[id].cardId);
}

describe('영웅담 테마', () => {
  it('모험의 시작: 지역 전개 + 적 전장 슬라임 소환 + 퀘스트 카드 획득', () => {
    const g = toMain();
    g.state.hand.A.push('adventure-start');
    act(g, { type: 'play', player: 'A', cardId: 'adventure-start' });
    expect(g.state.environment['지역']).toBe('시작의 마을');
    expect(namesOn(g, 'B')).toContain('slime');
    expect(g.state.hand.A).toContain('quest-slime');
    expect(g.state.hand.A).not.toContain('adventure-start');
  });

  it('퀘스트 - 슬라임 토벌: 장소 전개 + 적 전장에 슬라임 2 + 킹슬라임 1', () => {
    const g = toMain();
    g.state.hand.A.push('quest-slime');
    act(g, { type: 'play', player: 'A', cardId: 'quest-slime' });
    expect(g.state.environment['장소']).toBe('슬라임 동굴');
    const b = namesOn(g, 'B');
    expect(b.filter((c) => c === 'slime').length).toBe(2);
    expect(b).toContain('king-slime');
  });

  it('용사: 환경이 변할 때마다 슬라임을 얻는다', () => {
    const g = toMain();
    place(g, 'A', 'hero');
    g.state.hand.A.push('foolish-old-man'); // 지형:산 전개 → 환경 변화
    act(g, { type: 'play', player: 'A', cardId: 'foolish-old-man' });
    expect(namesOn(g, 'A')).toEqual(expect.arrayContaining(['hero', 'slime']));
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
