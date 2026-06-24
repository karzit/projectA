// Example cards from the rules sketch. Behaviour is data (conditions / develops /
// forced abilities) so new cards never require engine branches.

import type { CardDef } from './types.js';

export const CARD_DEFS: Record<string, CardDef> = Object.fromEntries(
  (
    [
      // 돌원숭이 — a plain unit; serves as the "background" for 미후왕.
      { id: 'stone-monkey', name: '돌원숭이', kind: 'unit', power: 2, wisdom: 1, keywords: ['원숭이'] },

      // 우공이산 — a spell that develops 지형:산 into the environment.
      { id: 'foolish-old-man', name: '우공이산', kind: 'spell', develops: [{ type: '지형', value: '산' }] },

      // 미후왕 — needs 돌원숭이 on a field AND 지형:산 in the environment to be played.
      {
        id: 'monkey-king',
        name: '미후왕',
        kind: 'unit',
        power: 6,
        wisdom: 5,
        keywords: ['원숭이', '왕'],
        conditions: [
          { need: 'unit', name: '돌원숭이' },
          { need: 'env', type: '지형', value: '산' },
        ],
      },

      // 복수자 — if your field is empty, it is force-summoned to the field.
      {
        id: 'avenger',
        name: '복수자',
        kind: 'unit',
        power: 3,
        wisdom: 2,
        forced: [{ id: 'rise', trigger: { on: 'ownFieldEmpty' }, effect: [{ do: 'summonSelf' }] }],
      },

      // 마왕 — has every keyword; cannot be normally summoned; descends after the
      // "부활 의식" ritual is performed 5 times.
      {
        id: 'demon-king',
        name: '마왕',
        kind: 'unit',
        power: 10,
        wisdom: 10,
        allKeywords: true,
        cannotSummon: true,
        forced: [{ id: 'descend', trigger: { on: 'ritual', name: '부활의식', count: 5 }, effect: [{ do: 'descend' }], once: true }],
      },

      // 혁명 — playable only when your side's total 지혜 ≥ 15 AND no unit with 힘
      // 7+ is on your side. Effect (swap two units' stats, up to the enemy unit
      // count) awaits the spell-effect system; the 배경 conditions are live now.
      {
        id: 'revolution',
        name: '혁명',
        kind: 'spell',
        conditions: [
          { need: 'wisdom', amount: 15, side: 'own' },
          { need: 'noPowerAtLeast', amount: 7, side: 'own' },
        ],
        // 적 진영 유닛의 수 까지, 선택한 두 유닛의 능력치를 뒤바꾼다.
        effects: [
          {
            do: 'repeat',
            times: 'enemyUnitCount',
            effects: [{ do: 'swapStats', a: { kind: 'chosen', count: 1 }, b: { kind: 'chosen', count: 1 } }],
          },
        ],
      },

      // 배신자 — when it has the highest power AND wisdom on your side, it kills a
      // random ally and defects to the opponent.
      {
        id: 'traitor',
        name: '배신자',
        kind: 'unit',
        power: 5,
        wisdom: 5,
        forced: [
          {
            id: 'betray',
            trigger: { on: 'highestStat', stats: ['power', 'wisdom'], side: 'own' },
            effect: [
              { do: 'destroy', target: { kind: 'random', from: 'ownField', count: 1 } }, // 무작위 아군 처치
              { do: 'defect', target: { kind: 'self' } }, // 상대 진영으로 이동
            ],
            once: true,
          },
        ],
      },
    ] satisfies CardDef[]
  ).map((c) => [c.id, c]),
);

export function getDef(cardId: string): CardDef {
  const d = CARD_DEFS[cardId];
  if (!d) throw new Error(`Unknown card: ${cardId}`);
  return d;
}

// Effective keywords of a unit, honoring 마왕's "all keywords".
export function hasKeyword(def: CardDef, keyword: string): boolean {
  return !!def.allKeywords || !!def.keywords?.includes(keyword);
}
