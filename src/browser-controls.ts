/**
 * Non-immersive browser controls for the public judge link.
 *
 * One first-person/orbit camera for desktop, tablet, and phone:
 * drag orbits, right/shift/two-finger drag pans, wheel/pinch
 * zooms, Arrow/WASD moves, Q/E changes height, and a tap selects
 * through the shared evidence pointer ray. No avatar is added;
 * a small gold ring marks the current focus target instead.
 */
import {
  Matrix4, Mesh, MeshBasicMaterial, Quaternion, TorusGeometry,
  Vector3, VisibilityState, createSystem,
} from '@iwsdk/core';
import { browserPickRequest, browserPointerState, endVoiceTurn, voiceToggleRequest } from './evidence-ui.ts';
import {
  clampOrbit, isTapGesture, orbitCameraPosition, orbitForward,
  orbitRight, pointerToNdc, type OrbitState,
} from './browser-controls-math.ts';

const INITIAL: OrbitState = {
  target: { x: 0, y: 1.25, z: -1.95 },
  azimuth: 0,
  polar: 1.42,
  distance: 3.1,
};
const VIEWS: Record<string, OrbitState> = {
  overview: { target: { x: 0, y: 1.35, z: -2.7 }, azimuth: 0, polar: 1.03, distance: 8.5 },
  evidence: INITIAL,
  panel: { target: { x: 0, y: 2.05, z: -2.7 }, azimuth: 0, polar: 1.48, distance: 3.2 },
  reset: INITIAL,
};

interface ActivePointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  button: number;
  shift: boolean;
}

export class BrowserControlsSystem extends createSystem({}) {
  private goal: OrbitState = structuredClone(INITIAL);
  private current: OrbitState = structuredClone(INITIAL);
  private pointers = new Map<number, ActivePointer>();
  private pinchDistance = 0;
  private keys = new Set<string>();
  private canvas: HTMLCanvasElement | undefined;
  private overlay: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private focusRing: Mesh | undefined;
  private wasImmersive = false;
  private ignoreDrag = false;

  init(): void {
    this.canvas = this.renderer.domElement as HTMLCanvasElement;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';
    this.overlay = document.getElementById('browser-controls');
    this.statusEl = document.getElementById('browser-controls-status');
    this.focusRing = new Mesh(
      new TorusGeometry(0.22, 0.012, 10, 48),
      new MeshBasicMaterial({ color: 0xd9b84c, transparent: true, opacity: 0.9 }),
    );
    this.focusRing.rotation.x = Math.PI / 2;
    this.focusRing.name = 'browser-focus-target';
    this.scene.add(this.focusRing);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.querySelectorAll<HTMLButtonElement>('[data-browser-view]').forEach((button) => {
      button.addEventListener('click', () => this.setView(button.dataset.browserView ?? 'reset'));
    });
    document.getElementById('browser-zoom-in')?.addEventListener('click', () => this.zoom(0.8));
    document.getElementById('browser-zoom-out')?.addEventListener('click', () => this.zoom(1.25));
    this.setStatus('Drag to look around. Click a glowing record to open it.');
  }

  private get nonImmersive(): boolean {
    return !this.world.session && this.world.visibilityState.value === VisibilityState.NonImmersive;
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private setView(name: string): void {
    // Clicked view changes are tap mode: silence + flush any
    // speech queued for the previous view (owner, 2026-11-03).
    endVoiceTurn();
    const view = VIEWS[name] ?? INITIAL;
    this.goal = clampOrbit(structuredClone(view));
    this.setStatus(name === 'panel'
      ? 'Panel view. Use the 3D panel buttons and search suggestions.'
      : name === 'overview'
        ? 'Overview. Drag to orbit the whole data universe.'
        : 'Evidence view. Click or tap a glowing record.');
  }

  private zoom(factor: number): void {
    this.goal = clampOrbit({ ...this.goal, distance: this.goal.distance * factor });
  }

  private updatePointerState(event: PointerEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = pointerToNdc(event.clientX, event.clientY, rect);
    browserPointerState.active = this.nonImmersive;
    browserPointerState.x = ndc.x;
    browserPointerState.y = ndc.y;
  }

  private onContextMenu = (event: Event): void => event.preventDefault();
  private onBlur = (): void => { this.keys.clear(); this.pointers.clear(); };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.nonImmersive) return;
    this.updatePointerState(event);
    this.ignoreDrag = browserPointerState.overPanel;
    this.canvas?.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      button: event.button,
      shift: event.shiftKey,
    });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (this.canvas) this.canvas.style.cursor = 'grabbing';
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.nonImmersive) return;
    this.updatePointerState(event);
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.ignoreDrag && this.pointers.size === 1) return;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDistance > 0 && distance > 0) {
        this.zoom(this.pinchDistance / distance);
      }
      this.pinchDistance = distance;
      this.pan(dx / 2, dy / 2);
      return;
    }
    if (pointer.button === 2 || pointer.shift || event.buttons === 4) {
      this.pan(dx, dy);
      return;
    }
    this.goal = clampOrbit({
      ...this.goal,
      azimuth: this.goal.azimuth - dx * 0.005,
      polar: this.goal.polar - dy * 0.004,
    });
  };

  private onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.canvas) this.canvas.style.cursor = 'grab';
    if (!pointer || !this.nonImmersive || event.type === 'pointercancel') return;
    this.updatePointerState(event);
    if (isTapGesture(event.clientX - pointer.startX, event.clientY - pointer.startY, performance.now() - pointer.startedAt)) {
      browserPickRequest.nonce += 1;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.nonImmersive) return;
    event.preventDefault();
    this.zoom(event.deltaY > 0 ? 1.12 : 0.89);
  };

  private editableTarget(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.nonImmersive || this.editableTarget(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const movement = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', 'pageup', 'pagedown'];
    if (movement.includes(key)) {
      event.preventDefault();
      this.keys.add(key);
    } else if (key === 'r' || key === 'home') {
      event.preventDefault();
      this.setView('reset');
    } else if (key === 'x' && !event.repeat) {
      event.preventDefault();
      voiceToggleRequest.nonce += 1;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private pan(dx: number, dy: number): void {
    const right = orbitRight(this.goal.azimuth);
    const scale = this.goal.distance * 0.0016;
    this.goal = clampOrbit({
      ...this.goal,
      target: {
        x: this.goal.target.x - right.x * dx * scale,
        y: this.goal.target.y + dy * scale,
        z: this.goal.target.z - right.z * dx * scale,
      },
    });
  }

  private applyKeyboard(delta: number): void {
    if (!this.keys.size) return;
    const speed = (this.keys.has('shift') ? 5.5 : 2.6) * delta;
    const forward = orbitForward(this.goal.azimuth);
    const right = orbitRight(this.goal.azimuth);
    const move = { x: 0, y: 0, z: 0 };
    const add = (v: { x: number; z: number }, amount: number) => {
      move.x += v.x * amount;
      move.z += v.z * amount;
    };
    if (this.keys.has('arrowup') || this.keys.has('w')) add(forward, speed);
    if (this.keys.has('arrowdown') || this.keys.has('s')) add(forward, -speed);
    if (this.keys.has('arrowright') || this.keys.has('d')) add(right, speed);
    if (this.keys.has('arrowleft') || this.keys.has('a')) add(right, -speed);
    if (this.keys.has('e') || this.keys.has('pageup')) move.y += speed;
    if (this.keys.has('q') || this.keys.has('pagedown')) move.y -= speed;
    this.goal = clampOrbit({
      ...this.goal,
      target: {
        x: this.goal.target.x + move.x,
        y: this.goal.target.y + move.y,
        z: this.goal.target.z + move.z,
      },
    });
  }

  update(delta: number): void {
    const immersive = Boolean(this.world.session) || this.world.visibilityState.value !== VisibilityState.NonImmersive;
    if (this.overlay) this.overlay.style.display = immersive ? 'none' : '';
    if (this.focusRing) this.focusRing.visible = !immersive;
    if (immersive) {
      browserPointerState.active = false;
      this.keys.clear();
      this.wasImmersive = true;
      return;
    }
    if (this.wasImmersive) {
      this.wasImmersive = false;
      this.current = structuredClone(this.goal);
      this.setStatus('Back in browser view. Drag to look around.');
    }
    this.applyKeyboard(Math.min(delta || 0.016, 0.05));
    const k = 1 - Math.exp(-10 * Math.max(delta || 0.016, 0.001));
    const lerp = (a: number, b: number) => a + (b - a) * k;
    this.current = clampOrbit({
      target: {
        x: lerp(this.current.target.x, this.goal.target.x),
        y: lerp(this.current.target.y, this.goal.target.y),
        z: lerp(this.current.target.z, this.goal.target.z),
      },
      azimuth: lerp(this.current.azimuth, this.goal.azimuth),
      polar: lerp(this.current.polar, this.goal.polar),
      distance: lerp(this.current.distance, this.goal.distance),
    });

    const desired = orbitCameraPosition(this.current);
    const desiredPos = new Vector3(desired.x, desired.y, desired.z);
    const target = new Vector3(this.current.target.x, this.current.target.y, this.current.target.z);
    // Matrix4.lookAt gives the camera convention (-Z toward the
    // target). A generic Object3D.lookAt faces +Z and is wrong here.
    const orienter = { quaternion: new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(desiredPos, target, new Vector3(0, 1, 0)),
    ) };
    const parent = this.camera.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.camera.position.copy(parent.worldToLocal(desiredPos.clone()));
      const parentQuat = parent.getWorldQuaternion(new Quaternion()).invert();
      this.camera.quaternion.copy(parentQuat.multiply(orienter.quaternion));
    } else {
      this.camera.position.copy(desiredPos);
      this.camera.quaternion.copy(orienter.quaternion);
    }
    this.camera.updateMatrixWorld(true);
    if (this.focusRing) {
      this.focusRing.position.copy(target);
      const pulse = 1 + Math.sin(performance.now() * 0.0025) * 0.06;
      this.focusRing.scale.setScalar(pulse);
    }
  }
}
