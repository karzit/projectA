// Renders a card face (or back) once into an offscreen buffer and caches it.
// Text rendering is the single most expensive thing we do per frame, so we never
// draw a card's face directly to the board — we blit a pre-rendered bitmap.
// Cache key is (oracleId + faceUp); tap rotation is applied by the board
// renderer at blit time, not baked into the sprite.

import { CARD, UI, cardBaseColor, costToString, manaColorHex } from './theme.js';
import { getDef } from '../../engine/index.js';
import type { CardDef } from '../../engine/index.js';

const SS = 2; // supersample factor for crisp text when scaled down

export class CardSprite {
  private readonly cache = new Map<string, HTMLCanvasElement>();

  get(oracleId: string, faceUp: boolean): HTMLCanvasElement {
    const key = faceUp ? `face:${oracleId}` : 'back';
    const hit = this.cache.get(key);
    if (hit) return hit;

    const buf = document.createElement('canvas');
    buf.width = CARD.w * SS;
    buf.height = CARD.h * SS;
    const ctx = buf.getContext('2d')!;
    ctx.scale(SS, SS);
    if (faceUp) this.drawFace(ctx, getDef(oracleId));
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

  private drawFace(ctx: CanvasRenderingContext2D, def: CardDef): void {
    const w = CARD.w;
    this.frame(ctx, cardBaseColor(def));

    // Title bar
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, 16, 4);
    ctx.fill();
    ctx.fillStyle = UI.cardText;
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.fit(ctx, def.name, w - 30), 9, 15);

    // Mana cost (top-right)
    const cost = costToString(def);
    if (cost) {
      ctx.textAlign = 'right';
      ctx.fillText(cost, w - 9, 15);
      ctx.textAlign = 'left';
    }

    // Art placeholder
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(8, 26, w - 16, 58);

    // Type line
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(6, 88, w - 12, 14);
    ctx.fillStyle = UI.cardText;
    ctx.font = '600 8px system-ui, sans-serif';
    ctx.fillText(this.fit(ctx, def.types.join(' '), w - 16), 9, 95);

    // Keywords
    if (def.keywords?.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '7px system-ui, sans-serif';
      ctx.fillText(this.fit(ctx, def.keywords.join(', '), w - 16), 9, 110);
    }

    // Power/Toughness (bottom-right) for creatures
    if (def.types.includes('creature') && def.power !== undefined) {
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.roundRect(w - 34, CARD.h - 22, 28, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${def.power}/${def.toughness}`, w - 20, CARD.h - 13);
      ctx.textAlign = 'left';
    }
  }

  private drawBack(ctx: CanvasRenderingContext2D): void {
    this.frame(ctx, '#1b2440');
    const cx = CARD.w / 2;
    const cy = CARD.h / 2;
    ctx.strokeStyle = manaColorHex('U');
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
