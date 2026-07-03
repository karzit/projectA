// Deck storage: preset decks + user-created decks persisted in localStorage.

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
  readonly preset?: true; // preset decks cannot be deleted
}

const dup = (n: number, id: string) => Array.from({ length: n }, () => id);

const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'basic',
    name: '기본 덱',
    preset: true,
    cards: dup(15, 'stone-monkey'),
  },
  {
    id: 'heroic',
    name: '영웅담 덱',
    preset: true,
    // 용사 레벨업 + 결속/액티브(전사·사제·마법사) + 교회 부활 + 성검, 모험의
    // 시작으로 적 퀘스트 체인(→ 마왕 강림)까지 여는 완결형 영웅담 덱.
    cards: [
      ...dup(3, 'hero'),
      ...dup(2, 'warrior'),
      ...dup(2, 'priest'),
      ...dup(2, 'mage'),
      ...dup(2, 'health-potion'),
      ...dup(1, 'foolish-old-man'),
      ...dup(1, 'adventure-start'),
      ...dup(1, 'church'),
      ...dup(1, 'holy-sword'),
    ],
  },
  {
    id: 'journey',
    name: '서유기 덱',
    preset: true,
    // 삼장법사 여정(cell 4→0) 완주가 트리거되는 순간 저오능·사오정·(오행산에
    // 갇힌) 원숭이 왕 계열까지 한꺼번에 진화한다 — 두 체인이 한 덱에서 맞물림.
    cards: [
      ...dup(2, 'tang-monk'),
      ...dup(2, 'je-o-neung'),
      ...dup(2, 'sa-o-jeong'),
      ...dup(2, 'monkey-king'),
      ...dup(1, 'subori-josa'),
      ...dup(1, 'foolish-old-man'),
      ...dup(2, 'guard'),
      ...dup(3, 'stone-monkey'),
    ],
  },
  {
    id: 'cult',
    name: '사교도 덱',
    preset: true,
    // 사교의 의식으로 첫 번째 의식을 얻고, 합계1(슬라임)→2(해골)→3(돌원숭이)→
    // 6(사교도 6마리) 순서로 제물을 바쳐 사특한 신을 소환하는 희생 체인.
    // 사교도는 덱 매수 제한이 없어 보드도 채우고 마지막 의식 제물도 겸한다.
    cards: [
      ...dup(1, 'cult-ritual'),
      ...dup(1, 'slime'),
      ...dup(1, 'skeleton'),
      ...dup(1, 'stone-monkey'),
      ...dup(9, 'cultist'),
      ...dup(2, 'dark-arts-dream'),
    ],
  },
];

const LS_KEY = 'ccg_user_decks';

function loadUserDecks(): DeckPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as DeckPreset[]) : [];
  } catch {
    return [];
  }
}

function saveUserDecks(decks: DeckPreset[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(decks.filter((d) => !d.preset)));
}

export function allDecks(): DeckPreset[] {
  return [...PRESET_DECKS, ...loadUserDecks()];
}

export function deckById(id: string): DeckPreset {
  return allDecks().find((d) => d.id === id) ?? PRESET_DECKS[0];
}

export function saveDeck(deck: DeckPreset): void {
  const user = loadUserDecks().filter((d) => d.id !== deck.id);
  saveUserDecks([...user, deck]);
}

export function deleteDeck(id: string): void {
  saveUserDecks(loadUserDecks().filter((d) => d.id !== id));
}

export function newDeckId(): string {
  return `user_${Date.now()}`;
}
