// 헤드리스 AI 대 AI 시뮬레이션 — 진짜 assert는 최소(무한루프/크래시 감지)이고,
// 주된 목적은 프리셋 덱 매치업 승률·평균 턴 수를 콘솔에 찍어 D-1(밸런스 점검)에
// 참고 데이터를 주는 것. 실제 "재미" 판정은 사람 몫 — 이 파일은 그 판정을
// 대체하지 않는다. `SIM_GAMES` 환경변수로 매치업당 게임 수를 조절할 수 있다
// (기본값은 CI/npm test 속도를 해치지 않을 만큼 작게 유지).
//
// 병렬 실행: 매치업 하나하나가 완전히 독립적이라 여러 OS 프로세스로 나눠 돌릴 수
// 있다. `scripts/run-balance-parallel.mjs`가 `SIM_SHARD_INDEX`/`SIM_SHARD_COUNT`를
// 심어 이 파일 자체를 여러 벌 `vitest run`으로 띄우고(진짜 멀티코어 — 이 파일이
// import하는 rules/client 소스는 vitest의 vite-node 리졸버가 필요해 plain
// worker_threads로는 못 돌린다), 각 shard는 자기 몫 매치업만 돌려 raw 집계를
// `stats/.shard-*.json`에 쓰고, 오케스트레이터가 그 조각들을 합산해 최종
// `stats/ai-balance-stats.json`과 콘솔 요약을 만든다. 단일 프로세스로 그냥
// `npm test`/`vitest run`을 돌리면(shard 변수 없음) 예전과 동일하게 동작한다.
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, otherPlayer, CARD_REGISTRY } from '../src/rules/index.js';
import type { GameState, PlayerId, RulesAction } from '../src/rules/index.js';
import { MctsAI } from '../src/client/ai/MctsAI.js';
import { EventManager } from '../src/client/core/EventManager.js';
import { deckById } from '../src/client/decks.js';
import { getDeckStrategy } from '../src/client/ai/DeckStrategy.js';

// --- 대시보드용 실시간 통계 스냅샷 -----------------------------------------
// `ai-balance-dashboard.html`(vite dev 서버로 서빙)이 이 파일을 폴링해서
// 시뮬레이션 진행 중 승률/이야기 전개/카드별 승률/덱 상성을 실시간으로 보여준다.
// 테스트 자체의 assert에는 관여하지 않는 순수 부가 기능 — 쓰기 실패해도 무시.
const STATS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'stats');
const STATS_FILE = join(STATS_DIR, 'ai-balance-stats.json');

// --- 샤딩(병렬 실행) ---------------------------------------------------------
// 둘 다 기본값(0/1)이면 샤딩 없음 — 기존 단일 프로세스 동작 그대로.
const SHARD_INDEX = Number(process.env.SIM_SHARD_INDEX ?? 0);
const SHARD_COUNT = Number(process.env.SIM_SHARD_COUNT ?? 1);
const SHARDED = SHARD_COUNT > 1;
const SHARD_FILE = join(STATS_DIR, `.shard-${SHARD_INDEX}-of-${SHARD_COUNT}.json`);

interface LiveMatchup { a: string; b: string; aWins: number; bWins: number; stuck: number; gamesRun: number; turnSum: number; turnSqSum: number; }
interface LiveCardStat { games: number; wins: number; turnSum: number; survivalSum: number; survivalCount: number; }
interface LiveStoryStat { games: number; stageSum: number; stageSqSum: number; chainLen: number; complete: number; turnSumOnComplete: number; }
interface LivePowerPoint { turn: number; avgPower: number; mode5Power: number | null; samples: number; }
interface LiveWinTurnStat {
  games: number; wins: number; turnSumOnWin: number; turnSqSumOnWin: number;
  minTurnOnWin: number | null; maxTurnOnWin: number | null;
  turnHistogram: Record<number, number>; // 승리 턴 → 그 턴에 승리한 게임 수 (최빈값 계측용)
}

// 표본 표준편차(n-1 분모) — 표본이 1개 이하면 정의 안 됨(NaN 대신 null로 표시).
function stddev(sum: number, sqSum: number, n: number): number | null {
  if (n < 2) return null;
  const mean = sum / n;
  const variance = (sqSum - n * mean * mean) / (n - 1);
  return Math.sqrt(Math.max(0, variance));
}

// "최빈값 5개의 평균" — 승리 턴 분포에서 가장 빈도 높은 턴 값 최대 5개를 뽑아
// (그 5개 턴 값 자체를) 평균한다. 평균 승리 턴이 이상치(초장기전 안전판 근접
// 게임 등)에 끌려가는 것과 달리, "실제로 자주 이기는 턴 구간이 어디인지"를
// 더 직접적으로 보여준다.
function top5ModeAvgTurn(histogram: Record<number, number>): number | null {
  return top5ModeAvg(histogram);
}

// 정수 값 히스토그램(값 → 등장 횟수)에서 가장 빈도 높은 값 최대 5개를 뽑아 그
// 값 자체를 평균한다 — 승리 턴 최빈값과 파워커브 턴별 최빈 힘 양쪽에서 재사용.
function top5ModeAvg(histogram: Record<number, number>): number | null {
  const entries = Object.entries(histogram).map(([v, count]) => ({ v: Number(v), count }));
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.count - a.count || a.v - b.v);
  const top = entries.slice(0, 5);
  return top.reduce((sum, e) => sum + e.v, 0) / top.length;
}
interface LiveStats {
  startedAt: number;
  updatedAt: number;
  done: boolean;
  gamesPerMatchup: number;
  matchups: LiveMatchup[];
  story: Record<string, LiveStoryStat>;
  cards: Record<string, LiveCardStat>;
  powerCurve: Record<string, LivePowerPoint[]>;
  winTurns: Record<string, LiveWinTurnStat>;
}

// --- 파워커브: 덱별로 턴이 진행됨에 따라 자기 전장의 총 힘(모든 아군 유닛
// power 합)이 어떻게 늘어나는지 — "초반 약하고 후반 강한 덱" 같은 곡선 차이를
// 보려는 것. 상한을 넉넉히 잡아두되(진짜 안전판 근처 초장기전 노이즈는 배제),
// 표본이 있는 턴만 그래프에 찍힌다(samples>0 필터, 대시보드 쪽) — 그래서 74턴
// 완주처럼 40턴을 넘는 정상 게임도 그 턴까지 그대로 표시된다.
const MAX_POWER_CURVE_TURN = 150;

function samplePowerCurve(curve: Record<PlayerId, number[]>, state: GameState): void {
  const turn = state.turn;
  if (turn < 1 || turn > MAX_POWER_CURVE_TURN) return;
  for (const p of ['A', 'B'] as const) {
    let total = 0;
    for (const u of Object.values(state.units)) if (u.controller === p) total += u.power;
    curve[p][turn] = total;
  }
}

const liveCardStats: Record<string, LiveCardStat> = {};

function recordCardOutcome(
  cardsPlayed: Record<PlayerId, Set<string>>,
  firstAppearTurn: Map<string, number>,
  winner: PlayerId | null,
): void {
  for (const p of ['A', 'B'] as const) {
    const won = winner === p;
    for (const cardId of cardsPlayed[p]) {
      const s = (liveCardStats[cardId] ??= { games: 0, wins: 0, turnSum: 0, survivalSum: 0, survivalCount: 0 });
      s.games++;
      if (won) s.wins++;
      s.turnSum += firstAppearTurn.get(cardId) ?? 0;
    }
  }
}

// 게임 하나 안에서 관측된 유닛 생존시간(카드별 sum/count)을 전역 통계에 합산.
function mergeSurvival(survivalByCard: Map<string, { sum: number; count: number }>): void {
  for (const [cardId, entry] of survivalByCard) {
    const s = (liveCardStats[cardId] ??= { games: 0, wins: 0, turnSum: 0, survivalSum: 0, survivalCount: 0 });
    s.survivalSum += entry.sum;
    s.survivalCount += entry.count;
  }
}

function addSurvival(map: Map<string, { sum: number; count: number }>, cardId: string, turns: number): void {
  const entry = map.get(cardId) ?? { sum: 0, count: 0 };
  entry.sum += Math.max(0, turns);
  entry.count++;
  map.set(cardId, entry);
}

// 용사의 모험 체인(모험의 시작→…→마왕성 입성)이 "적 전장에" 심는 장애물 토큰들 —
// 이 토큰들의 컨트롤러는 소환자의 상대이므로, 카드 승률은 소환자(=상대의 상대)
// 기준으로 뒤집어 집계해야 "친구"처럼 상대를 방해하는 카드가 제 몫을 한다.
const ENEMY_OBSTACLE_TOKENS = new Set([
  'slime', 'goblin', 'skeleton-soldier', 'headless-knight', 'headless-knight-head',
  'king-slime', 'demon-lord',
]);

// 손으로 낸 카드(cardsPlayed)만으로는 토큰(덱 편성 불가, 효과로만 등장하는) 카드가
// 통계에서 완전히 빠진다 — 매 스텝 유닛 목록을 훑어 등장/소멸/진화를 감지하며:
//   1) 토큰 카드는 첫 등장 시 카드별 승률 통계(cardsPlayed)에 편입 (적 전장 장애물
//      토큰은 소환자 관점으로 귀속을 뒤집는다).
//   2) 첫 등장 턴을 firstAppearTurn에 기록 (평균 등장 턴 계측용, 유닛/스펠 공통).
//   3) instanceId가 필드에서 사라지거나(죽음/이탈) 카드가 바뀌면(진화) 그 cardId로
//      있었던 기간을 생존시간으로 survivalByCard에 편입 — 내고 바로 잡히면 0턴.
// 진화(evolveUnitTo)는 같은 instanceId를 그대로 쓰고 cardId만 바뀌므로, "그
// instanceId가 지금 이 cardId로 기록된 적 있는지"로 판정해야 한다.
function trackUnits(
  cardsPlayed: Record<PlayerId, Set<string>>,
  instanceTracker: Map<string, { cardId: string; sinceTurn: number }>,
  survivalByCard: Map<string, { sum: number; count: number }>,
  firstAppearTurn: Map<string, number>,
  state: GameState,
): void {
  const turn = state.turn;
  const currentIds = new Set(Object.keys(state.units));

  for (const [unitId, info] of instanceTracker) {
    if (currentIds.has(unitId)) continue;
    addSurvival(survivalByCard, info.cardId, turn - info.sinceTurn);
    instanceTracker.delete(unitId);
  }

  for (const [unitId, unit] of Object.entries(state.units)) {
    const info = instanceTracker.get(unitId);
    if (info && info.cardId === unit.cardId) continue;
    if (info) addSurvival(survivalByCard, info.cardId, turn - info.sinceTurn);
    instanceTracker.set(unitId, { cardId: unit.cardId, sinceTurn: turn });
    if (!firstAppearTurn.has(unit.cardId)) firstAppearTurn.set(unit.cardId, turn);
    if (!CARD_REGISTRY.getDef(unit.cardId).token) continue;
    const beneficiary = ENEMY_OBSTACLE_TOKENS.has(unit.cardId) ? otherPlayer(unit.controller) : unit.controller;
    cardsPlayed[beneficiary].add(unit.cardId);
  }
}

let liveMatchups: LiveMatchup[] = [];
let liveStory: Record<string, LiveStoryStat> = {};
let livePowerCurve: Record<string, LivePowerPoint[]> = {};
const liveWinTurns: Record<string, LiveWinTurnStat> = {};
const liveStartedAt = Date.now();

// 덱별(상대 무관) 승리 시점 집계 — 파워커브 옆에 "이 덱이 이길 때 보통 몇 턴에
// 끝나는지"를 같이 보여주기 위한 것. deckProgressComplete(이야기 완주)와는
// 별개로 승패(loser 확정) 자체를 기준으로 한다.
function recordWinTurn(deckId: string, won: boolean, turns: number): void {
  const s = (liveWinTurns[deckId] ??= {
    games: 0, wins: 0, turnSumOnWin: 0, turnSqSumOnWin: 0,
    minTurnOnWin: null, maxTurnOnWin: null, turnHistogram: {},
  });
  s.games++;
  if (won) {
    s.wins++;
    s.turnSumOnWin += turns;
    s.turnSqSumOnWin += turns * turns;
    s.minTurnOnWin = s.minTurnOnWin === null ? turns : Math.min(s.minTurnOnWin, turns);
    s.maxTurnOnWin = s.maxTurnOnWin === null ? turns : Math.max(s.maxTurnOnWin, turns);
    s.turnHistogram[turns] = (s.turnHistogram[turns] ?? 0) + 1;
  }
}

function writeLiveStats(done: boolean): void {
  const snapshot: LiveStats = {
    startedAt: liveStartedAt,
    updatedAt: Date.now(),
    done,
    gamesPerMatchup: GAMES_PER_MATCHUP,
    matchups: liveMatchups,
    story: liveStory,
    cards: liveCardStats,
    powerCurve: livePowerCurve,
    winTurns: liveWinTurns,
  };
  try {
    mkdirSync(STATS_DIR, { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(snapshot, null, 2));
  } catch {
    // 대시보드는 부가 기능 — 파일 쓰기 실패가 테스트를 막으면 안 된다.
  }
}

// basic(15x 돌원숭이)은 사실상 덱이 아니라 대조군용 바닐라라 밸런스 매치업에서 제외.
const DECK_IDS = ['heroic', 'journey', 'cult'];
// 전체 매치업(a,b) 쌍 — 매치업 하나가 통째로 한 shard의 몫이라(부분 게임 분할이
// 아니라 매치업 단위 분할) 병합이 단순 합산+배열 concat으로 끝난다.
const ALL_PAIRS: Array<[string, string]> = DECK_IDS.flatMap((a) => DECK_IDS.map((b): [string, string] => [a, b]));
const MY_PAIRS = SHARDED ? ALL_PAIRS.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX) : ALL_PAIRS;
const GAMES_PER_MATCHUP = Number(process.env.SIM_GAMES ?? 2);
const MAX_STEPS = 500; // 안전판 — AI가 교착되면 이 스텝 안에 승부가 안 남
const TICK_MS = 750; // SimAI의 STEP_MS(700)보다 살짝 크게 잡아 타이머가 확실히 흐르게 함

// App.ts의 #aiPickCunningBlock/#aiPickBlockers와 동일한 단순 휴리스틱 재현
// (해당 메서드는 App 내부 private라 재사용 불가 — 로직만 복제).
function pickCunningBlock(eligible: string[]): string | undefined {
  return eligible[0];
}

function pickCoopBlockers(state: GameState, attackerId: string, targetId: string, blockable: string[]): string[] {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  if (!attacker || !target || blockable.length === 0) return [];
  const ap = attacker.power;
  let combined = target.power;
  const sorted = [...blockable].sort((a, b) => (state.units[b]?.power ?? 0) - (state.units[a]?.power ?? 0));
  const chosen: string[] = [];
  for (const id of sorted) {
    if (combined >= ap) break;
    combined += state.units[id]?.power ?? 0;
    chosen.push(id);
  }
  return combined >= ap ? chosen : [];
}

interface GameOutcome {
  winner: PlayerId | null; // null = MAX_STEPS 안전판에 걸림 (AI 교착 — 밸런스가 아니라 버그 신호)
  turns: number;
  progress: DeckProgress;
  cardsPlayed: Record<PlayerId, Set<string>>;
  firstAppearTurn: Map<string, number>; // 카드별 이 게임에서 처음 등장한 턴
  survivalByCard: Map<string, { sum: number; count: number }>; // 카드별 유닛 생존 턴 합/표본수
  powerCurve: Record<PlayerId, number[]>; // turn으로 인덱싱된, 그 턴에 관측된 총 전장 힘(마지막 스냅샷)
}

// --- 18회차: 덱별 "이야기 전개" 진행도 계측 -------------------------------
// 각 덱의 진행 체인을 카드 ID 순서로 인코딩해, 시뮬레이션 도중 매 스텝 상태를
// 스캔하며 "도달한 최고 단계"를 갱신한다(중간에 유닛이 죽거나 형태가 바뀌어도
// 최고 기록은 보존). 카드 밸런스 자체가 아니라 "완주 가능성"을 재는 것이 목적.
const HERO_QUEST_CHAIN = ['adventure-start', 'fate-awakening', 'quest-labyrinth', 'demon-castle'];
const MONKEY_CHAIN = ['stone-monkey', 'monkey-king', 'son-wukong', 'pilmaon', 'je-cheon-dae-sung', 'son-haengja', 'tu-jeon-seung-bul'];
const JOURNEY_FINALS = ['tu-jeon-seung-bul', 'jeon-dan-gong-deok-bul', 'jeong-dan-saja', 'geumshin-nahan'];
const RITUAL_CHAIN = ['cult-ritual', 'first-ritual', 'second-ritual', 'third-ritual', 'last-ritual'];

interface DeckProgress {
  heroMaxLevel: Record<PlayerId, number>;
  heroQuestStage: Record<PlayerId, number>; // 0~4 = HERO_QUEST_CHAIN 진행, 5 = 마왕 소환(완주)
  monkeyOrdinal: Record<PlayerId, number>; // 0~7 = MONKEY_CHAIN 진행(7 = 투전승불 도달)
  journeyFinals: Record<PlayerId, Set<string>>; // 서유기 4개 진화 라인 중 최종형 도달 집합
  ritualStage: Record<PlayerId, number>; // 0~5 = RITUAL_CHAIN 진행, 5 = 사특한 신 소환(완주)
}

function emptyProgress(): DeckProgress {
  return {
    heroMaxLevel: { A: 0, B: 0 },
    heroQuestStage: { A: 0, B: 0 },
    monkeyOrdinal: { A: 0, B: 0 },
    journeyFinals: { A: new Set(), B: new Set() },
    ritualStage: { A: 0, B: 0 },
  };
}

function recordChainPlay(progress: DeckProgress, player: PlayerId, cardId: string): void {
  const hIdx = HERO_QUEST_CHAIN.indexOf(cardId);
  if (hIdx >= 0) progress.heroQuestStage[player] = Math.max(progress.heroQuestStage[player], hIdx + 1);
  const rIdx = RITUAL_CHAIN.indexOf(cardId);
  if (rIdx >= 0) progress.ritualStage[player] = Math.max(progress.ritualStage[player], rIdx + 1);
}

function scanUnitProgress(progress: DeckProgress, state: GameState): void {
  for (const u of Object.values(state.units)) {
    if (u.cardId === 'hero' && typeof u.level === 'number') {
      progress.heroMaxLevel[u.controller] = Math.max(progress.heroMaxLevel[u.controller], u.level);
    }
    if (u.cardId === 'demon-lord') {
      // 마왕은 소환자(체인 완주자)의 상대 전장에 등장 — 완주자는 controller의 반대편.
      progress.heroQuestStage[otherPlayer(u.controller)] = HERO_QUEST_CHAIN.length + 1;
    }
    if (u.cardId === 'wicked-god') {
      progress.ritualStage[u.controller] = RITUAL_CHAIN.length;
    }
    const mIdx = MONKEY_CHAIN.indexOf(u.cardId);
    if (mIdx >= 0) progress.monkeyOrdinal[u.controller] = Math.max(progress.monkeyOrdinal[u.controller], mIdx + 1);
    if (JOURNEY_FINALS.includes(u.cardId)) progress.journeyFinals[u.controller].add(u.cardId);
  }
}

function runOneGame(deckIdA: string, deckIdB: string, seed: number): GameOutcome {
  const game = new Game({ decks: { A: deckById(deckIdA).cards, B: deckById(deckIdB).cards }, seed });
  const events = new EventManager();
  const ais = {
    A: new MctsAI('A', events, () => game.state, getDeckStrategy(deckIdA)),
    B: new MctsAI('B', events, () => game.state, getDeckStrategy(deckIdB)),
  };
  const progress = emptyProgress();
  const cardsPlayed: Record<PlayerId, Set<string>> = { A: new Set(), B: new Set() };
  const instanceTracker = new Map<string, { cardId: string; sinceTurn: number }>();
  const survivalByCard = new Map<string, { sum: number; count: number }>();
  const firstAppearTurn = new Map<string, number>();
  const powerCurve: Record<PlayerId, number[]> = { A: [], B: [] };
  let retry = 0;

  function step(action: RulesAction): void {
    if (game.state.loser) return;
    const result = game.apply(action);
    if (result.error) {
      // App.ts와 동일한 재시도 완충 — 결정론적으로 같은 불법 액션을 반복 고르는
      // 상황에서 조용히 멈추는 대신 몇 번 더 react()를 시도한다.
      if (++retry <= 5) { ais.A.react(); ais.B.react(); }
      return;
    }
    retry = 0;
    if (action.type === 'play' || action.type === 'placeOpening') {
      recordChainPlay(progress, action.player, action.cardId);
      cardsPlayed[action.player].add(action.cardId);
      if (!firstAppearTurn.has(action.cardId)) firstAppearTurn.set(action.cardId, result.state.turn);
    }
    scanUnitProgress(progress, result.state);
    trackUnits(cardsPlayed, instanceTracker, survivalByCard, firstAppearTurn, result.state);
    samplePowerCurve(powerCurve, result.state);
    if (result.choiceRequest) {
      events.emit('choice:request', { request: result.choiceRequest, action });
      return;
    }
    if (result.reactionRequest) {
      const req = result.reactionRequest;
      const blockerId = pickCunningBlock(req.eligibleBlockers);
      step({ type: 'react', player: req.player, block: !!blockerId, blockerId } as RulesAction);
      return;
    }
    if (result.attackReactionRequest) {
      const req = result.attackReactionRequest;
      const blockerIds = pickCoopBlockers(result.state, req.attackerId, req.targetId, req.blockable);
      step({ type: 'resolveAttack', player: req.player, blockerIds } as RulesAction);
      return;
    }
    if (!result.state.loser) { ais.A.react(); ais.B.react(); }
  }

  events.on('intent', (action) => step(action as RulesAction));

  vi.useFakeTimers();
  try {
    ais.A.react();
    ais.B.react();
    let steps = 0;
    while (!game.state.loser && steps < MAX_STEPS) {
      vi.advanceTimersByTime(TICK_MS);
      steps++;
    }
  } finally {
    vi.useRealTimers();
  }

  const loser = game.state.loser;
  return {
    winner: loser ? otherPlayer(loser) : null,
    turns: game.state.turn,
    progress,
    cardsPlayed,
    firstAppearTurn,
    survivalByCard,
    powerCurve,
  };
}

// deckId를 기준으로 한쪽 플레이어(P)의 진행도 하나를 "그 덱의 진행도" 수치로
// 요약한다. 매치업마다 A/B 중 어느 쪽이 해당 덱인지 다르므로 호출부에서 선택.
function deckProgressScore(deckId: string, progress: DeckProgress, p: PlayerId): number {
  switch (deckId) {
    case 'heroic': return progress.heroQuestStage[p];
    case 'journey': return progress.monkeyOrdinal[p];
    case 'cult': return progress.ritualStage[p];
    default: return 0;
  }
}

function deckProgressComplete(deckId: string, progress: DeckProgress, p: PlayerId): boolean {
  switch (deckId) {
    case 'heroic': return progress.heroQuestStage[p] > HERO_QUEST_CHAIN.length; // 마왕 소환
    case 'journey': return progress.monkeyOrdinal[p] === MONKEY_CHAIN.length || progress.journeyFinals[p].size > 0;
    case 'cult': return progress.ritualStage[p] === RITUAL_CHAIN.length; // 사특한 신 소환
    default: return false;
  }
}

// `SIM_LIVE=1`이면 매치업 배치를 한 번으로 끊지 않고 대시보드가 켜져 있는 한
// 계속(라운드를 무한 반복하며 누계) 시뮬레이션한다 — 사람이 대시보드를 보다가
// Ctrl+C로 멈춘다. 기본(비-live) 모드는 기존처럼 유한 배치 1회 + assert.
const LIVE = process.env.SIM_LIVE === '1';

describe('AI 밸런스 시뮬레이션 (통계 출력용)', () => {
  it('프리셋 덱 매치업별 승률·평균 턴 수', { timeout: LIVE ? 0 : undefined }, () => {
    let seed = 1;

    // 덱별(heroic/journey/cult) 이야기 전개 통계 — 상대가 누구든 모아서 집계.
    // "진행도"는 그 덱의 체인 정의(HERO_QUEST_CHAIN/MONKEY_CHAIN/RITUAL_CHAIN)
    // 상 도달한 최고 단계, "완주율"은 체인의 최종 산물(마왕/투전승불 등/사특한 신)
    // 이 실제로 등장한 게임의 비율.
    const storyTotals: Record<string, { games: number; stageSum: number; stageSqSum: number; complete: number; turnSumOnComplete: number }> = {};
    for (const id of DECK_IDS) storyTotals[id] = { games: 0, stageSum: 0, stageSqSum: 0, complete: 0, turnSumOnComplete: 0 };
    const chainLenInit: Record<string, number> = { heroic: HERO_QUEST_CHAIN.length + 1, journey: MONKEY_CHAIN.length, cult: RITUAL_CHAIN.length };
    liveStory = Object.fromEntries(
      DECK_IDS.map((id) => [id, { games: 0, stageSum: 0, stageSqSum: 0, chainLen: chainLenInit[id], complete: 0, turnSumOnComplete: 0 }]),
    );
    // 파워커브 누적기 — 턴 인덱스(1~MAX_POWER_CURVE_TURN)별 합/표본수 + 턴별 힘
    // 값 히스토그램(정수 반올림 → 등장 횟수, 최빈값 5개 평균용). 라운드가 반복돼도
    // 리셋하지 않아 live 모드에서 평균이 계속 매끄럽게 다듬어진다.
    const powerSum: Record<string, number[]> = {};
    const powerCount: Record<string, number[]> = {};
    const powerHistogram: Record<string, Record<number, number>[]> = {};
    for (const id of DECK_IDS) {
      powerSum[id] = new Array(MAX_POWER_CURVE_TURN + 1).fill(0);
      powerCount[id] = new Array(MAX_POWER_CURVE_TURN + 1).fill(0);
      powerHistogram[id] = Array.from({ length: MAX_POWER_CURVE_TURN + 1 }, () => ({}));
    }
    // 매치업 엔트리는 라운드마다 새로 만들지 않고 재사용 — live 모드에서 라운드를
    // 반복할수록 표본이 계속 누적되어 대시보드 수치가 매끄럽게 수렴한다.
    // 샤딩 모드에서는 이 shard가 맡은 매치업(MY_PAIRS)만 만든다.
    const matchupEntries = new Map<string, LiveMatchup>();
    liveMatchups = [];
    for (const [a, b] of MY_PAIRS) {
      const entry: LiveMatchup = { a, b, aWins: 0, bWins: 0, stuck: 0, gamesRun: 0, turnSum: 0, turnSqSum: 0 };
      matchupEntries.set(`${a}|${b}`, entry);
      liveMatchups.push(entry);
    }
    if (!SHARDED) writeLiveStats(false);

    let stuckTotal = 0;
    let round = 0;
    do {
      round++;
      for (const [a, b] of MY_PAIRS) {
        const liveEntry = matchupEntries.get(`${a}|${b}`)!;
        for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
          // 시드는 shard마다 겹치지 않게 오프셋 — 매치업 순서/인덱스와 무관하게
          // shard별로 결정론 재현 가능한 범위를 쓴다.
          const outcome = runOneGame(a, b, SHARD_INDEX * 1_000_000 + seed++);
          if (outcome.winner === 'A') liveEntry.aWins++;
          else if (outcome.winner === 'B') liveEntry.bWins++;
          else { liveEntry.stuck++; stuckTotal++; }
          liveEntry.gamesRun++;
          liveEntry.turnSum += outcome.turns;
          liveEntry.turnSqSum += outcome.turns * outcome.turns;

          for (const [deckId, p] of [[a, 'A'], [b, 'B']] as const) {
            const stage = deckProgressScore(deckId, outcome.progress, p);
            const t = storyTotals[deckId];
            t.games++;
            t.stageSum += stage;
            t.stageSqSum += stage * stage;
            if (deckProgressComplete(deckId, outcome.progress, p)) {
              t.complete++;
              t.turnSumOnComplete += outcome.turns;
            }
            const lt = liveStory[deckId];
            lt.games++;
            lt.stageSum += stage;
            lt.stageSqSum += stage * stage;
            if (deckProgressComplete(deckId, outcome.progress, p)) {
              lt.complete++;
              lt.turnSumOnComplete += outcome.turns;
            }
          }

          recordCardOutcome(outcome.cardsPlayed, outcome.firstAppearTurn, outcome.winner);
          mergeSurvival(outcome.survivalByCard);
          recordWinTurn(a, outcome.winner === 'A', outcome.turns);
          recordWinTurn(b, outcome.winner === 'B', outcome.turns);

          for (const [deckId, p] of [[a, 'A'], [b, 'B']] as const) {
            const curve = outcome.powerCurve[p];
            for (let turn = 1; turn <= MAX_POWER_CURVE_TURN; turn++) {
              const power = curve[turn];
              if (power === undefined) continue;
              powerSum[deckId][turn] += power;
              powerCount[deckId][turn]++;
              const rounded = Math.round(power);
              const hist = powerHistogram[deckId][turn];
              hist[rounded] = (hist[rounded] ?? 0) + 1;
            }
          }
          livePowerCurve = Object.fromEntries(
            DECK_IDS.map((id) => [
              id,
              powerSum[id]
                .map((sum, turn) => ({
                  turn,
                  avgPower: sum / (powerCount[id][turn] || 1),
                  mode5Power: top5ModeAvg(powerHistogram[id][turn]),
                  samples: powerCount[id][turn],
                }))
                .filter((pt) => pt.samples > 0),
            ]),
          );

          // 샤딩 모드에서는 (여러 프로세스가 같은 파일에 동시에 쓰면 깨지므로)
          // 공용 대시보드 파일을 건드리지 않고 이 shard 전용 raw 파일만 매 게임
          // 끝날 때마다 갱신 — 오케스트레이터가 나중에 합산한다.
          if (SHARDED) writeShardStats(); else writeLiveStats(false);
        }
      }
    } while (LIVE);
    if (SHARDED) {
      writeShardStats();
      // 매치업이 전부 실제로 돌았는지만 확인 — 밸런스/교착 판단은 오케스트레이터가
      // 합산 후 사람이 본다.
      expect(liveMatchups.length).toBe(MY_PAIRS.length);
      return;
    }
    writeLiveStats(true);

    console.log(`\n=== AI 밸런스 시뮬레이션 (${round}라운드 × 매치업당 ${GAMES_PER_MATCHUP}판) ===`);
    for (const e of liveMatchups) {
      const avgTurns = (e.turnSum / e.gamesRun).toFixed(1);
      const sdTurns = stddev(e.turnSum, e.turnSqSum, e.gamesRun);
      console.log(
        `${e.a.padEnd(8)} vs ${e.b.padEnd(8)}  A승 ${e.aWins}/${e.gamesRun}  B승 ${e.bWins}/${e.gamesRun}  ` +
        `안전판 ${e.stuck}  평균턴 ${avgTurns}±${sdTurns === null ? '-' : sdTurns.toFixed(1)}`,
      );
    }

    console.log(`\n=== 18회차: 덱별 이야기 전개 속도·완료율 (상대 무관 집계) ===`);
    const chainLen: Record<string, number> = { heroic: HERO_QUEST_CHAIN.length + 1, journey: MONKEY_CHAIN.length, cult: RITUAL_CHAIN.length };
    for (const id of DECK_IDS) {
      const t = storyTotals[id];
      const avgStage = (t.stageSum / t.games).toFixed(2);
      const sdStage = stddev(t.stageSum, t.stageSqSum, t.games);
      const completeRate = ((t.complete / t.games) * 100).toFixed(0);
      const avgTurnOnComplete = t.complete > 0 ? (t.turnSumOnComplete / t.complete).toFixed(1) : '-';
      console.log(
        `${id.padEnd(8)}  평균 진행도 ${avgStage}±${sdStage === null ? '-' : sdStage.toFixed(2)}/${chainLen[id]}  ` +
        `완주율 ${completeRate}%(${t.complete}/${t.games})  완주 시 평균턴 ${avgTurnOnComplete}`,
      );
    }

    console.log(`\n=== 덱별 파워커브 / 평균 승리 턴 (상대 무관 집계) ===`);
    for (const id of DECK_IDS) {
      const w = liveWinTurns[id];
      const winRate = w && w.games > 0 ? ((w.wins / w.games) * 100).toFixed(0) : '-';
      const avgTurnOnWin = w && w.wins > 0 ? (w.turnSumOnWin / w.wins).toFixed(1) : '-';
      const sdTurnOnWin = w && w.wins > 0 ? stddev(w.turnSumOnWin, w.turnSqSumOnWin, w.wins) : null;
      const minMaxTurnOnWin = w && w.wins > 0 ? `${w.minTurnOnWin}~${w.maxTurnOnWin}` : '-';
      const top5Mode = w && w.wins > 0 ? top5ModeAvgTurn(w.turnHistogram) : null;
      console.log(
        `${id.padEnd(8)}  승률 ${winRate}%(${w?.wins ?? 0}/${w?.games ?? 0})  ` +
        `평균 승리 턴 ${avgTurnOnWin}±${sdTurnOnWin === null ? '-' : sdTurnOnWin.toFixed(1)}  최소~최대 ${minMaxTurnOnWin}  ` +
        `최빈5평균 ${top5Mode === null ? '-' : top5Mode.toFixed(1)}`,
      );
    }
    if (stuckTotal > 0) {
      // 교착(MAX_STEPS 안전판) 발생 — 밸런스가 아니라 AI/룰 상호작용에 남은
      // 버그 신호. assert로 CI를 막지는 않지만(계속 파다 보면 끝이 없는 종류의
      // 이슈들이라) 눈에 띄게 경고는 남긴다. D-1 참고: 2026-07-03 세션에서
      // combatImmune·사거리 차폐 관련 교착 2건을 찾아 고쳤지만 일부는 남음.
      console.warn(`⚠ 안전판(MAX_STEPS=${MAX_STEPS})에 걸려 승부가 안 난 게임 ${stuckTotal}개 — AI 교착 가능성, src/rules/PLAN.md D-1 참고`);
    }

    // 밸런스(누가 더 많이 이기는지)나 교착 여부는 assert하지 않는다 — 통계는
    // 사람이 보고 판단할 몫. 여기서는 매치업이 전부 실제로 돌았는지만 확인.
    // (live 모드는 무한 루프라 여기 도달하지 않음)
    expect(liveMatchups.length).toBe(DECK_IDS.length * DECK_IDS.length);

    // shard raw 파일(있다면)은 이 프로세스 자체가 비-샤딩 실행이라 남아있으면 안
    // 되는 잔재뿐 — 정리는 오케스트레이터가 자기가 만든 shard 파일만 지운다.
    function writeShardStats(): void {
      const snapshot = {
        matchups: liveMatchups,
        storyTotals,
        cardStats: liveCardStats,
        powerSum,
        powerCount,
        powerHistogram,
        winTurns: liveWinTurns,
        stuckTotal,
      };
      try {
        mkdirSync(STATS_DIR, { recursive: true });
        writeFileSync(SHARD_FILE, JSON.stringify(snapshot));
      } catch {
        // 부가 기능 — 파일 쓰기 실패로 테스트를 막지 않는다.
      }
    }
  });
});
