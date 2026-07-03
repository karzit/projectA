// C-15: particle + ring effect system for combat and card-play visuals.
// Drawn on the board canvas layer after cards.

interface Particle {
  x: number; y: number;
  vx: number; vy: number; // px/s
  r: number;
  alpha: number;
  color: string;
  born: number;
  life: number; // ms
  gravity: boolean;
}

interface Ring {
  cx: number; cy: number;
  r0: number; r1: number;
  color: string;
  lineWidth: number;
  born: number;
  life: number;
}

const G = 180; // gravity px/s²

export class ParticleSystem {
  private particles: Particle[] = [];
  private rings: Ring[] = [];

  isActive(now: number): boolean {
    return this.particles.some((p) => now - p.born < p.life) ||
           this.rings.some((r) => now - r.born < r.life);
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    this.rings     = this.rings.filter((r) => now - r.born < r.life);

    for (const p of this.particles) {
      const t  = (now - p.born) / p.life;
      const ts = t * p.life / 1000;           // seconds elapsed
      const x  = p.x + p.vx * ts;
      const y  = p.y + p.vy * ts + (p.gravity ? 0.5 * G * ts * ts : 0);
      const a  = p.alpha * (1 - t * t);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, p.r * (1 - t * 0.4)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const r of this.rings) {
      const t = (now - r.born) / r.life;
      if (t < 0) continue; // born: now + delay 링은 아직 시작 전 — 그리지 않는다
      const radius = Math.max(0, r.r0 + (r.r1 - r.r0) * t);
      const a      = (1 - t) * 0.85;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = r.color;
      ctx.lineWidth   = r.lineWidth;
      ctx.beginPath();
      ctx.arc(r.cx, r.cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Impact burst — attack hit / unit death.
  spawnBurst(cx: number, cy: number, color: string, count = 12): void {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 70 + Math.random() * 90;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        r: 2 + Math.random() * 2.5,
        alpha: 0.95, color,
        born: now, life: 380 + Math.random() * 180,
        gravity: true,
      });
    }
    this.rings.push({ cx, cy, r0: 8, r1: 52, color, lineWidth: 2, born: now, life: 320 });
  }

  // Sparkle — card play / attacker victory.
  spawnSparkle(cx: number, cy: number, color = '#ffd060'): void {
    const now = performance.now();
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10;
      const speed = 40 + Math.random() * 50;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1.8 + Math.random() * 1.5,
        alpha: 1, color,
        born: now + Math.random() * 40, life: 500,
        gravity: false,
      });
    }
    this.rings.push({ cx, cy, r0: 4,  r1: 38, color,               lineWidth: 1.5, born: now,      life: 380 });
    this.rings.push({ cx, cy, r0: 0,  r1: 22, color: 'rgba(255,255,200,0.5)', lineWidth: 3,   born: now,      life: 260 });
  }

  // Movement trail — particles along path from (x1,y1) to (x2,y2) + arrival ring.
  spawnMove(x1: number, y1: number, x2: number, y2: number): void {
    const now = performance.now();
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      this.particles.push({
        x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * 10,
        y: y1 + (y2 - y1) * t + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 35,
        vy: (Math.random() - 0.5) * 35,
        r: 1.8 + Math.random() * 1.5,
        alpha: 0.75, color: '#60d4ff',
        born: now + t * 90, life: 280 + Math.random() * 120,
        gravity: false,
      });
    }
    this.rings.push({ cx: x2, cy: y2, r0: 6, r1: 38, color: '#60d4ff', lineWidth: 1.5, born: now + 90, life: 300 });
  }

  // Directional hit slash — particles fly from (cx,cy) in the attack direction (dx,dy).
  spawnSlash(cx: number, cy: number, dx: number, dy: number, color = '#ffe060'): void {
    const now = performance.now();
    const angle = Math.atan2(dy, dx);
    const spread = Math.PI * 0.55;
    for (let i = 0; i < 8; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const speed = 90 + Math.random() * 80;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 1.8 + Math.random() * 2,
        alpha: 0.95, color,
        born: now, life: 300 + Math.random() * 150,
        gravity: false,
      });
    }
    this.rings.push({ cx, cy, r0: 4, r1: 30, color, lineWidth: 1.5, born: now, life: 250 });
  }

  // Shield ring — cooperative defense participation.
  spawnShield(cx: number, cy: number): void {
    const now = performance.now();
    const c1 = '#60c8ff';
    const c2 = 'rgba(96,200,255,0.35)';
    this.rings.push({ cx, cy, r0: 18, r1: 46, color: c1, lineWidth: 2,   born: now,      life: 480 });
    this.rings.push({ cx, cy, r0: 12, r1: 40, color: c2, lineWidth: 4,   born: now + 60, life: 420 });
    // Small sparkle particles in blue
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * 45,
        vy: Math.sin(angle) * 45,
        r: 2, alpha: 0.9, color: c1,
        born: now, life: 400,
        gravity: false,
      });
    }
  }

  reset(): void {
    this.particles = [];
    this.rings     = [];
  }
}
