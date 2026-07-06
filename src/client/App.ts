// Composition root. Wires managers + renderer + interaction + DOM UI to the
// rules engine. The ONLY place that knows about all the pieces; they communicate
// through the EventManager bus.
//
// One-way data flow:
//   input → EventManager(intent) → App.applyIntent → game.apply(action)
//        → state:changed (HUD update) + markDirty (renderer)

import { CanvasManager, EventManager, ResourceManager } from './core/index.js';
import type { ResourceManifest } from './core/index.js';
import { BoardRenderer } from './render/BoardRenderer.js';
import { CardSprite } from './render/CardSprite.js';
import { Animator } from './render/Animator.js';
import { InteractionLayer } from './input/InteractionLayer.js';
import { UIRoot } from './ui/UIRoot.js';
import { UI } from './render/theme.js';
import { deckById } from './decks.js';
import { Game, getDef, otherPlayer, DESOLATION_START_TURN } from '../rules/index.js';
import type { RulesAction, GameState, PlayerId } from '../rules/index.js';
import { SimAI } from './SimAI.js';
import { BannerSystem } from './render/BannerSystem.js';

const LAYERS = ['background', 'board', 'overlay'] as const;

export interface AppOptions {
  container: HTMLElement;
  manifest?: ResourceManifest;
  seed?: number;
  localPlayer?: PlayerId;
}

export class App {
  readonly events = new EventManager();
  readonly resources: ResourceManager;
  readonly canvas: CanvasManager;
  readonly ui: UIRoot;

  private readonly sprites = new CardSprite();
  private readonly animator = new Animator();
  private readonly banner = new BannerSystem();
  private readonly local: PlayerId;
  private game: Game | null = null;
  private readonly board: BoardRenderer;
  private readonly interaction: InteractionLayer;
  private matchActive = false;
  private screen: 'lobby' | 'solo-pick' | 'game' | 'deck' | 'settings' = 'lobby';
  private ai: SimAI | null = null;
  // Opponent opening logs buffered until main phase reveals them
  #oppOpeningBuf: Array<{ text: string; cls?: string }> = [];
  // attack이 협공 반응 창을 여는 동안 attacker/target/공격자를 기억해 둔다(resolveAttack
  // 처리 시 연출/로그에 필요 — resolveAttack 액션 자체에는 attackerId/targetId가 없다).
  #pendingAttackAnim: { attackerId: string; targetId: string; attacker: PlayerId } | null = null;
  // react 액션 자체엔 cardId가 없으므로 reactionRequest가 뜬 시점의 카드/주인을 기억해 둔다.
  #pendingReactionAnim: { cardId: string; controller: PlayerId } | null = null;
  // AI 액션이 거부됐을 때 재시도 횟수 — SimAI가 매번 같은(여전히 불법인) 액션을
  // 결정론적으로 다시 고르면 무한 setTimeout 재시도로 조용히 멈춰버릴 수 있다.
  // 일정 횟수 이후엔 강제로 pass시켜 게임이 실제로 멈추는 일은 없게 한다.
  #aiRetryCount = 0;
  static readonly #AI_RETRY_LIMIT = 5;

  constructor(private readonly opts: AppOptions) {
    this.local = opts.localPlayer ?? 'A';
    this.resources = new ResourceManager(this.events.bus);
    this.canvas = new CanvasManager(opts.container, { layers: [...LAYERS], bus: this.events.bus });

    this.ui = new UIRoot(opts.container, {
      events: this.events,
      getState: () => this.game!.state,
      local: this.local,
    });

    this.board = new BoardRenderer(this.sprites, () => this.game!.state, this.local, this.animator);
    this.interaction = new InteractionLayer({
      events: this.events,
      getState: () => this.game!.state,
      getViewport: () => ({ width: this.canvas.width, height: this.canvas.height }),
      sprites: this.sprites,
      localPlayer: this.local,
      onChange: () => this.canvas.markDirty('overlay'),
      container: opts.container,
    });

    this.events.on('intent', (action) => this.applyIntent(action as RulesAction));
    this.events.on('viewport:resize', () => this.canvas.markAllDirty());
    this.events.on('error', (e) => console.warn('거부된 액션:', e.message));
    this.events.on('ui:menu', () => this.openInGameMenu());

    this.installRenderers();
    this.interaction.attach();
    this.events.attachInput(this.canvas.inputSurface);
  }

  async start(): Promise<void> {
    this.ui.overlay.showLoading();
    await this.resources.loadAll(this.opts.manifest ?? {});

    this.showLobby();
  }

  private showLobby(): void {
    this.screen = 'lobby';
    this.matchActive = false;
    this.ai?.destroy();
    this.ai = null;
    this.game = null;
    this.canvas.stop();
    this.ui.overlay.showLobby({
      onSolo: () => this.showSoloPick(),
      onDeck: () => this.showDeckEditor(),
      onSettings: () => this.showStub('settings'),
    });
  }

  private showSoloPick(): void {
    this.screen = 'solo-pick';
    this.ui.overlay.showSoloPick(
      (myDeckId, oppDeckId) => this.startMatch(myDeckId, oppDeckId),
      () => this.showLobby(),
    );
  }

  private showDeckEditor(): void {
    this.screen = 'deck';
    this.ui.overlay.showDeckEditor(() => this.showLobby());
  }

  private openInGameMenu(): void {
    if (!this.matchActive) return;
    this.ui.overlay.showInGameMenu(
      () => {
        this.ui.overlay.hide();
      },
      () => {
        this.matchActive = false;
        this.ai?.destroy();
        this.ui.overlay.showGameOver('항복했습니다', () => this.showLobby());
      },
    );
  }

  private showStub(screen: 'settings'): void {
    this.screen = screen;
    this.ui.overlay.showStub('환경설정', () => this.showLobby());
  }

  private startMatch(myDeckId: string, oppDeckId: string): void {
    const opp: PlayerId = this.local === 'A' ? 'B' : 'A';
    const decks = {
      [this.local]: deckById(myDeckId).cards,
      [opp]: deckById(oppDeckId).cards,
    } as Record<PlayerId, string[]>;
    this.game = new Game({ decks, seed: this.opts.seed });
    this.matchActive = true;
    this.screen = 'game';
    this.#oppOpeningBuf = [];
    this.ai = new SimAI(opp, this.events, () => this.game!.state);
    this.animator.reset();
    this.board.resetEffects();
    this.ui.log.clear();
    this.ui.overlay.hide();
    this.canvas.start((dt) => {
      const { targets, descs } = this.board.buildVisuals(this.canvas.width, this.canvas.height);
      this.animator.update(dt, targets, descs);
      const now = performance.now();
      if (this.animator.isAnimating() || this.board.hasEffects(now)) this.canvas.markDirty('board');
      if (this.banner.isActive(now)) this.canvas.markDirty('overlay');
    });
    this.canvas.markAllDirty();
    this.events.emit('state:changed', { state: this.game!.state });
    this.ai.react(); // kick off opening AI
  }

  // AI-as-defender: 지략 opt-in 반응 — 봉쇄 가능하면 항상 봉쇄한다(상대 카드를 이번 턴
  // 지연시키는 이득이 지략 1회 소진 비용보다 대체로 크다는 단순 휴리스틱).
  #aiPickCunningBlock(eligibleBlockers: string[]): string | undefined {
    return eligibleBlockers[0];
  }

  // AI-as-defender: pick blockers that would repel the attacker (combined DP >= AP).
  #aiPickBlockers(attackerId: string, targetId: string, blockable: string[]): string[] {
    const state = this.game!.state;
    const attacker = state.units[attackerId];
    const target   = state.units[targetId];
    if (!attacker || !target || blockable.length === 0) return [];
    const ap = attacker.power;
    const dp = target.power;
    // Greedily add blockers until combined power >= attacker power (or none left).
    // Sort by power desc so we use the fewest units.
    const sorted = [...blockable].sort((a, b) => (state.units[b]?.power ?? 0) - (state.units[a]?.power ?? 0));
    let combined = dp;
    const chosen: string[] = [];
    for (const id of sorted) {
      if (combined >= ap) break;
      combined += state.units[id]?.power ?? 0;
      chosen.push(id);
    }
    return combined >= ap ? chosen : [];
  }

  private applyIntent(action: RulesAction): void {
    if (!this.matchActive || !this.game) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Pre-action snapshots — game.apply mutates state in-place so capture now.
    const preLo = this.board.computeLayout(w, h);
    const preUnitIds = new Set(Object.keys(this.game.state.units));
    const preUnitStats = new Map(
      Object.entries(this.game.state.units).map(([id, u]) => [id, { power: u.power, wisdom: u.wisdom }]),
    );

    const centerOf = (id: string) => {
      const cv = preLo.cards.find((c) => c.instanceId === id);
      return cv ? { x: cv.x + cv.w / 2, y: cv.y + cv.h / 2 } : null;
    };

    // 전투 연출 대상 — attack은 액션 자체에서, resolveAttack은 선언 시 기록해 둔
    // _pendingAttackAnim에서 가져온다(resolveAttack 액션 자체엔 attacker/target이 없다).
    const combatIds = action.type === 'attack'
      ? { attackerId: action.attackerId, targetId: action.targetId }
      : action.type === 'resolveAttack' && this.#pendingAttackAnim
        ? { attackerId: this.#pendingAttackAnim.attackerId, targetId: this.#pendingAttackAnim.targetId }
        : null;

    // Capture attacker/defender centers before apply — needed for slam target.
    let slamTarget: { toX: number; toY: number } | null = null;
    if (combatIds) {
      const atkView = preLo.cards.find((c) => c.instanceId === combatIds.attackerId);
      const defView = preLo.cards.find((c) => c.instanceId === combatIds.targetId);
      if (atkView && defView) {
        slamTarget = {
          toX: defView.x + defView.w / 2,
          toY: defView.y + defView.h / 2,
        };
      }
    }

    // Capture hand slot center before play / opening placement.
    let handOrigin: { x: number; y: number; cardId: string } | null = null;
    if (action.type === 'play' || action.type === 'placeOpening') {
      const hv = preLo.cards.find(
        (c) => c.zone === 'hand' && c.controller === action.player && c.cardId === action.cardId,
      );
      if (hv) handOrigin = { x: hv.x + hv.w / 2, y: hv.y + hv.h / 2, cardId: action.cardId };
    }

    // Capture moving unit center before move.
    let moveOrigin: { x: number; y: number } | null = null;
    if (action.type === 'move') {
      const mv = preLo.cards.find((c) => c.instanceId === action.unitId);
      if (mv) moveOrigin = { x: mv.x + mv.w / 2, y: mv.y + mv.h / 2 };
    }

    const result = this.game.apply(action);
    if (result.error) {
      this.events.emit('error', { message: result.error });
      if ('player' in action && (action as { player: string }).player === this.local) {
        this.ui.showToast(result.error);
      } else if (++this.#aiRetryCount <= App.#AI_RETRY_LIMIT) {
        // AI 액션 실패 시 재시도. SimAI가 상태 불변 상황에서 매번 같은(불법인)
        // 액션을 결정론적으로 다시 고르면 pass에 절대 도달하지 못하고 조용히
        // 무한 재시도할 수 있다 — 그럴 땐 게임이 아무 반응 없이 멈춘 것처럼 보인다.
        this.ai?.react();
      } else {
        console.error('AI 액션이 반복 거부되어 강제로 패스합니다:', result.error);
        this.#aiRetryCount = 0;
        this.applyIntent({ type: 'pass', player: otherPlayer(this.local) });
      }
      return;
    }
    this.#aiRetryCount = 0;
    if (result.choiceRequest) {
      const need = result.choiceRequest;
      this.ui.log.push(`${this.cardName(need.cardId)}: 대상 선택 (${need.min}~${need.max})`, 'k-step');
      this.events.emit('choice:request', { request: need, action });
      if (need.player === this.local) this.canvas.markDirty('overlay');
      return;
    }
    if (result.reactionRequest) {
      // wisdom-gated 카드가 봉쇄 가능한 지략 유닛을 만났다 — 수비측의 react 반응을 기다린다.
      const req = result.reactionRequest;
      this.#pendingReactionAnim = { cardId: req.cardId, controller: req.controller };
      if (req.player === this.local) {
        this.interaction.beginCunningReaction(req);
        this.canvas.markDirty('overlay');
      } else {
        const blockerId = this.#aiPickCunningBlock(req.eligibleBlockers);
        this.applyIntent({ type: 'react', player: req.player, block: !!blockerId, blockerId });
      }
      return;
    }
    if (result.attackReactionRequest) {
      // 공격이 협공 가능한 수비를 만났다 — 수비측의 resolveAttack 반응을 기다린다.
      const req = result.attackReactionRequest;
      this.#pendingAttackAnim = { attackerId: req.attackerId, targetId: req.targetId, attacker: action.player };
      if (req.player === this.local) {
        this.interaction.beginBlockerSelection(req.attackerId, req.targetId, req.blockable);
        this.canvas.markDirty('overlay');
      } else {
        const blockerIds = this.#aiPickBlockers(req.attackerId, req.targetId, req.blockable);
        this.applyIntent({ type: 'resolveAttack', player: req.player, blockerIds });
      }
      return;
    }
    this.logAction(action, result.state);

    // ── 공격 이펙트 ──────────────────────────────────────────────────────────
    if (combatIds) {
      const { attackerId, targetId } = combatIds;
      const blockerIds = action.type === 'resolveAttack' ? action.blockerIds : [];
      this.#pendingAttackAnim = null;

      const atkDead = !result.state.units[attackerId];
      const defDead = !result.state.units[targetId];
      const atkPos  = centerOf(attackerId);
      const defPos  = centerOf(targetId);

      // 몸통박치기: 공격 카드가 수비 카드 위치로 돌진 후 복귀
      const SLAM_MS = 170;
      if (slamTarget) {
        this.animator.slam(attackerId, slamTarget.toX, slamTarget.toY, SLAM_MS);
      }

      // 공격자 표시: 오렌지 글로우 + 방향 화살표 (즉시)
      this.board.flash(attackerId, '#ff9020', SLAM_MS + 80);
      if (atkPos && defPos) {
        const atkCard = preLo.cards.find((c) => c.instanceId === attackerId);
        if (atkCard) {
          this.board.showAttack(
            attackerId, atkCard.w, atkCard.h,
            defPos.x, defPos.y,
            SLAM_MS + 160,
          );
        }
      }

      // 협공 방어 참여 유닛 방패 이펙트 (즉시)
      for (const bid of blockerIds) {
        const bp = centerOf(bid);
        if (bp) this.board.spawnShield(bp.x, bp.y);
      }

      // 충돌 이펙트 — slam이 도달한 후(SLAM_MS) 발동
      const _atkId  = attackerId;
      const _defId  = targetId;
      const _atkPos = atkPos;
      const _defPos = defPos;
      setTimeout(() => {
        if (!this.matchActive) return;

        // flash
        if (atkDead) this.board.flash(_atkId, '#ff5050', 420, true);
        if (defDead) this.board.flash(_defId, '#ff5050', 420, true);
        if (!atkDead && defDead) this.board.flash(_atkId, '#80ffb0', 320);

        // 충돌 파티클
        if (_defPos) this.board.spawnBurst(_defPos.x, _defPos.y, defDead ? '#ff5050' : '#ff9040');
        if (atkDead && _atkPos) this.board.spawnBurst(_atkPos.x, _atkPos.y, '#ff5050');
        if (!atkDead && defDead && _atkPos) this.board.spawnSparkle(_atkPos.x, _atkPos.y, '#80ffb0');

        // 방향성 슬래시
        if (_atkPos && _defPos) {
          const dx = _defPos.x - _atkPos.x;
          const dy = _defPos.y - _atkPos.y;
          this.board.spawnSlash(_defPos.x, _defPos.y, dx, dy, defDead ? '#ff8040' : '#ffd060');
          // 생존 수비 카드 피격 반동
          if (!defDead) {
            const dist = Math.hypot(dx, dy) || 1;
            this.animator.lunge(_defId, (dx / dist) * 22, (dy / dist) * 22);
          }
        }
        this.canvas.markDirty('board');
      }, SLAM_MS);
    }

    // ── 이동 이펙트 ──────────────────────────────────────────────────────────
    if (action.type === 'move' && moveOrigin) {
      const postLo = this.board.computeLayout(w, h);
      const destCard = postLo.cards.find((c) => c.instanceId === action.unitId);
      if (destCard) {
        const destX = destCard.x + destCard.w / 2;
        const destY = destCard.y + destCard.h / 2;
        this.board.spawnMove(moveOrigin.x, moveOrigin.y, destX, destY);
        // 이동 방향 반대로 lunge — 새 위치에서 스프링하듯 안착
        const dx = destX - moveOrigin.x;
        const dy = destY - moveOrigin.y;
        const dist = Math.hypot(dx, dy) || 1;
        const mag = Math.min(dist * 0.35, 25);
        this.animator.lunge(action.unitId, -(dx / dist) * mag, -(dy / dist) * mag);
      }
    }

    // ── 카드 플레이 이펙트 (play / placeOpening) ─────────────────────────────
    if ((action.type === 'play' || action.type === 'placeOpening') && handOrigin) {
      const newId = Object.keys(result.state.units).find((id) => !preUnitIds.has(id));
      if (newId) {
        // 유닛 소환 — 손패에서 포물선 비행 + 도착 스파클
        this.animator.setSpawnOrigin(newId, handOrigin.x, handOrigin.y);
        this.animator.arcLunge(newId, -90); // 위로 들어올렸다가 착지
        const postLo = this.board.computeLayout(w, h);
        const cv = postLo.cards.find((c) => c.instanceId === newId);
        if (cv) {
          const color = action.type === 'placeOpening' ? '#a0d8ff' : '#ffd060';
          this.board.spawnSparkle(cv.x + cv.w / 2, cv.y + cv.h / 2, color);
        }
      } else {
        // 주문 카드 — 손패 위치 버스트
        this.board.spawnSparkle(handOrigin.x, handOrigin.y, '#c090ff');
      }
    }

    // ── 카드 효과로 발생한 죽음 / 스탯 변화 (공격 이외) ─────────────────────
    if (!combatIds) {
      for (const id of preUnitIds) {
        if (!result.state.units[id]) {
          const pos = centerOf(id);
          if (pos) this.board.spawnBurst(pos.x, pos.y, '#ff7040');
        }
      }
      for (const [id, unit] of Object.entries(result.state.units)) {
        const prev = preUnitStats.get(id);
        if (!prev) continue;
        if (unit.power > prev.power || unit.wisdom > prev.wisdom) {
          const pos = centerOf(id);
          if (pos) this.board.spawnSparkle(pos.x, pos.y, '#80ffb0');
        }
        if (unit.power < prev.power || unit.wisdom < prev.wisdom) {
          const pos = centerOf(id);
          if (pos) this.board.spawnBurst(pos.x, pos.y, '#ff9060', 7);
        }
      }
    }

    this.events.emit('state:changed', { state: result.state });
    this.canvas.markDirty('board');
    this.canvas.markDirty('overlay');

    if (result.state.loser) {
      this.matchActive = false;
      this.ai?.destroy();
      const loser = result.state.loser;
      const text = loser === this.local ? '패배했습니다' : '승리했습니다!';
      this.ui.overlay.showGameOver(text, () => this.showLobby());
    } else {
      this.ai?.react();
    }
  }

  private logAction(action: RulesAction, state: GameState): void {
    switch (action.type) {
      case 'placeOpening': {
        const cardName = this.cardName(action.cardId);
        const entry = { text: `[오프닝] ${action.player}: ${cardName} 배치` };
        if (action.player !== this.local) {
          // Opponent placement — buffer until main phase reveals
          this.#oppOpeningBuf.push(entry);
        } else {
          this.ui.log.push(entry.text);
        }
        break;
      }
      case 'finishOpening':
        if (action.player !== this.local) {
          this.#oppOpeningBuf.push({ text: `[오프닝] ${action.player}: 배치 완료` });
        } else {
          this.ui.log.push(`[오프닝] ${action.player}: 배치 완료`);
        }
        if (state.phase === 'main') {
          // Flush buffered opponent opening logs now that cards are revealed
          for (const e of this.#oppOpeningBuf) this.ui.log.push(e.text, e.cls);
          this.#oppOpeningBuf = [];
          this.ui.log.push('— 오프닝 공개 · 메인 페이즈 시작 (A 선턴) —', 'k-step');
          // C-19: distinct phase-change banner (not a regular turn banner)
          const first = state.active;
          this.banner.showPhase('메인 페이즈 시작', first === this.local ? '내 턴부터 시작' : `${first} 턴부터 시작`);
        }
        break;
      case 'play': {
        const cardName = this.cardName(action.cardId);
        this.ui.log.push(`[${action.player}] ${cardName} 사용`, 'k-cast');
        // C-13: card play flash
        this.banner.queuePlay(cardName, action.player === this.local ? '사용' : `${action.player} 사용`);
        break;
      }
      case 'attack': {
        const atk = state.units[action.attackerId];
        const atName = atk ? this.cardName(atk.cardId) : '?';
        const def = state.units[action.targetId];
        const defName = def ? this.cardName(def.cardId) : '(파괴됨)';
        const atkDead = !state.units[action.attackerId];
        const defDead = !state.units[action.targetId];
        const result = atkDead && defDead ? '상호 파괴' : defDead ? '수비 파괴' : atkDead ? '공격자 파괴' : '방어 성공';
        this.ui.log.push(`[${action.player}] ${atName} → ${defName}: ${result}`, 'k-damage');
        break;
      }
      case 'resolveAttack': {
        const anim = this.#pendingAttackAnim;
        if (!anim) break;
        const atk = state.units[anim.attackerId];
        const atName = atk ? this.cardName(atk.cardId) : '?';
        const def = state.units[anim.targetId];
        const defName = def ? this.cardName(def.cardId) : '(파괴됨)';
        const atkDead = !state.units[anim.attackerId];
        const defDead = !state.units[anim.targetId];
        const coop = action.blockerIds.length > 0;
        const result = atkDead && defDead
          ? '상호 파괴'
          : defDead
            ? '수비 파괴'
            : atkDead
              ? '공격자 파괴'
              : coop ? `협공 방어 성공 (${action.blockerIds.length}명 합류)` : '방어 성공';
        this.ui.log.push(`[${anim.attacker}] ${atName} → ${defName}: ${result}`, 'k-damage');
        break;
      }
      case 'react': {
        const anim = this.#pendingReactionAnim;
        this.#pendingReactionAnim = null;
        if (!anim) break;
        const cardName = this.cardName(anim.cardId);
        this.ui.log.push(
          action.block
            ? `[${action.player}] 지략 봉쇄: ${cardName} (${anim.controller} 카드 잠금)`
            : `[${action.player}] 지략 통과: ${cardName} 발동 허용`,
          'k-step',
        );
        break;
      }
      case 'move': {
        const movedUnit = state.units[action.unitId];
        const unitName = movedUnit ? this.cardName(movedUnit.cardId) : '?';
        this.ui.log.push(`[${action.player}] ${unitName} 이동 → ${action.toCell}번 셀`, 'k-step');
        break;
      }
      case 'pass':
        this.ui.log.push(`— ${action.player} 패스 → ${state.active} 턴 —`, 'k-step');
        // 황폐(D-1 소모전) 진입 — 이 턴을 기점으로 시작되므로 일반 턴 배너보다
        // 우선해서 한 번만 띄운다.
        if (state.phase === 'main' && !state.loser && state.turn === DESOLATION_START_TURN) {
          this.ui.log.push(`— 황폐 시작: ${DESOLATION_START_TURN}턴부터 매 턴 필드 전체 -1 힘 —`, 'k-step');
          this.banner.showDesolation('황폐 시작', '매 턴 필드 전체 -1 힘 · 0 이하는 소멸');
        } else if (state.phase === 'main' && !state.loser) {
          // C-12: turn transition banner
          const next = state.active;
          this.banner.showTurn(next === this.local ? '내 턴' : `${next} 턴`, next === this.local);
        }
        break;
    }
  }

  private cardName(cardId: string): string {
    try { return getDef(cardId).name; } catch { return cardId; }
  }

  private installRenderers(): void {
    this.canvas.setRenderer('background', (ctx) => {
      ctx.fillStyle = UI.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    });
    this.canvas.setRenderer('board', (ctx) => this.board.draw(ctx, this.canvas.width, this.canvas.height));
    this.canvas.setRenderer('overlay', (ctx) => {
      this.interaction.renderOverlay(ctx, this.canvas.width, this.canvas.height);
      // 방어/대상 선택 모달이 떠 있는 동안에는 턴/카드 배너를 그리지 않는다 (겹침 방지).
      if (!this.interaction.isSelecting()) {
        this.banner.render(ctx, this.canvas.width, this.canvas.height, performance.now());
      }
    });
  }

  getState(): GameState {
    if (!this.game) throw new Error('no active game');
    return this.game.state;
  }

  destroy(): void {
    this.interaction.detach();
    this.ui.destroy();
    this.canvas.destroy();
    this.events.destroy();
  }
}
