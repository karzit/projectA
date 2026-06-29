import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';
import type { GameEvent } from '../../types.js';

// 피보나치 수열 처치 임계값 (1, 2, 3, 5, 8, 13, 21, ...)
const FIB: number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

function fibBonus(score: number): number {
  return FIB.filter((f) => score >= f).length;
}

// 다음 레벨업까지 필요한 점수 (현재 점수보다 큰 첫 피보나치 값). 표 끝을 넘으면 마지막 값.
function nextThreshold(score: number): number {
  return FIB.find((f) => f > score) ?? FIB[FIB.length - 1];
}

// 용사[3/3]. 환경이 변화할 때마다 +1/+1.
// 처치한 적의 힘+지혜 합계가 피보나치 수열 임계값을 넘을 때마다 추가로 +1/+1.
class HeroCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'hero',
    name: '용사',
    kind: 'unit',
    power: 3,
    wisdom: 3,
    levels: true,
    keywords: ['용사'],
    desc: "환경 변화 시 +1/+1. 처치한 적 힘+지혜 합산이 피보나치 수열 값을 넘을 때마다 +1/+1.",
  };

  override subscribe(ctx: GameContext): void {
    if (!ctx.unitId) return;
    const unitId = ctx.unitId;
    const controller = ctx.controller;

    // 환경 변화 시 +1/+1
    ctx.events.on({
      key: `${unitId}:envGrowth`,
      controller,
      filter: (ev) => ev.kind === 'envChanged',
      fire: () => {
        ctx.board.modifyStat(unitId, 'power', 1);
        ctx.board.modifyStat(unitId, 'wisdom', 1);
      },
    });

    // 적 유닛 처치 시 kill score 누적 → 피보나치 단계 돌파마다 +1/+1
    ctx.events.on({
      key: `${unitId}:heroKillGrowth`,
      controller,
      filter: (ev) => ev.kind === 'unitDied' && ev.controller !== controller,
      fire: (ev: GameEvent) => {
        if (ev.kind !== 'unitDied') return;
        if (!ctx.board.getUnit(unitId)) return;
        const prevScore = ctx.board.heroKillScoreOf(controller);
        ctx.board.addHeroKillScore(controller, ev.power + ev.wisdom);
        const newScore = ctx.board.heroKillScoreOf(controller);
        const newLevel = fibBonus(newScore);
        const gained = newLevel - fibBonus(prevScore);
        // 레벨업 1회당 +1/+1 + heroLevelUp 이벤트(전사/사제/마법사 등이 구독).
        for (let i = 0; i < gained; i++) {
          ctx.board.modifyStat(unitId, 'power', 1);
          ctx.board.modifyStat(unitId, 'wisdom', 1);
          ctx.board.emitEvent({ kind: 'heroLevelUp', instanceId: unitId, controller, level: fibBonus(prevScore) + i + 1 });
        }
        // 표시용 진행도 갱신 (레벨업이 없어도 누적 점수는 갱신).
        ctx.board.setHeroProgress(unitId, newLevel, newScore, nextThreshold(newScore));
      },
    });
  }
}

export const Hero = new HeroCard();
