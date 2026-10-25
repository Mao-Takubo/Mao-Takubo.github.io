import * as THREE from 'three';

const ACCENT = new THREE.Color(0x73dceb);
// Additive glow that leaves the canvas alpha untouched (the canvas is composited over the page).
const GLOW = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
};
const MAX_HOPS = 7;
const MAX_WAVES = 6;
const WAVE_LIFETIME = 5;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * A faint layered network beneath the board. Each move sends a short pulse
 * outward (breadth-first over the graph) from the source and target squares.
 */
export function createNeural({ layerY = -1.1, layers = 3, spread = 8.5, spacing = 1.25 } = {}) {
  const rand = rng(20241026);
  const pos = [];
  const base = [];
  const per = Math.round((spread * 2) / spacing) + 1;
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < per; i++) {
      for (let j = 0; j < per; j++) {
        const x = -spread + i * spacing + (rand() - 0.5) * spacing * 0.6;
        const z = -spread + j * spacing + (rand() - 0.5) * spacing * 0.6;
        const y = layerY - l * 0.85 + (rand() - 0.5) * 0.15;
        pos.push(x, y, z);
        const r = Math.hypot(x, z) / (spread * 1.25);
        base.push(Math.max(0, 1 - r) ** 2 * (l === 0 ? 0.2 : 0.12));
      }
    }
  }
  const n = pos.length / 3;

  // Edges: each node links to its few nearest neighbours.
  const adj = Array.from({ length: n }, () => []);
  const seen = new Set();
  const edges = [];
  for (let a = 0; a < n; a++) {
    const near = [];
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const d = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
      if (d < 2) near.push([d, b]);
    }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, b] of near.slice(0, 4)) {
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
      adj[a].push(b);
      adj[b].push(a);
    }
  }

  const nodeColors = new Float32Array(n * 3);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3));
  const dot = dotTexture();
  const nodeMat = new THREE.PointsMaterial({
    size: 0.2, map: dot, vertexColors: true, transparent: true, depthWrite: false, ...GLOW,
  });

  const edgePos = new Float32Array(edges.length * 3);
  edges.forEach((v, i) => {
    edgePos[i * 3] = pos[v * 3];
    edgePos[i * 3 + 1] = pos[v * 3 + 1];
    edgePos[i * 3 + 2] = pos[v * 3 + 2];
  });
  const edgeColors = new Float32Array(edges.length * 3);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, ...GLOW,
  });

  const group = new THREE.Group();
  group.add(new THREE.LineSegments(edgeGeo, edgeMat), new THREE.Points(nodeGeo, nodeMat));

  // Hop distance from each board square's nearest top-layer node.
  const hopsBySquare = {};
  const bfs = (src) => {
    const hops = new Int16Array(n).fill(-1);
    hops[src] = 0;
    const queue = [src];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      if (hops[u] >= MAX_HOPS) continue;
      for (const v of adj[u]) if (hops[v] < 0) { hops[v] = hops[u] + 1; queue.push(v); }
    }
    return hops;
  };
  const hopsFor = (square) => {
    if (hopsBySquare[square]) return hopsBySquare[square];
    const x = square.charCodeAt(0) - 97 - 3.5;
    const z = 3.5 - (Number(square[1]) - 1);
    let best = 0, bd = Infinity;
    for (let i = 0; i < per * per; i++) {
      const d = (pos[i * 3] - x) ** 2 + (pos[i * 3 + 2] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return (hopsBySquare[square] = bfs(best));
  };

  const waves = [];
  const intensity = new Float32Array(n);
  let activity = 0;

  function write() {
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, base[i] + intensity[i]);
      nodeColors[i * 3] = ACCENT.r * v;
      nodeColors[i * 3 + 1] = ACCENT.g * v;
      nodeColors[i * 3 + 2] = ACCENT.b * v;
    }
    for (let e = 0; e < edges.length; e++) {
      const i = edges[e];
      const v = Math.min(1, base[i] * 0.55 + intensity[i] * 0.9);
      edgeColors[e * 3] = ACCENT.r * v;
      edgeColors[e * 3 + 1] = ACCENT.g * v;
      edgeColors[e * 3 + 2] = ACCENT.b * v;
    }
    nodeGeo.attributes.color.needsUpdate = true;
    edgeGeo.attributes.color.needsUpdate = true;
  }
  write();

  return {
    group,
    /** Smoothed 0..1 overall activity, for subtle glow elsewhere. */
    get activity() { return activity; },
    pulse(square, now, delay = 0) {
      if (waves.length >= MAX_WAVES) waves.shift();
      waves.push({ start: now + delay, hops: hopsFor(square) });
    },
    clear() { waves.length = 0; },
    update(now) {
      for (let w = waves.length - 1; w >= 0; w--) if (now - waves[w].start > WAVE_LIFETIME) waves.splice(w, 1);
      intensity.fill(0);
      let total = 0;
      for (const { start, hops } of waves) {
        const age = now - start;
        if (age < 0) continue;
        for (let i = 0; i < n; i++) {
          const h = hops[i];
          if (h < 0) continue;
          const x = age - h * 0.09;
          if (x <= 0) continue;
          const v = (x / 0.18) * Math.exp(1 - x / 0.18) * Math.exp(-x * 0.7) * (1 - h / (MAX_HOPS + 1));
          intensity[i] += v * 0.9;
        }
        total += Math.exp(-age * 1.2);
      }
      activity += (Math.min(1, total) - activity) * 0.2;
      write();
    },
    dispose() {
      nodeGeo.dispose(); edgeGeo.dispose(); nodeMat.dispose(); edgeMat.dispose(); dot.dispose();
    },
  };
}
