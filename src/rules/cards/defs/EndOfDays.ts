import { Card, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 종말[배경:단일 유닛의 지혜:20]. 모든 환경과 전장을 파괴하고 전개:지역:황무지.
class EndOfDaysCard extends Card {
  readonly meta: CardMeta = {
    id: 'end-of-days',
    name: '종말',
    kind: 'spell',
    conditions: [{ need: 'unitWisdom', amount: 20 }],
    desc: '배경:단일 유닛 지혜 20. 모든 환경·전장 파괴 후 전개:지역:황무지.',
  };

  override onPlay(ctx: GameContext): void {
    // 모든 유닛 파괴 (스냅샷)
    const all = [...ctx.board.allFieldUnitIds()];
    for (const id of all) {
      if (ctx.board.getUnit(id)) ctx.board.destroyUnit(id);
    }
    // 모든 환경 제거
    for (const type of ctx.board.environmentTypes()) ctx.board.removeEnvironment(type);
    // 전개: 지역:황무지
    ctx.board.developEnv('지역', '황무지');
  }
}

export const EndOfDays = new EndOfDaysCard();
