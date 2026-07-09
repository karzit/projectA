// `npm run test:balance:parallel`(유한 배치) / `npm run test:balance:live:parallel`
// (SIM_LIVE=1, 무한 반복 + 대시보드) 진입점 — tests/ai-balance.test.ts를 여러 OS
// 프로세스로 나눠 돌려 매치업들을 실제 멀티코어로 병렬 시뮬레이션한다. 매치업
// 하나(예: heroic vs cult)가 통째로 한 shard의 몫이라(부분 게임 쪼개기가 아님)
// 병합은 단순 합산 + 배열 concat으로 끝난다. `SIM_GAMES`(매치업당 게임 수),
// `SIM_WORKERS`(프로세스 수, 기본 min(CPU 코어 수, 매치업 수))를 환경변수로
// 조절할 수 있다.
//
// live 모드에서는 각 shard 프로세스가 무한 루프를 돌며 자기 shard 파일을 매
// 게임마다 계속 갱신하므로(tests/ai-balance.test.ts 참고), 여기서는 자식들이
// 끝나길 기다리지 않고 주기적으로(MERGE_INTERVAL_MS) shard 파일들을 다시 읽어
// 합산 → stats/ai-balance-stats.json에 반영한다(대시보드가 폴링). Ctrl+C(SIGINT)
// 시 자식들을 정리하고 마지막으로 한 번 더 합산한 뒤 종료한다.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATS_DIR = join(ROOT, 'stats');
const STATS_FILE = join(STATS_DIR, 'ai-balance-stats.json');
const LIVE = process.env.SIM_LIVE === '1';
const MERGE_INTERVAL_MS = 1500;

// basic 제외, tests/ai-balance.test.ts의 DECK_IDS와 일치시켜야 함.
const DECK_IDS = ['heroic', 'journey', 'cult'];
const TOTAL_PAIRS = DECK_IDS.length * DECK_IDS.length;
const SHARD_COUNT = Math.max(1, Math.min(Number(process.env.SIM_WORKERS ?? cpus().length), TOTAL_PAIRS));
const MAX_POWER_CURVE_TURN = 150; // tests/ai-balance.test.ts와 일치시켜야 함
const chainLen = { heroic: 5, journey: 7, cult: 5 };
const gamesPerMatchup = Number(process.env.SIM_GAMES ?? 2);

// 표본 표준편차(n-1 분모) — 표본이 1개 이하면 정의 안 됨.
function stddev(sum, sqSum, n) {
  if (n < 2) return null;
  const mean = sum / n;
  const variance = (sqSum - n * mean * mean) / (n - 1);
  return Math.sqrt(Math.max(0, variance));
}

// "최빈값 5개의 평균" — 정수 값 히스토그램(값 → 등장 횟수)에서 가장 빈도 높은
// 값 최대 5개를 뽑아 그 값 자체를 평균한다(tests/ai-balance.test.ts의 top5ModeAvg와
// 동일 로직) — 승리 턴/파워커브 턴별 최빈 힘 양쪽에서 재사용.
function top5ModeAvg(histogram) {
  const entries = Object.entries(histogram ?? {}).map(([v, count]) => ({ v: Number(v), count }));
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.count - a.count || a.v - b.v);
  const top = entries.slice(0, 5);
  return top.reduce((sum, e) => sum + e.v, 0) / top.length;
}
const top5ModeAvgTurn = top5ModeAvg;

console.log(`매치업 ${TOTAL_PAIRS}개를 프로세스 ${SHARD_COUNT}개로 나눠 병렬 실행${LIVE ? ' (live — Ctrl+C로 종료)' : ''}...`);

function shardFile(i) {
  return join(STATS_DIR, `.shard-${i}-of-${SHARD_COUNT}.json`);
}

mkdirSync(STATS_DIR, { recursive: true });
for (let i = 0; i < SHARD_COUNT; i++) {
  if (existsSync(shardFile(i))) rmSync(shardFile(i));
}

const children = [];

function spawnShard(i) {
  const child = spawn(
    'npx',
    ['vitest', 'run', 'tests/ai-balance.test.ts'],
    {
      cwd: ROOT,
      stdio: LIVE ? 'ignore' : 'inherit', // live 모드는 무한 루프라 자식 로그를 계속 흘려보내지 않는다
      shell: true,
      env: { ...process.env, SIM_SHARD_INDEX: String(i), SIM_SHARD_COUNT: String(SHARD_COUNT) },
    },
  );
  children.push(child);
  return child;
}

function waitForExit(child, i) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${i} exited with code ${code}`))));
    child.on('error', reject);
  });
}

// shard 파일들을 다시 읽어 합산한 결과를 돌려준다. 개별 shard가 아직 안 생겼거나
// (막 시작해서) 쓰는 도중 깨진 JSON이면 그 shard는 이번 스냅샷에서 건너뛴다 —
// live 모드에서는 다음 tick에 다시 읽으니 self-heal.
function mergeShards() {
  const matchups = [];
  const storyTotals = Object.fromEntries(DECK_IDS.map((id) => [id, { games: 0, stageSum: 0, stageSqSum: 0, complete: 0, turnSumOnComplete: 0 }]));
  const cardStats = {};
  const powerSum = Object.fromEntries(DECK_IDS.map((id) => [id, new Array(MAX_POWER_CURVE_TURN + 1).fill(0)]));
  const powerCount = Object.fromEntries(DECK_IDS.map((id) => [id, new Array(MAX_POWER_CURVE_TURN + 1).fill(0)]));
  const powerHistogram = Object.fromEntries(
    DECK_IDS.map((id) => [id, Array.from({ length: MAX_POWER_CURVE_TURN + 1 }, () => ({}))]),
  );
  const winTurns = Object.fromEntries(DECK_IDS.map((id) => [id, { games: 0, wins: 0, turnSumOnWin: 0, turnSqSumOnWin: 0, minTurnOnWin: null, maxTurnOnWin: null, turnHistogram: {} }]));
  let stuckTotal = 0;

  for (let i = 0; i < SHARD_COUNT; i++) {
    const f = shardFile(i);
    if (!existsSync(f)) continue;
    let shard;
    try { shard = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    matchups.push(...shard.matchups);
    stuckTotal += shard.stuckTotal;
    for (const id of DECK_IDS) {
      const t = storyTotals[id];
      const s = shard.storyTotals[id];
      t.games += s.games; t.stageSum += s.stageSum; t.stageSqSum += s.stageSqSum ?? 0; t.complete += s.complete; t.turnSumOnComplete += s.turnSumOnComplete;

      const w = winTurns[id];
      const sw = shard.winTurns[id];
      if (sw) {
        w.games += sw.games; w.wins += sw.wins; w.turnSumOnWin += sw.turnSumOnWin; w.turnSqSumOnWin += sw.turnSqSumOnWin ?? 0;
        if (sw.minTurnOnWin !== null) w.minTurnOnWin = w.minTurnOnWin === null ? sw.minTurnOnWin : Math.min(w.minTurnOnWin, sw.minTurnOnWin);
        if (sw.maxTurnOnWin !== null) w.maxTurnOnWin = w.maxTurnOnWin === null ? sw.maxTurnOnWin : Math.max(w.maxTurnOnWin, sw.maxTurnOnWin);
        for (const [turn, count] of Object.entries(sw.turnHistogram ?? {})) {
          w.turnHistogram[turn] = (w.turnHistogram[turn] ?? 0) + count;
        }
      }

      for (let turn = 0; turn <= MAX_POWER_CURVE_TURN; turn++) {
        powerSum[id][turn] += shard.powerSum[id][turn];
        powerCount[id][turn] += shard.powerCount[id][turn];
        for (const [power, count] of Object.entries(shard.powerHistogram?.[id]?.[turn] ?? {})) {
          powerHistogram[id][turn][power] = (powerHistogram[id][turn][power] ?? 0) + count;
        }
      }
    }
    for (const [cardId, s] of Object.entries(shard.cardStats)) {
      const c = (cardStats[cardId] ??= { games: 0, wins: 0, turnSum: 0, survivalSum: 0, survivalCount: 0 });
      c.games += s.games; c.wins += s.wins;
      c.turnSum += s.turnSum ?? 0;
      c.survivalSum += s.survivalSum ?? 0;
      c.survivalCount += s.survivalCount ?? 0;
    }
  }
  return { matchups, storyTotals, cardStats, powerSum, powerCount, powerHistogram, winTurns, stuckTotal };
}

function writeMergedStats(merged, done) {
  const powerCurve = Object.fromEntries(
    DECK_IDS.map((id) => [
      id,
      merged.powerSum[id]
        .map((sum, turn) => ({
          turn,
          avgPower: sum / (merged.powerCount[id][turn] || 1),
          mode5Power: top5ModeAvg(merged.powerHistogram[id][turn]),
          samples: merged.powerCount[id][turn],
        }))
        .filter((pt) => pt.samples > 0),
    ]),
  );
  writeFileSync(STATS_FILE, JSON.stringify({
    startedAt: started,
    updatedAt: Date.now(),
    done,
    gamesPerMatchup,
    matchups: merged.matchups,
    story: Object.fromEntries(DECK_IDS.map((id) => [id, { ...merged.storyTotals[id], chainLen: chainLen[id] }])),
    cards: merged.cardStats,
    powerCurve,
    winTurns: merged.winTurns,
  }, null, 2));
}

function printSummary(merged) {
  console.log(`\n=== AI 밸런스 시뮬레이션 (매치업당 ${gamesPerMatchup}판, ${SHARD_COUNT}개 프로세스 병렬) ===`);
  for (const e of merged.matchups) {
    const avgTurns = e.gamesRun > 0 ? (e.turnSum / e.gamesRun).toFixed(1) : '-';
    const sdTurns = e.gamesRun > 0 ? stddev(e.turnSum, e.turnSqSum ?? 0, e.gamesRun) : null;
    console.log(
      `${e.a.padEnd(8)} vs ${e.b.padEnd(8)}  A승 ${e.aWins}/${e.gamesRun}  B승 ${e.bWins}/${e.gamesRun}  ` +
      `안전판 ${e.stuck}  평균턴 ${avgTurns}±${sdTurns === null ? '-' : sdTurns.toFixed(1)}`,
    );
  }

  console.log(`\n=== 덱별 이야기 전개 속도·완료율 (상대 무관 집계) ===`);
  for (const id of DECK_IDS) {
    const t = merged.storyTotals[id];
    const avgStage = t.games > 0 ? (t.stageSum / t.games).toFixed(2) : '-';
    const sdStage = t.games > 0 ? stddev(t.stageSum, t.stageSqSum, t.games) : null;
    const completeRate = t.games > 0 ? ((t.complete / t.games) * 100).toFixed(0) : '-';
    const avgTurnOnComplete = t.complete > 0 ? (t.turnSumOnComplete / t.complete).toFixed(1) : '-';
    console.log(
      `${id.padEnd(8)}  평균 진행도 ${avgStage}±${sdStage === null ? '-' : sdStage.toFixed(2)}/${chainLen[id]}  ` +
      `완주율 ${completeRate}%(${t.complete}/${t.games})  완주 시 평균턴 ${avgTurnOnComplete}`,
    );
  }

  console.log(`\n=== 덱별 파워커브 / 평균 승리 턴 (상대 무관 집계) ===`);
  for (const id of DECK_IDS) {
    const w = merged.winTurns[id];
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
  if (merged.stuckTotal > 0) {
    console.warn(`⚠ 안전판에 걸려 승부가 안 난 게임 ${merged.stuckTotal}개 — AI 교착 가능성, src/rules/PLAN.md D-1 참고`);
  }
}

function cleanupShardFiles() {
  for (let i = 0; i < SHARD_COUNT; i++) {
    const f = shardFile(i);
    if (existsSync(f)) rmSync(f);
  }
}

const started = Date.now();
for (let i = 0; i < SHARD_COUNT; i++) spawnShard(i);

if (LIVE) {
  let shuttingDown = false;
  const interval = setInterval(() => {
    writeMergedStats(mergeShards(), false);
  }, MERGE_INTERVAL_MS);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    console.log('\n종료 중 — 자식 프로세스 정리 및 마지막 합산...');
    for (const child of children) child.kill();
    const merged = mergeShards();
    writeMergedStats(merged, true);
    printSummary(merged);
    cleanupShardFiles();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  await Promise.all(children.map((child, i) => waitForExit(child, i)));
  console.log(`\n모든 shard 완료 (${((Date.now() - started) / 1000).toFixed(1)}s) — 합산 중...`);
  const merged = mergeShards();
  writeMergedStats(merged, true);
  printSummary(merged);
  cleanupShardFiles();
}
