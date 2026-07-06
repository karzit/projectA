// `npm run test:balance:live` 진입점 — SIM_LIVE=1을 셸 문법 차이(Windows/POSIX)
// 걱정 없이 심어주고 vitest를 그대로 이어받는다. Ctrl+C로 멈출 때까지 라운드를
// 무한 반복하며 stats/ai-balance-stats.json을 계속 갱신한다.
import { spawn } from 'node:child_process';

const child = spawn(
  'npx',
  ['vitest', 'run', 'tests/ai-balance.test.ts'],
  { stdio: 'inherit', env: { ...process.env, SIM_LIVE: '1' }, shell: true },
);

child.on('exit', (code) => process.exit(code ?? 0));
