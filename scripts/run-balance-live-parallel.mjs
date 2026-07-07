// `npm run test:balance:live:parallel` 진입점 — SIM_LIVE=1을 셸 문법 차이
// (Windows/POSIX) 걱정 없이 심어주고 run-balance-parallel.mjs를 그대로
// 이어받는다(run-balance-live.mjs가 단일 프로세스 vitest에 하던 것과 동일한
// 패턴, 대상만 병렬 러너로 바뀐 것). Ctrl+C로 멈출 때까지 여러 프로세스가
// 매치업을 나눠 계속 시뮬레이션하며 stats/ai-balance-stats.json을 갱신한다.
import { spawn } from 'node:child_process';

const child = spawn(
  'node',
  ['scripts/run-balance-parallel.mjs'],
  { stdio: 'inherit', env: { ...process.env, SIM_LIVE: '1' }, shell: true },
);

child.on('exit', (code) => process.exit(code ?? 0));
