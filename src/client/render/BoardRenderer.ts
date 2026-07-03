// Draws the board from a rules GameState: region backdrops and every card via
// cached sprites. Pure function of state except for C-14/C-15 effect state:
//   flash(key, color, ms) — colored border overlay for combat results
//   pulse trigger         — stat change badge scale-bump
//   ParticleSystem        — burst/sparkle/shield particles

import { CardSprite } from './CardSprite.js';
import { Animator, type CardTarget, type Transform, type VisualDesc } from './Animator.js';
import { ParticleSystem } from './ParticleSystem.js';
import { UI, CARD } from './theme.js';
import { layout, hexCellRects, type BoardLayout, type CardView, type Rect } from './layout.js';
import { getDef, canPlayId, canAttack } from '../../rules/index.js';
import type { GameState, PlayerId } from '../../rules/index.js';

export interface BoardVisuals {
  targets: Map<string, CardTarget>;
  descs: Map<string, VisualDesc>;
}

// C-14-2: flash entry — colored border drawn over a card for durationMs.
interface FlashEntry { color: string; endMs: number; shake: boolean; }

// C-14-4: stat pulse — scale-up the badge briefly when stats change.
interface StatSnapshot { power: number; wisdom: number; }
interface PulseEntry { startMs: number; durationMs: number; }

// Attack indicator — dashed arrow from attacker's animated position to defender center.
interface AttackIndicator {
  atkKey: string;     // animator key — tracks moving attacker
  atkW: number; atkH: number; // card size to compute center from transform
  defX: number; defY: number; // defender center (fixed, pre-action position)
  startMs: number;
  duration: number;
}

export class BoardRenderer {
  // C-14-2 flash state
  private readonly flashes = new Map<string, FlashEntry>();
  // C-14-4 pulse state
  private readonly pulses    = new Map<string, PulseEntry>();
  private readonly prevStats = new Map<string, StatSnapshot>();
  // C-15 particle effects
  private readonly particles = new ParticleSystem();
  // Attack direction indicators
  private readonly attackIndicators: AttackIndicator[] = [];

  constructor(
    private readonly sprites: CardSprite,
    private readonly getState: () => GameState,
    private readonly localPlayer: PlayerId,
    private readonly animator: Animator,
  ) {}

  // ── C-14-2: trigger a colored border flash on a card key ─────────────────
  flash(key: string, color: string, ms: number, shake = false): void {
    this.flashes.set(key, { color, endMs: performance.now() + ms, shake });
  }

  // ── C-15: particle effect triggers ────────────────────────────────────────
  spawnBurst(cx: number, cy: number, color: string, count?: number): void {
    this.particles.spawnBurst(cx, cy, color, count);
  }
  spawnSparkle(cx: number, cy: number, color?: string): void {
    this.particles.spawnSparkle(cx, cy, color);
  }
  spawnShield(cx: number, cy: number): void {
    this.particles.spawnShield(cx, cy);
  }
  spawnMove(x1: number, y1: number, x2: number, y2: number): void {
    this.particles.spawnMove(x1, y1, x2, y2);
  }
  spawnSlash(cx: number, cy: number, dx: number, dy: number, color?: string): void {
    this.particles.spawnSlash(cx, cy, dx, dy, color);
  }

  // Show attack direction arrow for `duration` ms.
  showAttack(atkKey: string, atkW: number, atkH: number, defX: number, defY: number, duration: number): void {
    this.attackIndicators.push({ atkKey, atkW, atkH, defX, defY, startMs: performance.now(), duration });
  }

  resetEffects(): void {
    this.particles.reset();
    this.flashes.clear();
    this.pulses.clear();
    this.prevStats.clear();
    this.attackIndicators.length = 0;
  }

  // Returns true while any effect needs a repaint.
  hasEffects(now: number): boolean {
    for (const [, f] of this.flashes) if (f.endMs > now) return true;
    for (const [, p] of this.pulses) if (now - p.startMs < p.durationMs) return true;
    if (this.particles.isActive(now)) return true;
    if (this.attackIndicators.some((a) => now - a.startMs < a.duration)) return true;
    return false;
  }

  computeLayout(w: number, h: number): BoardLayout {
    return layout(this.getState(), { width: w, height: h }, this.localPlayer);
  }

  buildVisuals(w: number, h: number): BoardVisuals {
    const lo = this.computeLayout(w, h);
    const targets = new Map<string, CardTarget>();
    const descs = new Map<string, VisualDesc>();
    for (const cv of lo.cards) {
      targets.set(cv.key, { x: cv.x, y: cv.y, rot: 0 });
      descs.set(cv.key, { cardId: cv.cardId, faceUp: cv.faceUp, w: cv.w, h: cv.h });
    }
    return { targets, descs };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const lo = this.computeLayout(w, h);
    const now = performance.now();

    // Expire stale flashes/pulses.
    for (const [k, f] of this.flashes) if (f.endMs <= now) this.flashes.delete(k);
    for (const [k, p] of this.pulses) if (now - p.startMs >= p.durationMs) this.pulses.delete(k);

    // C-14-4: detect stat changes and trigger pulses.
    this.#detectStatChanges(now);

    for (const [name, label] of [
      ['oppHand', '상대 패'], ['oppFrontField', '상대 전열'], ['oppBackField', '상대 후열'],
      ['localFrontField', '내 전열'], ['localBackField', '내 후열'], ['localHand', '내 패'],
    ] as const) {
      this.drawRegion(ctx, lo.regions[name], label);
    }

    const r = lo.regions;
    for (const { frontY, backY } of [
      { frontY: r.oppFrontField.y,   backY: r.oppBackField.y   },
      { frontY: r.localFrontField.y, backY: r.localBackField.y },
    ]) {
      for (const rect of hexCellRects(frontY, backY, w)) {
        this.drawCellSlot(ctx, rect);
      }
    }

    for (const cv of lo.cards) this.drawCard(ctx, cv, now);
    for (const ex of this.animator.exitingItems()) this.drawExiting(ctx, ex.t, ex.desc, now, ex.key);

    // Attack direction arrows (above cards, below particles).
    this.#drawAttackIndicators(ctx, now);

    // C-15: particle effects on top of cards.
    this.particles.draw(ctx, now);
  }

  #drawAttackIndicators(ctx: CanvasRenderingContext2D, now: number): void {
    for (let i = this.attackIndicators.length - 1; i >= 0; i--) {
      const ind = this.attackIndicators[i];
      const elapsed = now - ind.startMs;
      if (elapsed >= ind.duration) { this.attackIndicators.splice(i, 1); continue; }

      const t = this.animator.getTransform(ind.atkKey);
      if (!t) continue;

      // 공격자 현재 애니메이션 위치 중앙 (slam 따라 움직임)
      const ax = t.x + t.ox + ind.atkW / 2;
      const ay = t.y + t.oy + ind.atkH / 2;
      const dx = ind.defX - ax;
      const dy = ind.defY - ay;
      const dist = Math.hypot(dx, dy) || 1;
      const angle = Math.atan2(dy, dx);

      // 라인 끝점 — 수비 카드 테두리 직전까지
      const margin = 22;
      const ex = ind.defX - Math.cos(angle) * margin;
      const ey = ind.defY - Math.sin(angle) * margin;

      // 페이드: 시작 0.15 구간 fade-in, 마지막 0.35 구간 fade-out
      const p = elapsed / ind.duration;
      const alpha = p < 0.15 ? p / 0.15 : p > 0.65 ? 1 - (p - 0.65) / 0.35 : 1;

      ctx.save();
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = '#ffa020';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ffa020';
      ctx.shadowBlur = 10;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 화살촉
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5;
      const headLen = 13;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle - 0.42), ey - headLen * Math.sin(angle - 0.42));
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - headLen * Math.cos(angle + 0.42), ey - headLen * Math.sin(angle + 0.42));
      ctx.stroke();
      ctx.restore();
    }
  }

  #detectStatChanges(now: number): void {
    const state = this.getState();
    for (const [id, unit] of Object.entries(state.units)) {
      const prev = this.prevStats.get(id);
      if (prev && (prev.power !== unit.power || prev.wisdom !== unit.wisdom)) {
        this.pulses.set(id, { startMs: now, durationMs: 500 });
      }
      this.prevStats.set(id, { power: unit.power, wisdom: unit.wisdom });
    }
    // Clean up prevStats for gone units.
    for (const [id] of this.prevStats) {
      if (!state.units[id]) this.prevStats.delete(id);
    }
  }

  private drawCellSlot(ctx: CanvasRenderingContext2D, r: Rect): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 6);
    ctx.stroke();
    ctx.restore();
  }

  private drawExiting(ctx: CanvasRenderingContext2D, t: Transform, desc: VisualDesc, now: number, key: string): void {
    ctx.save();
    ctx.globalAlpha = t.alpha;
    ctx.translate(t.x + t.ox + desc.w / 2, t.y + t.oy + t.arcOy + desc.h / 2);
    ctx.rotate(t.rot);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(this.sprites.get(desc.cardId, desc.faceUp), -desc.w / 2, -desc.h / 2, desc.w, desc.h);
    // Flash on exiting items too (brief red flash before disappearing).
    const fl = this.flashes.get(key);
    if (fl && fl.endMs > now) this.#drawFlashBorder(ctx, desc.w, desc.h, fl.color, (fl.endMs - now) / 400);
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

  private drawCard(ctx: CanvasRenderingContext2D, cv: CardView, now: number): void {
    const dimAlpha = this.#dimAlpha(cv);
    const t = this.animator.getTransform(cv.key);

    // C-14-2: shake offset for loser flash
    const fl = this.flashes.get(cv.key);
    const shakeX = fl?.shake ? Math.sin(now * 0.05) * 3 * Math.min(1, (fl.endMs - now) / 200) : 0;

    if (t) {
      ctx.save();
      ctx.globalAlpha = t.alpha * dimAlpha;
      ctx.translate(t.x + t.ox + shakeX + cv.w / 2, t.y + t.oy + t.arcOy + cv.h / 2);
      ctx.rotate(t.rot);
      const s = t.scale + t.spawnScale;
      ctx.scale(s, s);
      ctx.drawImage(this.sprites.get(cv.cardId, cv.faceUp), -cv.w / 2, -cv.h / 2, cv.w, cv.h);
      if (cv.zone === 'field' && cv.faceUp && cv.instanceId) {
        this.drawStatOverlay(ctx, cv, -cv.w / 2, -cv.h / 2, now);
      }
      if (fl && fl.endMs > now) this.#drawFlashBorder(ctx, cv.w, cv.h, fl.color, (fl.endMs - now) / 400);
      if (cv.locked) this.#drawLockIcon(ctx, cv.w / 2 - 14, -cv.h / 2 + 14);
      ctx.restore();
    } else {
      const sx = cv.x + shakeX;
      ctx.save();
      ctx.globalAlpha = dimAlpha;
      ctx.drawImage(this.sprites.get(cv.cardId, cv.faceUp), sx, cv.y, cv.w, cv.h);
      if (cv.zone === 'field' && cv.faceUp && cv.instanceId) {
        this.drawStatOverlay(ctx, cv, sx, cv.y, now);
      }
      if (fl && fl.endMs > now) {
        ctx.save();
        ctx.translate(sx + cv.w / 2, cv.y + cv.h / 2);
        this.#drawFlashBorder(ctx, cv.w, cv.h, fl.color, (fl.endMs - now) / 400);
        ctx.restore();
      }
      if (cv.locked) this.#drawLockIcon(ctx, sx + cv.w - 14, cv.y + 14);
      ctx.restore();
    }
  }

  // C-14-2: draw a colored glow border around a card (centered at 0,0).
  #drawFlashBorder(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    color: string,
    alpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, CARD.radius + 1);
    ctx.stroke();
    ctx.restore();
  }

  #dimAlpha(cv: CardView): number {
    const state = this.getState();
    const local = this.localPlayer;
    if (cv.controller !== local) return 1;
    if (state.phase === 'opening') {
      if (state.openingDone[local]) return 1;
      if (cv.zone === 'hand' && !canPlayId(state, cv.cardId, local).ok) return 0.45;
      return 1;
    }
    if (state.phase !== 'main' || state.active !== local) return 1;
    if (cv.zone === 'hand') {
      if (cv.locked) return 0.4;
      if (!canPlayId(state, cv.cardId, local).ok) return 0.45;
    }
    if (cv.zone === 'field' && cv.faceUp && cv.instanceId) {
      if (!canAttack(state, cv.instanceId)) return 0.45;
    }
    return 1;
  }

  #drawLockIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const r = 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.stroke();
    // shackle
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -2, 5, Math.PI, 0);
    ctx.stroke();
    // body
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(-6, -1, 12, 9);
    // keyhole
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.arc(0, 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawStatOverlay(
    ctx: CanvasRenderingContext2D,
    cv: CardView,
    ox: number,
    oy: number,
    now: number,
  ): void {
    const state = this.getState();
    const unit = state.units[cv.instanceId!];
    if (!unit) return;
    const meta = getDef(unit.cardId);
    if (meta.kind !== 'unit') return;

    const curPow = unit.power;
    const curWis = unit.wisdom;
    const basePow = meta.power ?? 0;
    const baseWis = meta.wisdom ?? 0;
    const powChanged = curPow !== basePow;
    const wisChanged = curWis !== baseWis;
    if (!powChanged && !wisChanged) return;

    // C-14-4: pulse scale when stats just changed
    const pulse = this.pulses.get(cv.instanceId!);
    let badgeScale = 1;
    if (pulse) {
      const t = (now - pulse.startMs) / pulse.durationMs;
      // quick scale-up then spring back: peak at t=0.2
      badgeScale = 1 + 0.35 * Math.sin(Math.PI * Math.min(t * 5, 1));
    }

    const bw = 38, bh = 16;
    const bx = ox + cv.w - 44;
    const by = oy + cv.h - 22;

    ctx.save();
    if (badgeScale !== 1) {
      ctx.translate(bx + bw / 2, by + bh / 2);
      ctx.scale(badgeScale, badgeScale);
      ctx.translate(-(bx + bw / 2), -(by + bh / 2));
    }

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 4);
    ctx.fill();

    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = powChanged ? (curPow > basePow ? '#5be0a0' : '#ff7060') : '#fff';
    ctx.fillText(`힘${curPow}`, bx + 10, by + 9);
    ctx.fillStyle = wisChanged ? (curWis > baseWis ? '#5be0a0' : '#ff7060') : '#fff';
    ctx.fillText(`지${curWis}`, bx + 29, by + 9);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}
