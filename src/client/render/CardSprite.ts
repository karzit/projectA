// Renders a card face (or back) once into an offscreen buffer and caches it.
// Cache key is (cardId + faceUp); rotation is applied at blit time.

import { CARD, UI, cardBaseColor } from './theme.js';
import { getDef } from '../../rules/index.js';
import type { CardMeta } from '../../rules/index.js';

const SS = 2; // supersample factor for crisp text when scaled down

export class CardSprite {
  private readonly cache = new Map<string, HTMLCanvasElement>();

  get(cardId: string, faceUp: boolean): HTMLCanvasElement {
    const key = faceUp ? `face:${cardId}` : 'back';
    const hit = this.cache.get(key);
    if (hit) return hit;

    const buf = document.createElement('canvas');
    buf.width = CARD.w * SS;
    buf.height = CARD.h * SS;
    const ctx = buf.getContext('2d')!;
    ctx.scale(SS, SS);
    if (faceUp) this.drawFace(ctx, getDef(cardId));
    else this.drawBack(ctx);
    this.cache.set(key, buf);
    return buf;
  }

  private frame(ctx: CanvasRenderingContext2D, fill: string): void {
    const w = CARD.w;
    const h = CARD.h;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, CARD.radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = UI.cardBorder;
    ctx.stroke();
  }

  private drawFace(ctx: CanvasRenderingContext2D, meta: CardMeta): void {
    const w = CARD.w;
    const h = CARD.h;
    this.frame(ctx, cardBaseColor(meta));

    // Title bar
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, 16, 4);
    ctx.fill();
    ctx.fillStyle = UI.cardText;
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.fit(ctx, meta.name, w - 14), 9, 15);

    // Art placeholder
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(8, 26, w - 16, 54);

    // Kind badge
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(6, 84, w - 12, 13);
    ctx.fillStyle = UI.cardText;
    ctx.font = '600 8px system-ui, sans-serif';
    const kindLabel = meta.kind === 'unit' ? '유닛' : '주문';
    ctx.fillText(kindLabel, 9, 90);

    // Keywords
    const kw = meta.keywords ?? [];
    if (kw.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '7px system-ui, sans-serif';
      ctx.fillText(this.fit(ctx, kw.join(' · '), w - 14), 9, 104);
    }

    // Power / Wisdom badge (bottom-right, units only)
    if (meta.kind === 'unit' && meta.power !== undefined) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.roundRect(w - 40, h - 22, 34, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`힘${meta.power} 지${meta.wisdom ?? 0}`, w - 23, h - 13);
      ctx.textAlign = 'left';
    }
  }

  private drawBack(ctx: CanvasRenderingContext2D): void {
    this.frame(ctx, '#1b2440');
    const cx = CARD.w / 2;
    const cy = CARD.h / 2;
    ctx.strokeStyle = '#4a86c5';
    ctx.globalAlpha = 0.5;
    for (let r = 8; r < 40; r += 8) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
}
