// Preset decks for the rules engine. 15 cards each (all start in hand).

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
}

const dup = (n: number, id: string) => Array.from({ length: n }, () => id);

export const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'monkey',
    name: '원숭이 덱',
    cards: [
      ...dup(10, 'stone-monkey'),
      ...dup(3, 'foolish-old-man'),
      ...dup(2, 'monkey-king'),
    ],
  },
  {
    id: 'basic',
    name: '기본 덱',
    cards: dup(15, 'stone-monkey'),
  },
  {
    id: 'heroic',
    name: '영웅담 덱',
    cards: [
      ...dup(3, 'hero'),            // 용사 — 환경 변화마다 슬라임
      ...dup(3, 'adventure-start'), // 모험의 시작 — 전개 + 슬라임 + 퀘스트 획득
      ...dup(4, 'health-potion'),   // 기본 체력물약 — 대상 1마리 선택(피커)
      ...dup(3, 'foolish-old-man'), // 환경 전개로 용사 트리거
      ...dup(2, 'stone-monkey'),
    ],
  },
];

export function deckById(id: string): DeckPreset {
  return PRESET_DECKS.find((d) => d.id === id) ?? PRESET_DECKS[0];
}
