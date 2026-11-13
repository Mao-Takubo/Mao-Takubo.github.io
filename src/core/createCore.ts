import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { qualities, theme, type Quality } from "../config/theme";
import type { VoiceState } from "../app/state";

export type CoreFocus = "center" | "side" | "top";

export interface Core {
  setFocus(focus: CoreFocus): void;
  setVoiceState(state: VoiceState): void;
  dispose(): void;
}

export interface CoreOptions {
  /** smoothed 0..1 voice level; called once per frame */
  getLevel(dt: number): number;
  reduceMotion: boolean;
  onContextLost?(): void;
  onContextRestored?(): void;
}

const CAMERA_Z = 7;
const FOV = 40;
const TAU = Math.PI * 2;

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

  const glow = new THREE.Color(theme.glow);
  const highlight = new THREE.Color(theme.highlight);
  const line = new THREE.Color(theme.line);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.bg, CAMERA_Z - 1.5, CAMERA_Z + 3.2); // dims the far side of the core
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.z = CAMERA_Z;

  const root = new THREE.Group();
  scene.add(root);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);

  // --- centre: small bright sphere + soft halo ---
  const heartMat = track(new THREE.MeshBasicMaterial({ color: highlight.clone().lerp(glow, 0.5), fog: false }));
  const heart = new THREE.Mesh(track(new THREE.SphereGeometry(0.26, 32, 24)), heartMat);
  const haloMat = track(
    new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  const halo = new THREE.Mesh(track(new THREE.SphereGeometry(0.62, 32, 24)), haloMat);
  root.add(heart, halo);

  // --- wireframe shells ---
  const shellGeo = track(new THREE.IcosahedronGeometry(1.3, 2));
  const shellMat = track(new THREE.MeshBasicMaterial({ color: glow, wireframe: true, transparent: true, opacity: 0.3 }));
  const shell = new THREE.Mesh(shellGeo, shellMat);
  const outerGeo = track(new THREE.IcosahedronGeometry(1.75, 1));
  const outerMat = track(new THREE.MeshBasicMaterial({ color: line, wireframe: true, transparent: true, opacity: 0.35 }));
  const outer = new THREE.Mesh(outerGeo, outerMat);
  root.add(shell, outer);

  // --- rings: differing thickness, partial arcs, own axis and speed ---
  const ringSpecs = [
    { r: 1.55, tube: 0.012, arc: TAU, tilt: [1.2, 0.2], speed: 0.35, color: glow },
    { r: 1.95, tube: 0.022, arc: 4.4, tilt: [0.4, 0.9], speed: -0.22, color: highlight },
    { r: 2.25, tube: 0.008, arc: TAU, tilt: [-0.9, 0.5], speed: 0.14, color: line },
    { r: 1.2, tube: 0.03, arc: 2.3, tilt: [0.1, -1.1], speed: 0.6, color: glow },
  ] as const;
  const rings = ringSpecs.map((s) => {
    const mat = track(new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.85 }));
    const mesh = new THREE.Mesh(track(new THREE.TorusGeometry(s.r, s.tube, 8, 160, s.arc)), mat);
    const pivot = new THREE.Group();
    pivot.rotation.set(s.tilt[0], s.tilt[1], 0);
    pivot.add(mesh);
    root.add(pivot);
    return { mesh, speed: s.speed };
  });

  // --- links between the two shells (static; thinned by quality) ---
  const maxLinks = qualities.standard.links;
  const linkPos = new Float32Array(maxLinks * 6);
  {
    const a = shellGeo.attributes.position!;
    const b = outerGeo.attributes.position!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let i = 0; i < maxLinks; i++) {
      va.fromBufferAttribute(a, Math.floor(rnd() * a.count));
      let best = Infinity;
      for (let t = 0; t < 12; t++) {
        const cand = new THREE.Vector3().fromBufferAttribute(b, Math.floor(rnd() * b.count));
        const d = cand.distanceTo(va);
        if (d < best) { best = d; vb.copy(cand); }
      }
      va.toArray(linkPos, i * 6);
      vb.toArray(linkPos, i * 6 + 3);
    }
  }
  const linkGeo = track(new THREE.BufferGeometry());
  linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
  const linkMat = track(new THREE.LineBasicMaterial({ color: glow, transparent: true, opacity: 0.22 }));
  root.add(new THREE.LineSegments(linkGeo, linkMat));

  // --- particles: orbiting points, updated on the CPU ---
  const maxParticles = qualities.standard.particles;
  const pPos = new Float32Array(maxParticles * 3);
  const orbit = Array.from({ length: maxParticles }, () => ({
    r: 1.5 + Math.random() * 1.6,
    a: Math.random() * TAU,
    tilt: (Math.random() - 0.5) * 2.2,
    speed: (0.08 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1),
    wob: Math.random() * TAU,
  }));
  const pGeo = track(new THREE.BufferGeometry());
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const dot = track(roundSprite());
  const pMat = track(
    new THREE.PointsMaterial({ map: dot, color: highlight, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  root.add(new THREE.Points(pGeo, pMat));

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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxDpr));
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxDpr));
    composer.setSize(width, height);
    bloom.setSize(Math.max(1, width * q.bloomScale), Math.max(1, height * q.bloomScale));
    bloom.enabled = q.bloom;
    pGeo.setDrawRange(0, q.particles);
    linkGeo.setDrawRange(0, q.links * 2);
  }

  // --- layout / focus ---
  let focus: CoreFocus = "center";
  let aspect = 1;
  const pos = new THREE.Vector3();
  let scale = 1;
  const visibleHalfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_Z;
  function focusTarget(): { x: number; y: number; s: number } {
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

  // --- input: faint parallax ---
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || opts.reduceMotion) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  };
  addEventListener("pointermove", onPointer, { passive: true });

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
  let energy = 0; // eased "excitement": listening / speaking
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

    const level = opts.getLevel(dt);
    const eTarget = voiceState === "listening" ? 0.6 : voiceState === "speaking" ? 0.35 : 0;
    energy += (eTarget - energy) * (1 - Math.exp(-dt * 4));
    const idlePulse = Math.sin(t * 1.4) * 0.04 * motion;
    const boost = level + energy;

    heart.scale.setScalar(1 + idlePulse + level * 0.35);
    halo.scale.setScalar(1 + idlePulse * 2 + boost * 0.4);
    haloMat.opacity = 0.14 + boost * 0.22;
    shell.rotation.y += dt * 0.12 * motion * (1 + energy);
    shell.rotation.x += dt * 0.05 * motion;
    outer.rotation.y -= dt * 0.07 * motion;
    outer.rotation.z += dt * 0.03 * motion;
    for (const r of rings) r.mesh.rotation.z += dt * r.speed * motion * (1 + energy * 1.5 + level);
    linkMat.opacity = 0.18 + boost * 0.25;
    shellMat.opacity = 0.26 + boost * 0.25;
    bloom.strength = (0.55 + boost * 0.8) * theme.glowStrength;

    for (let i = 0; i < q.particles; i++) {
      const o = orbit[i]!;
      o.a += dt * o.speed * motion * (1 + energy);
      const rr = o.r + Math.sin(t * 0.6 + o.wob) * 0.06 * motion + level * 0.15;
      const x = Math.cos(o.a) * rr;
      const z = Math.sin(o.a) * rr;
      pPos[i * 3] = x;
      pPos[i * 3 + 1] = z * Math.sin(o.tilt);
      pPos[i * 3 + 2] = z * Math.cos(o.tilt);
    }
    pGeo.attributes.position!.needsUpdate = true;

    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    root.rotation.y = pointer.sx * 0.18;
    root.rotation.x = pointer.sy * 0.12;

    const ft = focusTarget();
    const k = 1 - Math.exp(-dt * 5);
    pos.x += (ft.x - pos.x) * k;
    pos.y += (ft.y - pos.y) * k;
    scale += (ft.s - scale) * k;
    root.position.copy(pos);
    root.scale.setScalar(scale);

    composer.render(dt);

    // step quality down if frames stay slow
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
      focus = f;
    },
    setVoiceState(s) {
      voiceState = s;
    },
    dispose() {
      stop();
      ro.disconnect();
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      disposables.forEach((d) => d.dispose());
      composer.dispose();
      renderer.dispose();
    },
  };
}
