// The animation layer. Core idea: GameState gives the *target* position for
// every card (via layout); the Animator keeps a *current* visual transform per
// card, keyed by the layout `key`, and eases current toward target each fixed
// step. A key that stays put while its slot moves animates for free.
//
// Extensions:
//   lunge(key, ox, oy)        — one-shot offset toward target (attack lunge)
//   setSpawnOrigin(key, x, y) — override initial spawn position (hand→field arc)
//   arcLunge(key, oy)         — parabolic arc lift applied on top of spawn travel
//   Spawn bounce              — scale spike when card first reaches field (~alpha 0.75)
//   Death tumble              — exiting cards spin randomly as they fade out

export interface Transform {
  x: number;
  y: number;
  rot: number;
  scale: number;
  alpha: number;
  ox: number;        // lunge offset x (decays to 0)
  oy: number;        // lunge offset y (decays to 0)
  arcOy: number;     // arc lift offset (slower decay — for play/spawn arcs)
  spawnScale: number; // extra scale for landing bounce (decays to 0)
}

export interface CardTarget {
  x: number;
  y: number;
  rot: number;
}

// Enough to draw an item that has left the layout (during its fade-out).
export interface VisualDesc {
  cardId: string;
  faceUp: boolean;
  w: number;
  h: number;
}

// Body-slam: rush to (toX, toY) quickly, then spring back via normal easing.
interface SlamState {
  toX: number;
  toY: number;
  endMs: number; // rush finishes at this timestamp
}

interface Entry {
  t: Transform;
  desc: VisualDesc;
  exiting: boolean;
  spawnPeaked: boolean;  // whether spawn bounce has fired
  deathRotRate: number;  // rotation rate (rad/s) while exiting
  slam?: SlamState;
}

export interface ExitingItem {
  key: string;
  t: Transform;
  desc: VisualDesc;
}

const SLAM_TAU   = 40;   // ms — body-slam rush (very fast toward target)
const POS_TAU    = 70;   // ms — position/rotation easing
const FADE_TAU   = 90;   // ms — spawn fade/scale-in
const EXIT_TAU   = 85;   // ms — fade/scale-out for departing items
const LUNGE_TAU  = 130;  // ms — lunge offset decay
const ARC_TAU    = 260;  // ms — arc lift decay (slower for parabolic feel)
const BOUNCE_TAU = 120;  // ms — spawn scale bounce decay
const SETTLE_POS = 0.4;  // px
const SETTLE_ROT = 0.01; // rad
const SETTLE_OFF = 0.3;  // px — lunge/arc settle threshold

export class Animator {
  private readonly entries = new Map<string, Entry>();
  private animating = false;

  private readonly pendingLunges      = new Map<string, { ox: number; oy: number }>();
  private readonly pendingSpawnOrigins = new Map<string, { x: number; y: number }>();
  private readonly pendingArcLunges   = new Map<string, number>(); // key → oy
  private readonly pendingSlams       = new Map<string, { toX: number; toY: number; duration: number }>();

  update(dt: number, targets: Map<string, CardTarget>, descs: Map<string, VisualDesc>): void {
    let active = false;
    const now     = performance.now();
    const kSlam   = 1 - Math.exp(-dt / SLAM_TAU);
    const kPos    = 1 - Math.exp(-dt / POS_TAU);
    const kFade   = 1 - Math.exp(-dt / FADE_TAU);
    const kExit   = 1 - Math.exp(-dt / EXIT_TAU);
    const kLunge  = 1 - Math.exp(-dt / LUNGE_TAU);
    const kArc    = 1 - Math.exp(-dt / ARC_TAU);
    const kBounce = 1 - Math.exp(-dt / BOUNCE_TAU);

    for (const [id, tgt] of targets) {
      let e = this.entries.get(id);
      if (!e) {
        const spawn = this.pendingSpawnOrigins.get(id);
        this.pendingSpawnOrigins.delete(id);
        const sx = spawn?.x ?? tgt.x;
        const sy = spawn?.y ?? tgt.y;
        e = {
          t: { x: sx, y: sy, rot: tgt.rot, scale: 0.85, alpha: 0, ox: 0, oy: 0, arcOy: 0, spawnScale: 0 },
          desc: descs.get(id)!,
          exiting: false,
          spawnPeaked: false,
          deathRotRate: 0,
        };
        this.entries.set(id, e);
      }
      e.exiting = false;
      const d = descs.get(id);
      if (d) e.desc = d;

      // Apply pending lunge.
      const pl = this.pendingLunges.get(id);
      if (pl) { e.t.ox = pl.ox; e.t.oy = pl.oy; this.pendingLunges.delete(id); }

      // Apply pending arc lunge.
      const pal = this.pendingArcLunges.get(id);
      if (pal !== undefined) { e.t.arcOy = pal; this.pendingArcLunges.delete(id); }

      // Apply pending slam.
      const ps = this.pendingSlams.get(id);
      if (ps) {
        e.slam = { toX: ps.toX, toY: ps.toY, endMs: now + ps.duration };
        this.pendingSlams.delete(id);
      }

      const c = e.t;

      // Body-slam: rush phase — override position easing toward slam target.
      if (e.slam) {
        if (now < e.slam.endMs) {
          c.x += (e.slam.toX - c.x) * kSlam;
          c.y += (e.slam.toY - c.y) * kSlam;
        } else {
          e.slam = undefined; // rush done; normal easing below springs back
        }
        active = true;
      }

      if (!e.slam) {
        c.x += (tgt.x - c.x) * kPos;
        c.y += (tgt.y - c.y) * kPos;
      }
      c.rot += (tgt.rot - c.rot) * kPos;
      c.scale += (1 - c.scale) * kFade;
      c.alpha += (1 - c.alpha) * kFade;

      // Decay lunge offset.
      c.ox += (0 - c.ox) * kLunge;
      c.oy += (0 - c.oy) * kLunge;
      if (Math.abs(c.ox) < SETTLE_OFF) c.ox = 0;
      if (Math.abs(c.oy) < SETTLE_OFF) c.oy = 0;

      // Decay arc lift.
      c.arcOy += (0 - c.arcOy) * kArc;
      if (Math.abs(c.arcOy) < SETTLE_OFF) c.arcOy = 0;

      // Spawn bounce: fire once when alpha passes 0.75 (card has "arrived").
      if (!e.spawnPeaked && c.alpha > 0.75) {
        e.spawnPeaked = true;
        c.spawnScale = 0.22;
      }
      c.spawnScale += (0 - c.spawnScale) * kBounce;
      if (c.spawnScale < 0.005) c.spawnScale = 0;

      const settled =
        Math.abs(tgt.x - c.x) <= SETTLE_POS &&
        Math.abs(tgt.y - c.y) <= SETTLE_POS &&
        Math.abs(tgt.rot - c.rot) <= SETTLE_ROT &&
        c.alpha >= 0.99 &&
        c.ox === 0 && c.oy === 0 &&
        c.arcOy === 0 && c.spawnScale === 0;
      if (settled) {
        c.x = tgt.x; c.y = tgt.y; c.rot = tgt.rot; c.scale = 1; c.alpha = 1;
        c.ox = 0; c.oy = 0; c.arcOy = 0; c.spawnScale = 0;
      } else {
        active = true;
      }
    }

    // Items no longer in the layout: fade + tumble out, then remove.
    for (const [id, e] of this.entries) {
      if (targets.has(id)) continue;
      e.exiting = true;
      const c = e.t;

      // Apply pending slam even for exiting entries (dead units must reach target first).
      const ps = this.pendingSlams.get(id);
      if (ps) {
        e.slam = { toX: ps.toX, toY: ps.toY, endMs: now + ps.duration };
        this.pendingSlams.delete(id);
      }

      // If a slam is still in progress, finish the rush before dying.
      if (e.slam) {
        if (now < e.slam.endMs) {
          c.x += (e.slam.toX - c.x) * kSlam;
          c.y += (e.slam.toY - c.y) * kSlam;
          active = true;
          continue; // hold off on fade until impact is reached
        }
        e.slam = undefined;
      }

      // Assign spin direction once when card first starts death fade.
      if (e.deathRotRate === 0) {
        e.deathRotRate = (Math.random() > 0.5 ? 1 : -1) *
          (Math.PI * 0.6 + Math.random() * Math.PI * 0.5); // 108°–198°/s
      }
      c.alpha += (0 - c.alpha) * kExit;
      c.scale += (0.75 - c.scale) * kExit;
      c.rot   += e.deathRotRate * (dt / 1000);
      if (c.alpha < 0.04) this.entries.delete(id);
      else active = true;
    }

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

  isAnimating(): boolean { return this.animating; }

  reset(): void {
    this.entries.clear();
    this.pendingLunges.clear();
    this.pendingSpawnOrigins.clear();
    this.pendingArcLunges.clear();
    this.pendingSlams.clear();
    this.animating = false;
  }

  // Kick a card toward (ox, oy) offset then let it spring back (attack lunge, recoil).
  lunge(key: string, ox: number, oy: number): void {
    this.pendingLunges.set(key, { ox, oy });
  }

  // Make a new key start from (x, y) rather than its layout target (spawn origin).
  setSpawnOrigin(key: string, x: number, y: number): void {
    this.pendingSpawnOrigins.set(key, { x, y });
  }

  // Apply an upward arc lift to a key (applied on next update tick).
  // Negative oy = upward in screen coords. Decays slowly for a parabolic feel.
  arcLunge(key: string, oy: number): void {
    this.pendingArcLunges.set(key, oy);
  }

  // Body-slam: rush the card to (toX, toY) over `duration` ms, then spring back
  // to its layout target via normal easing.
  slam(key: string, toX: number, toY: number, duration = 180): void {
    this.pendingSlams.set(key, { toX, toY, duration });
  }
}
