// 헤드리스 AI 대 AI 시뮬레이션 — 진짜 assert는 최소(무한루프/크래시 감지)이고,
// 주된 목적은 프리셋 덱 매치업 승률·평균 턴 수를 콘솔에 찍어 D-1(밸런스 점검)에
// 참고 데이터를 주는 것. 실제 "재미" 판정은 사람 몫 — 이 파일은 그 판정을
// 대체하지 않는다. `SIM_GAMES` 환경변수로 매치업당 게임 수를 조절할 수 있다
// (기본값은 CI/npm test 속도를 해치지 않을 만큼 작게 유지).
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game, otherPlayer } from '../src/rules/index.js';
import type { GameState, PlayerId, RulesAction } from '../src/rules/index.js';
import { createSimAI } from '../src/client/ai/deckAI.js';
import { EventManager } from '../src/client/core/EventManager.js';
import { deckById } from '../src/client/decks.js';

// --- 대시보드용 실시간 통계 스냅샷 -----------------------------------------
// `ai-balance-dashboard.html`(vite dev 서버로 서빙)이 이 파일을 폴링해서
// 시뮬레이션 진행 중 승률/이야기 전개/카드별 승률/덱 상성을 실시간으로 보여준다.
// 테스트 자체의 assert에는 관여하지 않는 순수 부가 기능 — 쓰기 실패해도 무시.
const STATS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'stats');
const STATS_FILE = join(STATS_DIR, 'ai-balance-stats.json');

interface LiveMatchup { a: string; b: string; aWins: number; bWins: number; stuck: number; gamesRun: number; turnSum: number; }
interface LiveCardStat { games: number; wins: number; }
interface LiveStoryStat { games: number; stageSum: number; chainLen: number; complete: number; turnSumOnComplete: number; }
interface LivePowerPoint { turn: number; avgPower: number; samples: number; }
interface LiveWinTurnStat { games: number; wins: number; turnSumOnWin: number; }
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
// 보려는 것. 턴 40 이후(황폐 시작 근방)는 표본이 희소해지고 안전판 교착 게임의
// 노이즈가 커서 잘라낸다.
const MAX_POWER_CURVE_TURN = 40;

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

function recordCardOutcome(cardsPlayed: Record<PlayerId, Set<string>>, winner: PlayerId | null): void {
  for (const p of ['A', 'B'] as const) {
    const won = winner === p;
    for (const cardId of cardsPlayed[p]) {
      const s = (liveCardStats[cardId] ??= { games: 0, wins: 0 });
      s.games++;
      if (won) s.wins++;
    }
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
  const s = (liveWinTurns[deckId] ??= { games: 0, wins: 0, turnSumOnWin: 0 });
  s.games++;
  if (won) { s.wins++; s.turnSumOnWin += turns; }
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
    A: createSimAI('A', events, () => game.state, deckIdA),
    B: createSimAI('B', events, () => game.state, deckIdB),
  };
  const progress = emptyProgress();
  const cardsPlayed: Record<PlayerId, Set<string>> = { A: new Set(), B: new Set() };
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
    }
    scanUnitProgress(progress, result.state);
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
  return { winner: loser ? otherPlayer(loser) : null, turns: game.state.turn, progress, cardsPlayed, powerCurve };
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
    const storyTotals: Record<string, { games: number; stageSum: number; complete: number; turnSumOnComplete: number }> = {};
    for (const id of DECK_IDS) storyTotals[id] = { games: 0, stageSum: 0, complete: 0, turnSumOnComplete: 0 };
    const chainLenInit: Record<string, number> = { heroic: HERO_QUEST_CHAIN.length + 1, journey: MONKEY_CHAIN.length, cult: RITUAL_CHAIN.length };
    liveStory = Object.fromEntries(
      DECK_IDS.map((id) => [id, { games: 0, stageSum: 0, chainLen: chainLenInit[id], complete: 0, turnSumOnComplete: 0 }]),
    );
    // 파워커브 누적기 — 턴 인덱스(1~MAX_POWER_CURVE_TURN)별 합/표본수. 라운드가
    // 반복돼도 리셋하지 않아 live 모드에서 평균이 계속 매끄럽게 다듬어진다.
    const powerSum: Record<string, number[]> = {};
    const powerCount: Record<string, number[]> = {};
    for (const id of DECK_IDS) {
      powerSum[id] = new Array(MAX_POWER_CURVE_TURN + 1).fill(0);
      powerCount[id] = new Array(MAX_POWER_CURVE_TURN + 1).fill(0);
    }
    // 매치업 엔트리는 라운드마다 새로 만들지 않고 재사용 — live 모드에서 라운드를
    // 반복할수록 표본이 계속 누적되어 대시보드 수치가 매끄럽게 수렴한다.
    const matchupEntries = new Map<string, LiveMatchup>();
    liveMatchups = [];
    for (const a of DECK_IDS) {
      for (const b of DECK_IDS) {
        const entry: LiveMatchup = { a, b, aWins: 0, bWins: 0, stuck: 0, gamesRun: 0, turnSum: 0 };
        matchupEntries.set(`${a}|${b}`, entry);
        liveMatchups.push(entry);
      }
    }
    writeLiveStats(false);

    let stuckTotal = 0;
    let round = 0;
    do {
      round++;
      for (const a of DECK_IDS) {
        for (const b of DECK_IDS) {
          const liveEntry = matchupEntries.get(`${a}|${b}`)!;
          for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
            const outcome = runOneGame(a, b, seed++);
            if (outcome.winner === 'A') liveEntry.aWins++;
            else if (outcome.winner === 'B') liveEntry.bWins++;
            else { liveEntry.stuck++; stuckTotal++; }
            liveEntry.gamesRun++;
            liveEntry.turnSum += outcome.turns;

            for (const [deckId, p] of [[a, 'A'], [b, 'B']] as const) {
              const t = storyTotals[deckId];
              t.games++;
              t.stageSum += deckProgressScore(deckId, outcome.progress, p);
              if (deckProgressComplete(deckId, outcome.progress, p)) {
                t.complete++;
                t.turnSumOnComplete += outcome.turns;
              }
              const lt = liveStory[deckId];
              lt.games++;
              lt.stageSum += deckProgressScore(deckId, outcome.progress, p);
              if (deckProgressComplete(deckId, outcome.progress, p)) {
                lt.complete++;
                lt.turnSumOnComplete += outcome.turns;
              }
            }

            recordCardOutcome(outcome.cardsPlayed, outcome.winner);
            recordWinTurn(a, outcome.winner === 'A', outcome.turns);
            recordWinTurn(b, outcome.winner === 'B', outcome.turns);

            for (const [deckId, p] of [[a, 'A'], [b, 'B']] as const) {
              const curve = outcome.powerCurve[p];
              for (let turn = 1; turn <= MAX_POWER_CURVE_TURN; turn++) {
                const power = curve[turn];
                if (power === undefined) continue;
                powerSum[deckId][turn] += power;
                powerCount[deckId][turn]++;
              }
            }
            livePowerCurve = Object.fromEntries(
              DECK_IDS.map((id) => [
                id,
                powerSum[id]
                  .map((sum, turn) => ({ turn, avgPower: sum / (powerCount[id][turn] || 1), samples: powerCount[id][turn] }))
                  .filter((pt) => pt.samples > 0),
              ]),
            );

            writeLiveStats(false);
          }
        }
      }
    } while (LIVE);
    writeLiveStats(true);

    console.log(`\n=== AI 밸런스 시뮬레이션 (${round}라운드 × 매치업당 ${GAMES_PER_MATCHUP}판) ===`);
    for (const e of liveMatchups) {
      const avgTurns = (e.turnSum / e.gamesRun).toFixed(1);
      console.log(
        `${e.a.padEnd(8)} vs ${e.b.padEnd(8)}  A승 ${e.aWins}/${e.gamesRun}  B승 ${e.bWins}/${e.gamesRun}  ` +
        `안전판 ${e.stuck}  평균턴 ${avgTurns}`,
      );
    }

    console.log(`\n=== 18회차: 덱별 이야기 전개 속도·완료율 (상대 무관 집계) ===`);
    const chainLen: Record<string, number> = { heroic: HERO_QUEST_CHAIN.length + 1, journey: MONKEY_CHAIN.length, cult: RITUAL_CHAIN.length };
    for (const id of DECK_IDS) {
      const t = storyTotals[id];
      const avgStage = (t.stageSum / t.games).toFixed(2);
      const completeRate = ((t.complete / t.games) * 100).toFixed(0);
      const avgTurnOnComplete = t.complete > 0 ? (t.turnSumOnComplete / t.complete).toFixed(1) : '-';
      console.log(
        `${id.padEnd(8)}  평균 진행도 ${avgStage}/${chainLen[id]}  완주율 ${completeRate}%(${t.complete}/${t.games})  ` +
        `완주 시 평균턴 ${avgTurnOnComplete}`,
      );
    }

    console.log(`\n=== 덱별 파워커브 / 평균 승리 턴 (상대 무관 집계) ===`);
    for (const id of DECK_IDS) {
      const w = liveWinTurns[id];
      const winRate = w && w.games > 0 ? ((w.wins / w.games) * 100).toFixed(0) : '-';
      const avgTurnOnWin = w && w.wins > 0 ? (w.turnSumOnWin / w.wins).toFixed(1) : '-';
      console.log(`${id.padEnd(8)}  승률 ${winRate}%(${w?.wins ?? 0}/${w?.games ?? 0})  평균 승리 턴 ${avgTurnOnWin}`);
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
  });
});
