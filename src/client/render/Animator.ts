// The animation layer. Core idea: GameState gives the *target* position for
// every card (via layout); the Animator keeps a *current* visual transform per
// card and, each fixed step, eases current toward target. Because a card keeps
// its key as it moves between rendered zones (hand → stack → battlefield) and as
// it taps, those changes animate for free — no per-event tweens to wire.
//
// Items that LEAVE every rendered zone (a resolved spell going to the graveyard,
// a destroyed creature) are not dropped instantly: they keep a "descriptor" of
// how to draw themselves and fade/shrink out over a few frames before removal.
//
// It also owns short-lived "floating text" effects (damage / lifegain numbers).
//
// `isAnimating()` lets the host keep the relevant layers dirty only while motion
// is in flight, so the render loop idles when the board is at rest.

export interface Transform {
  x: number; // top-left, matches layout
  y: number;
  rot: number; // radians
  scale: number;
  alpha: number;
}

export interface CardTarget {
  x: number;
  y: number;
  rot: number;
}

// Enough to draw an item that has left the layout (during its fade-out).
export interface VisualDesc {
  kind: 'card' | 'ability';
  oracleId: string;
  faceUp: boolean;
  w: number;
  h: number;
  accent: string;
}

interface Entry {
  t: Transform;
  desc: VisualDesc;
  exiting: boolean;
}

export interface ExitingItem {
  key: string;
  t: Transform;
  desc: VisualDesc;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  life: number;
}

const POS_TAU = 70; // ms — position/rotation smoothing time constant (snappy)
const FADE_TAU = 90; // ms — spawn fade/scale-in
const EXIT_TAU = 85; // ms — fade/scale-out for items leaving the board
const SETTLE_POS = 0.4; // px
const SETTLE_ROT = 0.01; // rad

export class Animator {
  private readonly entries = new Map<string, Entry>();
  private readonly fx: FloatingText[] = [];
  private animating = false;

  // Advance all transforms toward `targets`, fade out departed items, and age
  // out effects. `descs` carries how to draw each key (also kept for fade-out).
  update(dt: number, targets: Map<string, CardTarget>, descs: Map<string, VisualDesc>): void {
    let active = false;
    const kPos = 1 - Math.exp(-dt / POS_TAU);
    const kFade = 1 - Math.exp(-dt / FADE_TAU);
    const kExit = 1 - Math.exp(-dt / EXIT_TAU);

    for (const [id, t] of targets) {
      let e = this.entries.get(id);
      if (!e) {
        // New item: spawn at its target, fading + scaling in.
        e = { t: { x: t.x, y: t.y, rot: t.rot, scale: 0.85, alpha: 0 }, desc: descs.get(id)!, exiting: false };
        this.entries.set(id, e);
      }
      e.exiting = false;
      const d = descs.get(id);
      if (d) e.desc = d;

      const c = e.t;
      c.x += (t.x - c.x) * kPos;
      c.y += (t.y - c.y) * kPos;
      c.rot += (t.rot - c.rot) * kPos;
      c.scale += (1 - c.scale) * kFade;
      c.alpha += (1 - c.alpha) * kFade;

      if (Math.abs(t.x - c.x) > SETTLE_POS || Math.abs(t.y - c.y) > SETTLE_POS || Math.abs(t.rot - c.rot) > SETTLE_ROT || c.alpha < 0.99) {
        active = true;
      } else {
        c.x = t.x;
        c.y = t.y;
        c.rot = t.rot;
        c.scale = 1;
        c.alpha = 1;
      }
    }

    // Items no longer in the layout fade out, then are removed.
    for (const [id, e] of this.entries) {
      if (targets.has(id)) continue;
      e.exiting = true;
      const c = e.t;
      c.alpha += (0 - c.alpha) * kExit;
      c.scale += (0.8 - c.scale) * kExit;
      if (c.alpha < 0.04) this.entries.delete(id);
      else active = true;
    }

    for (const f of this.fx) f.age += dt;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      if (this.fx[i].age >= this.fx[i].life) this.fx.splice(i, 1);
    }
    if (this.fx.length > 0) active = true;

    this.animating = active;
  }

  getTransform(id: string): Transform | undefined {
    return this.entries.get(id)?.t;
  }

  exitingItems(): ExitingItem[] {
    const out: ExitingItem[] = [];
    for (const [key, e] of this.entries) if (e.exiting) out.push({ key, t: e.t, desc: e.desc });
    return out;
  }

  spawnFloatingText(x: number, y: number, text: string, color: string): void {
    this.fx.push({ x, y, text, color, age: 0, life: 850 });
    this.animating = true;
  }

  isAnimating(): boolean {
    return this.animating;
  }

  reset(): void {
    this.entries.clear();
    this.fx.length = 0;
    this.animating = false;
  }

  drawFx(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.font = '700 20px system-ui, sans-serif';
    for (const f of this.fx) {
      const p = f.age / f.life;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - p * 30);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
