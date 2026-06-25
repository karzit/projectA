// Draws the board from a rules GameState: region backdrops and every card via
// cached sprites. Pure function of state.

import { CardSprite } from './CardSprite.js';
import { Animator, type CardTarget, type Transform, type VisualDesc } from './Animator.js';
import { UI } from './theme.js';
import { layout, type BoardLayout, type CardView, type Rect } from './layout.js';
import type { GameState, PlayerId } from '../../rules/index.js';

export interface BoardVisuals {
  targets: Map<string, CardTarget>;
  descs: Map<string, VisualDesc>;
}

export class BoardRenderer {
  constructor(
    private readonly sprites: CardSprite,
    private readonly getState: () => GameState,
    private readonly localPlayer: PlayerId,
    private readonly animator: Animator,
  ) {}

  computeLayout(w: number, h: number): BoardLayout {
    return layout(this.getState(), { width: w, height: h }, this.localPlayer);
  }

  buildVisuals(w: number, h: number): BoardVisuals {
    const lo = this.computeLayout(w, h);
    const targets = new Map<string, CardTarget>();
    const descs = new Map<string, VisualDesc>();
    for (const cv of lo.cards) {
      targets.set(cv.key, { x: cv.x, y: cv.y, rot: 0 });
      descs.set(cv.key, {
        cardId: cv.cardId,
        faceUp: cv.faceUp,
        w: cv.w,
        h: cv.h,
      });
    }
    return { targets, descs };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const lo = this.computeLayout(w, h);

    for (const name of ['oppHand', 'oppField', 'localField', 'localHand'] as const) {
      this.drawRegion(ctx, lo.regions[name], this.regionLabel(name));
    }

    for (const cv of lo.cards) this.drawCard(ctx, cv);

    for (const ex of this.animator.exitingItems()) this.drawExiting(ctx, ex.t, ex.desc);
  }

  private regionLabel(name: string): string {
    switch (name) {
      case 'oppHand': return '상대 패';
      case 'oppField': return '상대 필드';
      case 'localField': return '내 필드';
      case 'localHand': return '내 패';
      default: return '';
    }
  }

  private drawExiting(ctx: CanvasRenderingContext2D, t: Transform, desc: VisualDesc): void {
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x + desc.w / 2, t.y + desc.h / 2);
    ctx.rotate(t.rot);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(this.sprites.get(desc.cardId, desc.faceUp), -desc.w / 2, -desc.h / 2, desc.w, desc.h);
    ctx.restore();
  }

  private drawRegion(ctx: CanvasRenderingContext2D, r: Rect, label?: string): void {
    ctx.fillStyle = UI.region;
    ctx.beginPath();
    ctx.roundRect(r.x + 6, r.y - 4, r.w - 12, r.h + 8, 8);
    ctx.fill();
    if (label) {
      ctx.fillStyle = UI.sub;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(label, r.x + 10, r.y - 8);
    }
  }

  private drawCard(ctx: CanvasRenderingContext2D, cv: CardView): void {
    const t = this.animator.getTransform(cv.key);
    if (t) {
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.translate(t.x + cv.w / 2, t.y + cv.h / 2);
      ctx.rotate(t.rot);
      ctx.scale(t.scale, t.scale);
      ctx.drawImage(this.sprites.get(cv.cardId, cv.faceUp), -cv.w / 2, -cv.h / 2, cv.w, cv.h);
      ctx.restore();
    } else {
      ctx.drawImage(this.sprites.get(cv.cardId, cv.faceUp), cv.x, cv.y, cv.w, cv.h);
    }
  }
}
