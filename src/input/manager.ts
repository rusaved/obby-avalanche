// What: InputManager: keyboard by event.code, mouse drag, mouse look without a button, dynamic left stick, right-half camera swipe, tap-jump in autorun, multitouch; consume() gives an InputSnapshot.
// Called by: main.ts; app/handles.ts (type); src/test-api/index.ts (setVirtualStick, injectKey, injectJump).
// Keep: reset() on pause, blur, pointercancel and lostpointercapture; a HUD button press is never a stick; no Ctrl/Alt/Meta shortcuts; numbers via InputOptions.

/**
 * InputManager (docs/02-tech.md 6.2–6.3): keyboard by event.code, mouse drag and wheel, dynamic stick on the left
 * half, camera swipe on the right half, jump button, multitouch by pointerId with setPointerCapture. Resets on any
 * pause reason, pointercancel, lostpointercapture and blur. Autorun: tap = jump, swipe = camera.
 */
import type { InputOptions, InputSnapshot, StickState } from './types.ts';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PREVENT_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

interface PointerTrack {
  id: number;
  kind: 'stick' | 'camera' | 'tap';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  moved: number;
}

/** SD-01: how often the HUD buttons' rects are read again for the mouse look (ms). */
const BUTTON_RECTS_MS = 500;

export class InputManager {
  readonly stick: StickState = { active: false, originX: 0, originY: 0, x: 0, y: 0, dx: 0, dy: 0 };
  autoRun = false;
  touchActive = false;
  /** Virtual stick from the test API (persists until changed). */
  private virtualStick: { x: number; y: number } | null = null;

  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, PointerTrack>();
  private jumpEdge = false;
  private pauseEdge = false;
  private moveStartEdge = false;
  private yawDelta = 0;
  private pitchDelta = 0;
  private zoomDelta = 0;
  /** The camera was turned by a drag since the last snapshot (PR-13: a finger resting on the camera zone is not a turn). */
  private turnEdge = false;
  /** LV-10: the camera was turned by the mouse moved without a button since the last snapshot. */
  private lookEdge = false;
  /** When the last drag of the mouse ended (event time, ms): the hand going back after it is not a look. */
  private dragEndAt = -Infinity;
  /** The pointer left the field: its next move there is the jump from where it left, not a look. */
  private lookSkip = false;
  private pinchDist: number | null = null;
  private field: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];
  private hudMatcher = '[data-hud]';
  private hudRoot: HTMLElement | null = null;
  /** SD-01: the HUD buttons' rects, read again at most every BUTTON_RECTS_MS (layout reads are not free per move). */
  private buttonRects: DOMRect[] = [];
  private buttonRectsAt = -Infinity;

  constructor(
    private readonly opts: InputOptions,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** When the event happened, not when its handler ran: a long frame between down and up must not turn a tap into a hold. */
  private eventTime(ev: Event): number {
    return ev.timeStamp > 0 ? ev.timeStamp : this.now();
  }

  attach(field: HTMLElement, hudRoot: HTMLElement): void {
    this.field = field;
    this.hudRoot = hudRoot;
    const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    const onEl = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Document, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (ev) => this.onKeyDown(ev));
    on(window, 'keyup', (ev) => this.onKeyUp(ev));
    on(window, 'blur', () => this.reset());

    onEl(field, 'pointerdown', (ev) => this.onPointerDown(ev, hudRoot));
    onEl(field, 'pointermove', (ev) => this.onPointerMove(ev));
    onEl(field, 'pointerup', (ev) => this.onPointerUp(ev));
    onEl(field, 'pointercancel', (ev) => this.onPointerCancel(ev));
    onEl(field, 'lostpointercapture', (ev) => this.onPointerCancel(ev));
    onEl(field, 'pointerleave', () => {
      this.lookSkip = true;
    });
    onEl(field, 'wheel', (ev) => this.onWheel(ev), { passive: false });

    // Browser bans (docs/03 SCR-03, SCR-04): no context menu, selection, double-click zoom, gestures.
    const prevent = (ev: Event): void => ev.preventDefault();
    onEl(document, 'contextmenu', prevent);
    onEl(document, 'selectstart', prevent);
    onEl(document, 'dblclick', prevent);
    onEl(document, 'gesturestart' as keyof HTMLElementEventMap, prevent);
    // A range slider of a window (the footsteps volume) moves under the finger (LV-12 review); everything else stays put.
    onEl(document, 'touchmove', (ev) => ((ev.target as Element | null)?.closest?.('input[type=range]') ? undefined : ev.preventDefault()), { passive: false });
  }

  detach(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
  }

  /** Clears every held key, pointer and stick (new pause reason, ad, blur). */
  reset(): void {
    this.keys.clear();
    this.pointers.clear();
    this.stick.active = false;
    this.stick.dx = 0;
    this.stick.dy = 0;
    this.jumpEdge = false;
    this.pauseEdge = false;
    this.moveStartEdge = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomDelta = 0;
    this.turnEdge = false;
    this.lookEdge = false;
    this.pinchDist = null;
    this.virtualStick = null;
  }

  /** Test API: a virtual stick vector in the control frame. */
  setVirtualStick(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len < 1e-6) {
      this.virtualStick = null;
      return;
    }
    if (!this.virtualStick) this.moveStartEdge = true;
    const k = len > 1 ? 1 / len : 1;
    this.virtualStick = { x: x * k, y: y * k };
  }

  /** Test API: key by code. */
  injectKey(code: string, down: boolean): void {
    if (down) this.pressCode(code);
    else this.keys.delete(code);
  }

  /** Test API: jump button. */
  injectJump(): void {
    this.jumpEdge = true;
  }

  /** Called by the HUD jump button on pointerdown. */
  jumpButtonDown(): void {
    this.touchActive = true;
    this.jumpEdge = true;
  }

  /** Pause edge is read every rendered frame, also while the simulation is paused (menu toggles back). */
  consumePause(): boolean {
    const e = this.pauseEdge;
    this.pauseEdge = false;
    return e;
  }

  consume(): InputSnapshot {
    let moveX = 0;
    let moveY = 0;
    if (this.virtualStick) {
      moveX = this.virtualStick.x;
      moveY = this.virtualStick.y;
    } else if (this.stick.active) {
      moveX = this.stick.dx;
      moveY = this.stick.dy;
    } else {
      moveX = (this.has('KeyD') || this.has('ArrowRight') ? 1 : 0) - (this.has('KeyA') || this.has('ArrowLeft') ? 1 : 0);
      moveY = (this.has('KeyW') || this.has('ArrowUp') ? 1 : 0) - (this.has('KeyS') || this.has('ArrowDown') ? 1 : 0);
      const len = Math.hypot(moveX, moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }
    }
    const snap: InputSnapshot = {
      moveX,
      moveY,
      jumpPressed: this.jumpEdge,
      jumpHeld: this.has('Space') || this.jumpEdge,
      camYawDelta: this.yawDelta,
      camPitchDelta: this.pitchDelta,
      zoomDelta: this.zoomDelta,
      pausePressed: false,
      manualCamera: this.turnEdge || this.lookEdge,
      mouseLook: this.lookEdge && !this.turnEdge,
      moveStarted: this.moveStartEdge,
      touchActive: this.touchActive,
    };
    this.jumpEdge = false;
    this.moveStartEdge = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomDelta = 0;
    this.turnEdge = false;
    this.lookEdge = false;
    return snap;
  }

  private has(code: string): boolean {
    return this.keys.has(code);
  }

  private pressCode(code: string): void {
    const wasMoving = Array.from(this.keys).some((k) => MOVE_KEYS.has(k));
    if (!this.keys.has(code)) {
      if (code === 'Space') this.jumpEdge = true;
      if (PAUSE_KEYS.has(code)) this.pauseEdge = true;
    }
    this.keys.add(code);
    if (MOVE_KEYS.has(code) && !wasMoving) this.moveStartEdge = true;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    // No shortcuts with modifiers, no F-keys, no Tab (docs/03 SCR-05).
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (PREVENT_KEYS.has(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    if (!MOVE_KEYS.has(ev.code) && ev.code !== 'Space' && !PAUSE_KEYS.has(ev.code)) return;
    this.touchActive = false;
    this.pressCode(ev.code);
  }

  private onKeyUp(ev: KeyboardEvent): void {
    this.keys.delete(ev.code);
  }

  private radius(): number {
    const w = this.field?.clientWidth ?? window.innerWidth;
    const h = this.field?.clientHeight ?? window.innerHeight;
    return Math.min(w, h) * this.opts.stickRadiusFrac;
  }

  private onPointerDown(ev: PointerEvent, hudRoot: HTMLElement): void {
    const target = ev.target as HTMLElement | null;
    // Touching a HUD button is a button press, never a stick (docs/02-tech.md 6.3).
    if (target && target !== this.field && hudRoot.contains(target) && target.closest(this.hudMatcher)) return;
    if (ev.pointerType === 'mouse') {
      if (ev.button !== 0 && ev.button !== 2) return;
      this.touchActive = false;
      this.pointers.set(ev.pointerId, { id: ev.pointerId, kind: 'camera', startX: ev.clientX, startY: ev.clientY, lastX: ev.clientX, lastY: ev.clientY, startTime: this.eventTime(ev), moved: 0 });
      try {
        this.field?.setPointerCapture(ev.pointerId);
      } catch {
        /* capture is best effort */
      }
      ev.preventDefault();
      return;
    }
    this.touchActive = true;
    const rect = this.field?.getBoundingClientRect();
    const localX = ev.clientX - (rect?.left ?? 0);
    const width = rect?.width ?? window.innerWidth;
    let kind: PointerTrack['kind'];
    if (this.autoRun) kind = 'tap';
    else kind = localX < width / 2 && !this.stick.active ? 'stick' : 'camera';
    if (kind === 'stick') {
      this.stick.active = true;
      this.stick.originX = ev.clientX;
      this.stick.originY = ev.clientY;
      this.stick.x = ev.clientX;
      this.stick.y = ev.clientY;
      this.stick.dx = 0;
      this.stick.dy = 0;
      this.moveStartEdge = true;
    }
    this.pointers.set(ev.pointerId, { id: ev.pointerId, kind, startX: ev.clientX, startY: ev.clientY, lastX: ev.clientX, lastY: ev.clientY, startTime: this.eventTime(ev), moved: 0 });
    try {
      this.field?.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is best effort */
    }
    ev.preventDefault();
  }

  private onPointerMove(ev: PointerEvent): void {
    const p = this.pointers.get(ev.pointerId);
    if (!p) {
      this.onMouseLook(ev);
      return;
    }
    const dx = ev.clientX - p.lastX;
    const dy = ev.clientY - p.lastY;
    p.lastX = ev.clientX;
    p.lastY = ev.clientY;
    p.moved = Math.max(p.moved, Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY));
    if (p.kind === 'stick') {
      const r = this.radius();
      let sx = (ev.clientX - this.stick.originX) / r;
      let sy = -(ev.clientY - this.stick.originY) / r;
      const len = Math.hypot(sx, sy);
      if (len > 1) {
        // The stick origin follows the finger beyond the radius (dynamic stick).
        this.stick.originX = ev.clientX - (sx / len) * r;
        this.stick.originY = ev.clientY + (sy / len) * r;
        sx /= len;
        sy /= len;
      }
      const dead = this.opts.deadZoneFrac;
      const l2 = Math.hypot(sx, sy);
      if (l2 < dead) {
        sx = 0;
        sy = 0;
      } else {
        const scaled = (l2 - dead) / (1 - dead);
        sx = (sx / l2) * scaled;
        sy = (sy / l2) * scaled;
      }
      this.stick.x = ev.clientX;
      this.stick.y = ev.clientY;
      this.stick.dx = sx;
      this.stick.dy = sy;
      return;
    }
    // Camera (mouse drag, touch swipe, autorun swipe). Pinch zoom with two camera fingers.
    const cams = Array.from(this.pointers.values()).filter((t) => t.kind !== 'stick');
    if (ev.pointerType !== 'mouse' && cams.length >= 2) {
      const [a, b] = cams as [PointerTrack, PointerTrack];
      const d = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
      if (this.pinchDist !== null) this.zoomDelta -= ((d - this.pinchDist) / 40) * this.opts.zoomStep;
      this.pinchDist = d;
      return;
    }
    const degPerPx = (ev.pointerType === 'mouse' ? this.opts.mouseDegPerPx : this.opts.touchDegPerPx) * this.opts.sensitivity;
    this.yawDelta -= (dx * degPerPx * Math.PI) / 180;
    this.pitchDelta += (dy * degPerPx * Math.PI) / 180;
    // A turn by hand once the drag is past the tap distance: a finger or a held button that rests still is not one
    // (PR-13, playtest of the prototype 2: a thumb left on the camera zone held off the wide frame on the belt).
    if ((dx !== 0 || dy !== 0) && p.moved >= this.opts.tapMovePx) this.turnEdge = true;
  }

  /**
   * LV-10 (docs/01-gdd.md 22.11): on a PC the mouse moved over the field without a button turns the camera, no pointer lock
   * (movementX). Only over the field itself: a HUD button or a window takes its own events, a paused game drops them
   * (reset on every pause change). Not within lookAfterDragMs of a drag: the hand going back after it would undo the turn.
   */
  private onMouseLook(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse' || !this.opts.mouseLook || ev.buttons !== 0) return;
    if (this.lookSkip) {
      this.lookSkip = false;
      return;
    }
    if (this.eventTime(ev) - this.dragEndAt < (this.opts.lookAfterDragMs ?? 0)) return;
    const dx = ev.movementX;
    if (!dx) return;
    // The hand on its way to a corner button (pause, sound, menu) turns nothing (LV-12 review): the outer band of the field.
    const edge = this.opts.mouseEdge ?? 0;
    if (edge > 0 && (ev.clientX < innerWidth * edge || ev.clientX > innerWidth * (1 - edge) || ev.clientY < innerHeight * edge)) return;
    // SD-01 (docs/01-gdd.md 23.1): nor the top band (pause, goal) nor near any HUD button (producer 15.10: the camera
    // turned on the way to a button).
    if (ev.clientY < innerHeight * (this.opts.mouseTop ?? 0)) return;
    // SD-10 (review: with W held the hand on its way to «Sneakers» turned the run off the ice chute): while a move key
    // is held the mouse turns nothing — the run keeps its way, the look comes between runs.
    if ([...MOVE_KEYS].some((k) => this.keys.has(k))) return;
    if (this.nearButton(ev.clientX, ev.clientY, this.eventTime(ev))) return;
    this.yawDelta -= (dx * (this.opts.mouseYawPerPx ?? this.opts.mouseDegPerPx) * this.opts.sensitivity * Math.PI) / 180;
    this.lookEdge = true;
  }

  private nearButton(x: number, y: number, t: number): boolean {
    const pad = this.opts.mouseButtonPad ?? 0;
    if (pad <= 0 || !this.hudRoot) return false;
    if (t - this.buttonRectsAt > BUTTON_RECTS_MS || t < this.buttonRectsAt) {
      this.buttonRectsAt = t;
      this.buttonRects = [];
      this.hudRoot.querySelectorAll('button').forEach((b) => {
        // Only a button the player sees: windows stay in the DOM hidden (visibility, opacity).
        if (b.checkVisibility && !b.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.buttonRects.push(r);
      });
    }
    return this.buttonRects.some((r) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
  }

  private onPointerUp(ev: PointerEvent): void {
    const p = this.pointers.get(ev.pointerId);
    if (!p) return;
    this.pointers.delete(ev.pointerId);
    if (ev.pointerType === 'mouse' && p.moved >= this.opts.tapMovePx) this.dragEndAt = this.eventTime(ev);
    if (p.kind === 'stick') {
      this.stick.active = false;
      this.stick.dx = 0;
      this.stick.dy = 0;
    } else if (p.kind === 'tap') {
      const dt = this.eventTime(ev) - p.startTime;
      if (dt < this.opts.tapMaxMs && p.moved < this.opts.tapMovePx) this.jumpEdge = true;
    }
    if (Array.from(this.pointers.values()).filter((t) => t.kind !== 'stick').length < 2) this.pinchDist = null;
  }

  private onPointerCancel(ev: PointerEvent): void {
    const p = this.pointers.get(ev.pointerId);
    if (!p) return;
    this.pointers.delete(ev.pointerId);
    if (p.kind === 'stick') {
      this.stick.active = false;
      this.stick.dx = 0;
      this.stick.dy = 0;
    }
    this.pinchDist = null;
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    this.zoomDelta += Math.sign(ev.deltaY) * this.opts.zoomStep;
  }
}
