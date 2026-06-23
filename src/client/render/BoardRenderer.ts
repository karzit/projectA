// Draws the whole board from GameState: region backdrops, every card (via cached
// sprites, rotated when tapped), the stack, and a small status/HUD line. Pure
// function of state — it never holds mutable view state, which is why it can be
// driven entirely off the dirty-layer system.

import { CardSprite } from './CardSprite.js';
import { Animator, type CardTarget, type Transform, type VisualDesc } from './Animator.js';
import { UI } from './theme.js';
import { layout, type BoardLayout, type CardView, type Rect, type StackItemView } from './layout.js';
import { getDef, type GameState, type PlayerId, type TargetRef } from '../../engine/index.js';

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

  // The per-key animation targets (where each card/stack item wants to be, and
  // whether tapped) plus descriptors (how to draw each, also used for fade-out).
  buildVisuals(w: number, h: number): BoardVisuals {
    const lo = this.computeLayout(w, h);
    const targets = new Map<string, CardTarget>();
    const descs = new Map<string, VisualDesc>();
    for (const cv of lo.cards) {
      targets.set(cv.instanceId, { x: cv.x, y: cv.y, rot: cv.tapped ? Math.PI / 2 : 0 });
      descs.set(cv.instanceId, { kind: 'card', oracleId: cv.oracleId, faceUp: cv.faceUp, w: cv.w, h: cv.h, accent: '' });
    }
    for (const item of lo.stack) {
      targets.set(item.key, { x: item.x, y: item.y, rot: 0 });
      descs.set(item.key, {
        kind: item.kind === 'ability' ? 'ability' : 'card',
        oracleId: item.oracleId,
        faceUp: true,
        w: item.w,
        h: item.h,
        accent: item.controller === this.localPlayer ? UI.hover : UI.arrow,
      });
    }
    return { targets, descs };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const lo = this.computeLayout(w, h);

    for (const name of ['p1Hand', 'p1Field', 'p0Field', 'p0Hand'] as const) {
      this.drawRegion(ctx, lo.regions[name]);
    }
    this.drawRegion(ctx, lo.regions.stack, lo.stack.length ? `STACK (${lo.stack.length})` : 'STACK');

    for (const cv of lo.cards) this.drawCard(ctx, cv);

    // Stack objects render above the board; bottom-of-stack first so the top
    // (which resolves next) overlaps on top.
    for (const item of lo.stack) this.drawStackItem(ctx, item);

    // Items fading out (resolved spells, destroyed creatures) drawn on top.
    for (const ex of this.animator.exitingItems()) this.drawExiting(ctx, ex.t, ex.desc);

    // State-derived arrows: what's on the stack is targeting, and combat.
    this.drawArrows(ctx, lo, w, h);
  }

  private drawExiting(ctx: CanvasRenderingContext2D, t: Transform, desc: VisualDesc): void {
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x + desc.w / 2, t.y + desc.h / 2);
    ctx.rotate(t.rot);
    ctx.scale(t.scale, t.scale);
    if (desc.kind === 'ability') {
      this.drawAbilityToken(ctx, -desc.w / 2, -desc.h / 2, desc.w, desc.h, desc.oracleId, desc.accent || UI.sub);
    } else {
      ctx.drawImage(this.sprites.get(desc.oracleId, desc.faceUp), -desc.w / 2, -desc.h / 2, desc.w, desc.h);
    }
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
    const sprite = this.sprites.get(cv.oracleId, cv.faceUp);
    // Use the animated transform (eased toward this card's layout target /
    // tap rotation); fall back to the static target if not yet tracked.
    const t = this.animator.getTransform(cv.instanceId) ?? {
      x: cv.x,
      y: cv.y,
      rot: cv.tapped ? Math.PI / 2 : 0,
      scale: 1,
      alpha: 1,
    };
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x + cv.w / 2, t.y + cv.h / 2);
    ctx.rotate(t.rot);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(sprite, -cv.w / 2, -cv.h / 2, cv.w, cv.h);
    ctx.restore();
  }

  private drawStackItem(ctx: CanvasRenderingContext2D, item: StackItemView): void {
    const t: Transform = this.animator.getTransform(item.key) ?? {
      x: item.x,
      y: item.y,
      rot: 0,
      scale: 1,
      alpha: 1,
    };
    const accent = item.controller === this.localPlayer ? UI.hover : UI.arrow;
    const hw = item.w / 2;
    const hh = item.h / 2;

    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x + hw, t.y + hh);
    ctx.scale(t.scale, t.scale);
    if (item.kind === 'spell') {
      ctx.drawImage(this.sprites.get(item.oracleId, true), -hw, -hh, item.w, item.h);
    } else {
      this.drawAbilityToken(ctx, -hw, -hh, item.w, item.h, item.oracleId, accent);
    }
    if (item.top) {
      // Emphasize the object that resolves next.
      ctx.lineWidth = 3;
      ctx.strokeStyle = UI.drop;
      ctx.beginPath();
      ctx.roundRect(-hw - 3, -hh - 3, item.w + 6, item.h + 6, 11);
      ctx.stroke();
    }
    ctx.restore();

    if (item.top) {
      ctx.fillStyle = UI.drop;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText('▶ next', item.x - 50, item.y + 14);
    }
  }

  private drawAbilityToken(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    oracleId: string,
    accent: string,
  ): void {
    ctx.fillStyle = '#161d33';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 9);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(x + 6, y + 8, w - 12, 4);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9edf6';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText('⚡', x + w / 2, y + h * 0.42);
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillText(this.fit(ctx, getDef(oracleId).name, w - 12), x + w / 2, y + h * 0.42 + 16);
    ctx.fillStyle = UI.sub;
    ctx.font = '7px system-ui, sans-serif';
    ctx.fillText('TRIGGERED', x + w / 2, y + h - 12);
    ctx.textAlign = 'left';
  }

  private fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  // --- state-derived arrows (targets & combat) -------------------------------

  private drawArrows(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number): void {
    const state = this.getState();

    // Targeting arrows: every stack object points at each of its targets.
    for (const obj of state.stack) {
      if (obj.targets.length === 0) continue;
      const from = this.itemCenter(lo, obj.cardInstanceId ?? obj.id);
      if (!from) continue;
      const color = obj.controller === this.localPlayer ? UI.hover : UI.arrow;
      for (const ref of obj.targets) {
        const to = this.targetPos(ref, lo, w, h);
        if (to) this.arrow(ctx, from.x, from.y, to.x, to.y, color);
      }
    }

    // Combat arrows: attackers point at the defending player; blockers at the
    // attacker they block.
    const combat = state.combat;
    if (combat) {
      for (const attId of Object.keys(combat.attackers)) {
        const from = this.itemCenter(lo, attId);
        if (from) this.arrow(ctx, from.x, from.y, this.playerAnchor(combat.attackers[attId], w, h).x, this.playerAnchor(combat.attackers[attId], w, h).y, '#ff5470');
      }
      for (const attId of Object.keys(combat.blocks)) {
        for (const bId of combat.blocks[attId]) {
          const from = this.itemCenter(lo, bId);
          const to = this.itemCenter(lo, attId);
          if (from && to) this.arrow(ctx, from.x, from.y, to.x, to.y, '#7fd1ff');
        }
      }
    }
  }

  // Animated center of a card or stack item by key (follows the easing).
  private itemCenter(lo: BoardLayout, key: string): { x: number; y: number } | null {
    const cv = lo.cards.find((c) => c.instanceId === key);
    if (cv) {
      const t = this.animator.getTransform(key);
      return t ? { x: t.x + cv.w / 2, y: t.y + cv.h / 2 } : { x: cv.x + cv.w / 2, y: cv.y + cv.h / 2 };
    }
    const si = lo.stack.find((s) => s.key === key);
    if (si) {
      const t = this.animator.getTransform(key);
      return t ? { x: t.x + si.w / 2, y: t.y + si.h / 2 } : { x: si.x + si.w / 2, y: si.y + si.h / 2 };
    }
    return null;
  }

  private playerAnchor(player: PlayerId, w: number, h: number): { x: number; y: number } {
    return { x: w / 2, y: player === this.localPlayer ? h - 70 : 60 };
  }

  private targetPos(ref: TargetRef, lo: BoardLayout, w: number, h: number): { x: number; y: number } | null {
    return ref.kind === 'player' ? this.playerAnchor(ref.player, w, h) : this.itemCenter(lo, ref.instanceId);
  }

  // A gently bowed arrow with a filled head and a soft dark underlay so it reads
  // over busy art.
  private arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.min(60, Math.hypot(x2 - x1, y2 - y1) * 0.18);
    ctx.save();
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.5)' : color;
      ctx.lineWidth = pass === 0 ? 6 : 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
    }
    // Arrowhead aligned to the curve's incoming tangent (control point → end).
    const a = Math.atan2(y2 - my, x2 - mx);
    const s = 13;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
    ctx.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
