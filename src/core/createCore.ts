import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { qualities, theme, type Palette, type Quality } from "../config/theme";
import type { VoiceState } from "../app/state";
import { createCoreInstance, createSharedParts, disposeSharedParts, type CoreInstance } from "./coreInstance";

export type CoreFocus = "center" | "side" | "top";

export interface Core {
  setFocus(focus: CoreFocus): void;
  setVoiceState(state: VoiceState): void;
  /** move the ring by whole steps (+1 = next core, from the right) */
  step(delta: number): void;
  /** client coordinates where the front core will sit for a given focus */
  screenPosition(focus: CoreFocus): { x: number; y: number };
  /** brief excitement burst (e.g. when a panel is spawned) */
  pulse(): void;
  select(index: number): void;
  dispose(): void;
}

export interface CoreOptions {
  palettes: Palette[];
  initialIndex: number;
  /** called whenever the core in front changes (also while dragging) */
  onSelect(index: number): void;
  /** a tap/click that did not drag the ring */
  onTap(): void;
  /** smoothed 0..1 voice level; called once per frame */
  getLevel(dt: number): number;
  reduceMotion: boolean;
  onContextLost?(): void;
  onContextRestored?(): void;
}

const CAMERA_Z = 7;
const FOV = 40;
const TAU = Math.PI * 2;
const RING_RADIUS = 6;
const RING_TILT = 0.42;
const DRAG_PX_PER_STEP = 260;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function roundSprite(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function pickQuality(): keyof typeof qualities {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
  return coarse || weak ? "light" : "standard";
}

export function createCore(canvas: HTMLCanvasElement, opts: CoreOptions): Core | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    console.warn("WebGL unavailable", e);
    return null;
  }

  const N = opts.palettes.length;
  const STEP = TAU / N;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.bg, CAMERA_Z - 1.5, CAMERA_Z + 16); // far cores in the ring fade into the dark
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.z = CAMERA_Z;

  // root (focus move/scale, parallax) > tilt (Saturn-like slant) > spin (rotates with the ring position) > cores
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  scene.add(root);
  root.add(tilt);
  tilt.add(spin);
  tilt.rotation.x = RING_TILT;
  tilt.position.set(0, RING_RADIUS * Math.sin(RING_TILT), -RING_RADIUS * Math.cos(RING_TILT)); // front core sits at the origin

  const shared = createSharedParts(roundSprite());
  const cores: (CoreInstance & { dispose(): void })[] = opts.palettes.map((p, i) => {
    const c = createCoreInstance(p, shared);
    c.group.position.set(RING_RADIUS * Math.sin(i * STEP), 0, RING_RADIUS * Math.cos(i * STEP));
    c.pick.userData.index = i;
    spin.add(c.group);
    return c;
  });

  // --- post-processing ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.6, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // --- quality ---
  let qualityKey: keyof typeof qualities = pickQuality();
  let q: Quality = qualities[qualityKey];
  let width = 1;
  let height = 1;
  function applyQuality() {
    q = qualities[qualityKey];
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloom.setSize(Math.max(1, width * q.bloomScale), Math.max(1, height * q.bloomScale));
    bloom.enabled = q.bloom;
  }

  // --- layout / focus ---
  let focusState: CoreFocus = "center";
  let aspect = 1;
  const pos = new THREE.Vector3();
  let scale = 1;
  const visibleHalfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_Z;
  function focusTarget(focus: CoreFocus = focusState): { x: number; y: number; s: number } {
    const halfW = visibleHalfH * aspect;
    const fit = Math.min(1, halfW / 2.7, visibleHalfH / 2.7);
    if (focus === "side") return { x: -halfW * 0.4, y: 0, s: fit * 0.62 };
    if (focus === "top") return { x: 0, y: visibleHalfH * 0.64, s: fit * 0.5 };
    return { x: 0, y: visibleHalfH * 0.04, s: fit };
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    applyQuality();
    const t = focusTarget();
    pos.set(t.x, t.y, 0);
    scale = t.s;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // --- ring position: `ringPos` is fractional while moving, `target` an integer once released ---
  let ringPos = mod(opts.initialIndex, N);
  let target: number | null = ringPos;
  let shown = mod(Math.round(ringPos), N);
  const indexNow = () => mod(Math.round(ringPos), N);

  function step(delta: number) {
    target = Math.round(target ?? ringPos) + delta;
  }
  function select(index: number) {
    const diff = mod(index - indexNow() + N / 2, N) - N / 2;
    target = Math.round(ringPos) + diff;
  }

  // --- input: drag / swipe, wheel, tap-to-select ---
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag: { id: number; x0: number; pos0: number; lastX: number; lastT: number; vel: number; moved: boolean } | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, pos0: ringPos, lastX: e.clientX, lastT: e.timeStamp, vel: 0, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) > 6) drag.moved = true;
    if (!drag.moved) return;
    target = null;
    ringPos = drag.pos0 - dx / DRAG_PX_PER_STEP;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.vel = (-(e.clientX - drag.lastX) / DRAG_PX_PER_STEP / dt) * 1000; // steps per second
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      const fling = Math.abs(d.vel) > 0.8 ? Math.sign(d.vel) * Math.min(2, Math.abs(d.vel) * 0.25) : 0;
      target = Math.round(ringPos + fling);
      return;
    }
    // a tap: choose a core in the ring, or just report the tap
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(cores.map((c) => c.pick), false);
    const idx = hits[0]?.object.userData.index as number | undefined;
    if (idx !== undefined && idx !== indexNow()) select(idx);
    else opts.onTap();
  };
  const onCancel = () => {
    if (drag?.moved) target = Math.round(ringPos);
    drag = null;
  };
  let wheelAcc = 0;
  let wheelLock = 0;
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical wheel keeps its normal meaning
    e.preventDefault();
    wheelAcc += e.deltaX;
    if (Math.abs(wheelAcc) > 50 && performance.now() > wheelLock) {
      step(Math.sign(wheelAcc));
      wheelLock = performance.now() + 380;
      wheelAcc = 0;
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onWindowPointer = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || opts.reduceMotion) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  };
  addEventListener("pointermove", onWindowPointer, { passive: true });

  const onLost = (e: Event) => {
    e.preventDefault();
    stop();
    opts.onContextLost?.();
  };
  const onRestored = () => {
    applyQuality();
    opts.onContextRestored?.();
    start();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  // --- loop ---
  let voiceState: VoiceState = "idle";
  let energy = 0;
  let kick = 0; // decaying burst from pulse()
  let raf = 0;
  let last = performance.now();
  let t = 0;
  let slow = 0;
  let frames = 0;
  const motion = opts.reduceMotion ? 0.15 : 1;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;

    // ring position eases toward its target
    if (target !== null) {
      const k = 1 - Math.exp(-dt * 7);
      ringPos += (target - ringPos) * k;
      if (Math.abs(target - ringPos) < 0.0008) ringPos = target;
    }
    spin.rotation.y = -ringPos * STEP;
    const idx = indexNow();
    if (idx !== shown) {
      shown = idx;
      opts.onSelect(idx);
    }

    const level = opts.getLevel(dt);
    const eTarget = voiceState === "listening" ? 0.6 : voiceState === "speaking" ? 0.35 : 0;
    energy += (eTarget - energy) * (1 - Math.exp(-dt * 4));
    kick *= Math.exp(-dt * 2.5);
    const boost = level + energy + kick * 0.9;

    const frameInfo = { dt, t, level, energy: energy + kick, motion, reduceMotion: opts.reduceMotion, quality: q };
    cores.forEach((c, i) => {
      const d = Math.abs(mod(i - ringPos + N / 2, N) - N / 2); // distance in steps from the front
      const a = clamp01(1 - d);
      c.update(frameInfo, a * a * (3 - 2 * a)); // smoothstep
    });
    bloom.strength = (0.55 + boost * 0.8) * theme.glowStrength;

    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    root.rotation.y = pointer.sx * 0.12;
    root.rotation.x = pointer.sy * 0.08;

    const ft = focusTarget();
    const k = 1 - Math.exp(-dt * 5);
    pos.x += (ft.x - pos.x) * k;
    pos.y += (ft.y - pos.y) * k;
    scale += (ft.s - scale) * k;
    root.position.copy(pos);
    root.scale.setScalar(scale);

    composer.render(dt);

    slow += dt > 0.034 ? 1 : 0;
    if (++frames === 90) {
      if (slow > 36 && qualityKey !== "minimal") {
        qualityKey = qualityKey === "standard" ? "light" : "minimal";
        applyQuality();
      }
      slow = frames = 0;
    }
  }
  function start() {
    if (raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  start();

  return {
    setFocus(f) {
      focusState = f;
    },
    screenPosition(f) {
      const ft = focusTarget(f);
      const v = new THREE.Vector3(ft.x, ft.y, 0).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    },
    pulse() {
      kick = 1;
    },
    setVoiceState(s) {
      voiceState = s;
    },
    step,
    select,
    dispose() {
      stop();
      ro.disconnect();
      removeEventListener("pointermove", onWindowPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      cores.forEach((c) => c.dispose());
      disposeSharedParts(shared);
      composer.dispose();
      renderer.dispose();
    },
  };
}
