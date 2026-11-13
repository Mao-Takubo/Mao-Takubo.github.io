import * as THREE from "three";
import { rainbowHue, type Palette, type Quality } from "../config/theme";

const TAU = Math.PI * 2;

export interface Frame {
  dt: number;
  /** seconds since start */
  t: number;
  /** smoothed 0..1 voice level */
  level: number;
  /** eased 0..1 excitement (listening / speaking) */
  energy: number;
  /** 0.15 when motion is reduced, else 1 */
  motion: number;
  reduceMotion: boolean;
  quality: Quality;
}

export interface CoreInstance {
  group: THREE.Group;
  /** invisible sphere used for click picking */
  pick: THREE.Mesh;
  /** `a` is 1 for the core in front and 0 for the others in the ring */
  update(f: Frame, a: number): void;
}

/** Geometry shared by every core in the ring. */
export interface SharedParts {
  dot: THREE.Texture;
  heart: THREE.BufferGeometry;
  halo: THREE.BufferGeometry;
  shell: THREE.BufferGeometry;
  outer: THREE.BufferGeometry;
  rings: THREE.BufferGeometry[];
  links: THREE.BufferGeometry;
  pick: THREE.BufferGeometry;
}

export const MAX_PARTICLES = 900;
const MAX_LINKS = 70;

const ringSpecs = [
  { r: 1.55, tube: 0.012, arc: TAU, tilt: [1.2, 0.2], speed: 0.35, role: "glow" },
  { r: 1.95, tube: 0.022, arc: 4.4, tilt: [0.4, 0.9], speed: -0.22, role: "highlight" },
  { r: 2.25, tube: 0.008, arc: TAU, tilt: [-0.9, 0.5], speed: 0.14, role: "line" },
  { r: 1.2, tube: 0.03, arc: 2.3, tilt: [0.1, -1.1], speed: 0.6, role: "glow" },
] as const;

export function createSharedParts(dot: THREE.Texture): SharedParts {
  const shell = new THREE.IcosahedronGeometry(1.3, 2);
  const outer = new THREE.IcosahedronGeometry(1.75, 1);

  // links between the two shells (static)
  const linkPos = new Float32Array(MAX_LINKS * 6);
  const a = shell.attributes.position!;
  const b = outer.attributes.position!;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  for (let i = 0; i < MAX_LINKS; i++) {
    va.fromBufferAttribute(a, Math.floor(rnd() * a.count));
    let best = Infinity;
    for (let k = 0; k < 12; k++) {
      const cand = new THREE.Vector3().fromBufferAttribute(b, Math.floor(rnd() * b.count));
      const d = cand.distanceTo(va);
      if (d < best) {
        best = d;
        vb.copy(cand);
      }
    }
    va.toArray(linkPos, i * 6);
    vb.toArray(linkPos, i * 6 + 3);
  }
  const links = new THREE.BufferGeometry();
  links.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));

  return {
    dot,
    heart: new THREE.SphereGeometry(0.26, 32, 24),
    halo: new THREE.SphereGeometry(0.62, 32, 24),
    shell,
    outer,
    rings: ringSpecs.map((s) => new THREE.TorusGeometry(s.r, s.tube, 8, 160, s.arc)),
    links,
    pick: new THREE.SphereGeometry(2.3, 12, 8),
  };
}

export function disposeSharedParts(p: SharedParts): void {
  p.dot.dispose();
  [p.heart, p.halo, p.shell, p.outer, ...p.rings, p.links, p.pick].forEach((g) => g.dispose());
}

/**
 * One glowing core. All of them are built the same; `update` turns the one in
 * front "alive" (rotation, pulse, orbiting particles) and leaves the rest calm and dim.
 */
export function createCoreInstance(palette: Palette, shared: SharedParts): CoreInstance & { dispose(): void } {
  const base = {
    glow: new THREE.Color(palette.glow),
    highlight: new THREE.Color(palette.highlight),
    line: new THREE.Color(palette.line),
  };
  const mats: THREE.Material[] = [];
  const mat = <T extends THREE.Material>(m: T): T => (mats.push(m), m);

  const group = new THREE.Group();
  const heartMat = mat(new THREE.MeshBasicMaterial({ fog: false }));
  const heart = new THREE.Mesh(shared.heart, heartMat);
  const haloMat = mat(
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  const halo = new THREE.Mesh(shared.halo, haloMat);
  const shellMat = mat(new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.3 }));
  const shell = new THREE.Mesh(shared.shell, shellMat);
  const outerMat = mat(new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.35 }));
  const outer = new THREE.Mesh(shared.outer, outerMat);
  group.add(heart, halo, shell, outer);

  const rings = ringSpecs.map((s, i) => {
    const m = mat(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 }));
    const mesh = new THREE.Mesh(shared.rings[i]!, m);
    const pivot = new THREE.Group();
    pivot.rotation.set(s.tilt[0], s.tilt[1], 0);
    pivot.add(mesh);
    group.add(pivot);
    return { mesh, mat: m, role: s.role, speed: s.speed };
  });

  const linkMat = mat(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22 }));
  group.add(new THREE.LineSegments(shared.links, linkMat));

  // orbiting particles, updated on the CPU only while the core is (becoming) active
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pColors = new Float32Array(MAX_PARTICLES * 3).fill(1);
  const orbit = Array.from({ length: MAX_PARTICLES }, () => ({
    r: 1.5 + Math.random() * 1.6,
    a: Math.random() * TAU,
    tilt: (Math.random() - 0.5) * 2.2,
    speed: (0.08 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1),
    wob: Math.random() * TAU,
  }));
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pColors, 3));
  const pMat = mat(
    new THREE.PointsMaterial({
      map: shared.dot, vertexColors: true, size: 0.07, sizeAttenuation: true, transparent: true,
      opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  group.add(new THREE.Points(pGeo, pMat));

  const pick = new THREE.Mesh(shared.pick, new THREE.MeshBasicMaterial({ visible: false }));
  mat(pick.material as THREE.Material);
  group.add(pick);

  const tmp = new THREE.Color();
  const hsl = (h: number, s: number, l: number) => tmp.setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace);
  let particlesInit = false;
  let t = 0;

  function paint(f: Frame, bright: number, drawn: number) {
    if (palette.rainbow) {
      const h = rainbowHue(f.t, f.reduceMotion);
      heartMat.color.copy(hsl(h, 1, 0.8)).multiplyScalar(bright);
      haloMat.color.copy(hsl(h, 1, 0.55)).multiplyScalar(bright);
      shellMat.color.copy(hsl(h + 0.08, 1, 0.55)).multiplyScalar(bright);
      outerMat.color.copy(hsl(h + 0.5, 0.8, 0.4)).multiplyScalar(bright);
      rings.forEach((r, i) => r.mat.color.copy(hsl(h + i * 0.22, 1, r.role === "line" ? 0.45 : 0.6)).multiplyScalar(bright));
      linkMat.color.copy(hsl(h + 0.3, 1, 0.55)).multiplyScalar(bright);
      pMat.color.setScalar(bright);
      for (let i = 0; i < drawn; i++) {
        hsl(h + i / drawn, 1, 0.65);
        pColors[i * 3] = tmp.r;
        pColors[i * 3 + 1] = tmp.g;
        pColors[i * 3 + 2] = tmp.b;
      }
      pGeo.attributes.color!.needsUpdate = true;
    } else {
      heartMat.color.copy(base.highlight).lerp(base.glow, 0.5).multiplyScalar(bright);
      haloMat.color.copy(base.glow).multiplyScalar(bright);
      shellMat.color.copy(base.glow).multiplyScalar(bright);
      outerMat.color.copy(base.line).multiplyScalar(bright);
      for (const r of rings) r.mat.color.copy(base[r.role]).multiplyScalar(bright);
      linkMat.color.copy(base.glow).multiplyScalar(bright);
      pMat.color.copy(base.highlight).multiplyScalar(bright);
    }
  }

  return {
    group,
    pick,
    update(f, a) {
      t += f.dt;
      const lively = f.motion * (0.06 + 0.94 * a); // calm when not in front
      const lvl = f.level * a;
      const en = f.energy * a;
      const boost = lvl + en;
      const pulse = Math.sin(f.t * 1.4) * 0.04 * lively;

      group.scale.setScalar(0.4 + 0.6 * a);
      const drawn = Math.floor(f.quality.particles * (0.12 + 0.88 * a));
      paint(f, 0.34 + 0.66 * a, drawn);

      heart.scale.setScalar(1 + pulse + lvl * 0.35);
      halo.scale.setScalar(1 + pulse * 2 + boost * 0.4);
      haloMat.opacity = 0.14 + boost * 0.22;
      shell.rotation.y += f.dt * 0.12 * lively * (1 + en);
      shell.rotation.x += f.dt * 0.05 * lively;
      outer.rotation.y -= f.dt * 0.07 * lively;
      outer.rotation.z += f.dt * 0.03 * lively;
      for (const r of rings) r.mesh.rotation.z += f.dt * r.speed * lively * (1 + en * 1.5 + lvl);
      linkMat.opacity = 0.18 + boost * 0.25;
      shellMat.opacity = 0.26 + boost * 0.25;

      pGeo.setDrawRange(0, drawn);
      if (a > 0.02 || !particlesInit) {
        particlesInit = true;
        for (let i = 0; i < drawn; i++) {
          const o = orbit[i]!;
          o.a += f.dt * o.speed * lively * (1 + en);
          const rr = o.r + Math.sin(t * 0.6 + o.wob) * 0.06 * lively + lvl * 0.15;
          const x = Math.cos(o.a) * rr;
          const z = Math.sin(o.a) * rr;
          pPos[i * 3] = x;
          pPos[i * 3 + 1] = z * Math.sin(o.tilt);
          pPos[i * 3 + 2] = z * Math.cos(o.tilt);
        }
        pGeo.attributes.position!.needsUpdate = true;
      }
    },
    dispose() {
      pGeo.dispose();
      mats.forEach((m) => m.dispose());
    },
  };
}
