import { UnitCard, type CardMeta } from '../Card.js';
import type { GameContext } from '../../GameContext.js';

// 사교도[3/3]. 이 카드는 덱에 여러 장 넣을 수 있다.
// 사용 시 전개:장소:사교의 소굴.
class CultistCard extends UnitCard {
  readonly meta: CardMeta = {
    id: 'cultist',
    name: '사교도',
    kind: 'unit',
    power: 3,
    wisdom: 3,
    multiCopy: true,
    keywords: ['사교도'],
    desc: '덱에 여러 장 가능. 사용 시 전개:장소:사교의 소굴.',
  };

  override onPlay(ctx: GameContext): void {
    ctx.board.developEnv('장소', '사교의 소굴');
  }
}

export const Cultist = new CultistCard();
