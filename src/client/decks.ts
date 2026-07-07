// Deck storage: preset decks + user-created decks persisted in localStorage.

export interface DeckPreset {
  id: string;
  name: string;
  cards: string[];
  readonly preset?: true; // preset decks cannot be deleted
}

// 덱 편성 규칙(rules의 maxDeckCopies): 같은 카드는 덱에 1장만 — meta.multiCopy
// 카드(사교도)만 여러 장 가능, meta.token 카드(생성 전용 — 슬라임/킹슬라임/고블린/
// 해골류/의식 4종/진행 결과물 등)는 덱에 넣을 수 없다. 프리셋 전부 15장.
const PRESET_DECKS: DeckPreset[] = [
  {
    id: 'basic',
    name: '기본 덱',
    preset: true,
    // 대조군용 테마없음 모둠 — 테마없음 10종 전부 + 무테마 유닛(밸런스 계측 제외).
    cards: [
      'stone-monkey', 'guard', 'avenger', 'traitor', 'g-teacher',
      'foolish-old-man', 'health-potion', 'inn', 'full-plate-armor', 'trap',
      'bomb', 'great-fire', 'old-friend', 'end-of-days', 'revolution',
    ],
  },
  {
    id: 'heroic',
    name: '영웅담 덱',
    preset: true,
    // 용사 레벨업 + 결속(전사·사제·마법사) + 교회 부활 + 성검. 슬라임/고블린 등
    // 몸 담당이 전부 토큰(편성 불가)이 되어 무테마 유닛(돌원숭이/호위/G선생/복수자)
    // 으로 대체. 킹슬라임(지략4)·폭탄(승률 100%)은 계측상 과출력이라 계속 제외.
    cards: [
      'hero', 'warrior', 'priest', 'mage',
      'stone-monkey', 'guard', 'g-teacher', 'avenger',
      'adventure-start', 'church', 'holy-sword', 'health-potion',
      'full-plate-armor', 'goddess-help', 'inn',
    ],
  },
  {
    id: 'journey',
    name: '서유기 덱',
    preset: true,
    // 원숭이 체인(미후왕→…→제천대성) + 삼장법사 순례단. 삼장법사 배경(아군 오행산
    // 유닛)이 체인 후반을 게이트하므로, 그때까지 버틸 몸과 순례 보호(호위/아머)로
    // 구성. 위대한 불은 계측상 승률 8%(광역 -3이 자기 삼장법사(힘 0)까지 처치) 제외.
    cards: [
      'monkey-king', 'subori-josa', 'tang-monk', 'je-o-neung', 'sa-o-jeong',
      'stone-monkey', 'guard', 'avenger', 'g-teacher',
      'foolish-old-man', 'health-potion', 'full-plate-armor', 'inn', 'trap', 'bomb',
    ],
  },
  {
    id: 'cult',
    name: '사교도 덱',
    preset: true,
    // 의식 체인: 합1(G선생)→합2(호위)→합3(돌원숭이)→합6(사교도). 신규 카드
    // 제물준비가 소굴 배경만으로 희생양(0/1) 토큰을 자체 생산 — 발동마다 지혜가
    // 누적으로 올라 합1→2→3 제물을 순서대로 채워주는 전용 제물 엔진이라, 미검증
    // 상태였던 dark-arts-turmoil 대신 편입. 사교도만 multiCopy로 6장.
    cards: [
      'cult-ritual', 'cultist', 'cultist', 'cultist', 'cultist', 'cultist', 'cultist',
      'g-teacher', 'guard', 'stone-monkey', 'sacrifice-prep',
      'dark-arts-dream', 'dark-arts-mind-seal', 'friend', 'hospitality',
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
