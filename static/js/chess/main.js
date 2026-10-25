import * as THREE from 'three';
import { Chess } from 'chess.js';
import { GAME } from './game.js';
import { createPieceFactory } from './pieces.js';
import { createNeural } from './neural.js';

const ACCENT = 0x73dceb;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const sqPos = (sq, y = 0) => new THREE.Vector3(sq.charCodeAt(0) - 97 - 3.5, y, 3.5 - (Number(sq[1]) - 1));

const START_DELAY = 1.4; // before the first move
const MOVE_GAP = 0.45;   // rest between moves
const END_HOLD = 3.5;    // linger on the final position
const FADE = 0.9;

export function mount(root) {
  const canvas = root.querySelector('canvas');
  const captionEl = root.querySelector('[data-chess-caption]');
  const playBtn = root.querySelector('[data-chess-play]');
  const replayBtn = root.querySelector('[data-chess-replay]');

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const debug = params.has('chessdebug');
  const speed = debug ? Number(params.get('speed')) || 1 : 1; // test hook: fast-forward playback

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('WebGL unavailable, using static fallback.', e);
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Quality tiers; stepped down automatically when frames run slow.
  const tiers = [
    { dpr: 1, shadow: 512 },
    { dpr: 1.5, shadow: 1024 },
    { dpr: 2, shadow: 2048 },
  ];
  let tier = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 1 : 2;

  // ---- scene ----
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const lookAt = new THREE.Vector3(0, -0.6, 0);

  scene.add(new THREE.HemisphereLight(0x8fb0d8, 0x0b0f18, 0.7));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(-5, 11, 7);
  key.castShadow = true;
  key.shadow.camera.left = key.shadow.camera.bottom = -6.5;
  key.shadow.camera.right = key.shadow.camera.top = 6.5;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(ACCENT, 1.1);
  rim.position.set(6, 4, -8);
  scene.add(rim);

  // ---- board ----
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const lightSq = new THREE.MeshStandardMaterial({ color: 0xd8d0bd, roughness: 0.55 });
  const darkSq = new THREE.MeshStandardMaterial({ color: 0x3b414d, roughness: 0.5 });
  const sqGeo = new THREE.BoxGeometry(1, 0.16, 1);
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const m = new THREE.Mesh(sqGeo, (f + r) % 2 === 0 ? darkSq : lightSq);
      m.position.set(f - 3.5, -0.08, 3.5 - r);
      m.receiveShadow = true;
      boardGroup.add(m);
    }
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x151b27, roughness: 0.6, metalness: 0.2 });
  const frameGeo = new THREE.BoxGeometry(8.7, 0.34, 8.7);
  const slab = new THREE.Mesh(frameGeo, frameMat);
  slab.position.y = -0.33;
  slab.receiveShadow = true;
  boardGroup.add(slab);
  const edgeLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(frameGeo),
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.25 }),
  );
  edgeLines.position.copy(slab.position);
  boardGroup.add(edgeLines);

  // Last-move highlights (from / to).
  const hlGeo = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
  const highlights = [0, 1].map(() => {
    const h = new THREE.Mesh(
      hlGeo,
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }),
    );
    h.position.y = 0.006;
    boardGroup.add(h);
    return h;
  });

  const neural = createNeural();
  scene.add(neural.group);

  // ---- pieces ----
  const factory = createPieceFactory();
  const piecesGroup = new THREE.Group();
  scene.add(piecesGroup);
  let chess = new Chess();
  let pieces = new Map(); // square -> piece object

  function populate() {
    piecesGroup.clear();
    pieces = new Map();
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p) continue;
        const obj = factory.create(p.type, p.color);
        obj.position.copy(sqPos(p.square));
        piecesGroup.add(obj);
        pieces.set(p.square, obj);
      }
    }
  }

  function consistent() {
    let count = 0;
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p) continue;
        const o = pieces.get(p.square);
        if (!o || o.userData.type !== p.type || o.userData.color !== p.color) return false;
        count++;
      }
    }
    return count === pieces.size;
  }

  // ---- playback state ----
  let playing = !reduceMotion.matches;
  let clock = 0;      // playback time; only advances while playing
  let now = 0;        // real time, drives the network glow
  let phase = 'wait'; // wait | move | fadeOut | fadeIn
  let phaseEnd = START_DELAY;
  let moveIndex = 0;
  let anim = null;
  let fade = 1;

  const setCaption = (text) => { if (captionEl) captionEl.textContent = text; };
  const idleCaption = () => setCaption(`${GAME.title} · ${GAME.subtitle}`);
  idleCaption();

  function syncButtons() {
    playBtn.setAttribute('aria-label', playing ? 'Pause playback' : 'Play');
    playBtn.dataset.state = playing ? 'playing' : 'paused';
    playBtn.querySelector('[data-label]').textContent = playing ? 'Pause' : 'Play';
  }

  function setOpacity(o) {
    for (const m of Object.values(factory.materials)) {
      m.transparent = o < 1;
      m.opacity = o;
    }
  }

  function resetGame(startPhase, delay) {
    chess = new Chess();
    moveIndex = 0;
    anim = null;
    neural.clear();
    highlights.forEach((h) => { h.material.opacity = 0; h.userData.t = undefined; });
    populate();
    idleCaption();
    phase = startPhase;
    phaseEnd = clock + delay;
  }

  function startMove() {
    const m = chess.move(GAME.moves[moveIndex]);
    const mover = pieces.get(m.from);
    const tweens = [];
    let captured = null;

    const dist = Math.hypot(m.to.charCodeAt(0) - m.from.charCodeAt(0), Number(m.to[1]) - Number(m.from[1]));
    const knight = m.piece === 'n';
    const dur = clamp(0.75 + 0.1 * (knight ? 2.2 : dist), 0.8, 1.4);
    tweens.push({ obj: mover, from: sqPos(m.from), to: sqPos(m.to), lift: knight ? 1.25 : 0.7, dur });

    if (m.flags.includes('e')) {
      const sq = m.to[0] + m.from[1];
      captured = pieces.get(sq);
      pieces.delete(sq);
    } else if (m.captured) {
      captured = pieces.get(m.to);
    }
    pieces.delete(m.from);

    if (m.flags.includes('k') || m.flags.includes('q')) {
      const rank = m.from[1];
      const [rf, rt] = m.flags.includes('k') ? ['h', 'f'] : ['a', 'd'];
      const rook = pieces.get(rf + rank);
      pieces.delete(rf + rank);
      pieces.set(rt + rank, rook);
      tweens.push({ obj: rook, from: sqPos(rf + rank), to: sqPos(rt + rank), lift: 0.45, dur });
    }
    pieces.set(m.to, mover);

    anim = { t: 0, dur, tweens, captured, move: m };
    phase = 'move';

    const num = Math.floor(moveIndex / 2) + 1;
    setCaption(`${num}${m.color === 'w' ? '.' : '…'} ${m.san}  ·  ${GAME.title}`);
    neural.pulse(m.from, now);
    neural.pulse(m.to, now, dur * 0.8);
    highlights[0].position.copy(sqPos(m.from, 0.006));
    highlights[1].position.copy(sqPos(m.to, 0.006));
    highlights.forEach((h) => { h.userData.t = 0; });
  }

  function finishMove() {
    const { move: m, captured } = anim;
    if (captured) piecesGroup.remove(captured);
    if (m.promotion) {
      piecesGroup.remove(pieces.get(m.to));
      const promoted = factory.create(m.promotion, m.color);
      promoted.position.copy(sqPos(m.to));
      piecesGroup.add(promoted);
      pieces.set(m.to, promoted);
    }
    anim = null;
    if (!consistent()) {
      console.warn('Board/chess.js mismatch; resyncing.');
      root.dataset.mismatch = String(Number(root.dataset.mismatch || 0) + 1);
      populate();
    }
    moveIndex++;
    if (debug) root.dataset.plies = String(Number(root.dataset.plies || 0) + 1);
    phase = 'wait';
    phaseEnd = clock + (moveIndex >= GAME.moves.length ? END_HOLD : MOVE_GAP);
  }

  function stepAnim(dt) {
    anim.t += dt;
    const { tweens, captured, dur } = anim;
    for (const tw of tweens) {
      const p = clamp(anim.t / tw.dur);
      const e = easeInOut(p);
      tw.obj.position.set(
        tw.from.x + (tw.to.x - tw.from.x) * e,
        tw.lift * Math.sin(Math.PI * p) ** 1.2,
        tw.from.z + (tw.to.z - tw.from.z) * e,
      );
    }
    if (captured) {
      const q = clamp((anim.t / dur - 0.62) / 0.3);
      captured.scale.setScalar(Math.max(1 - easeInOut(q), 0.001));
      captured.position.y = 0.25 * q;
    }
    if (anim.t >= dur) finishMove();
  }

  function tickPlayback(dt) {
    clock += dt;
    if (phase === 'move') {
      stepAnim(dt);
    } else if (phase === 'wait' && clock >= phaseEnd) {
      if (moveIndex < GAME.moves.length) {
        startMove();
      } else {
        phase = 'fadeOut';
        phaseEnd = clock + FADE;
      }
    } else if (phase === 'fadeOut') {
      fade = clamp((phaseEnd - clock) / FADE);
      setOpacity(easeInOut(fade));
      if (clock >= phaseEnd) {
        resetGame('fadeIn', FADE);
        fade = 0;
        setOpacity(0);
      }
    } else if (phase === 'fadeIn') {
      fade = 1 - clamp((phaseEnd - clock) / FADE);
      setOpacity(easeInOut(fade));
      if (clock >= phaseEnd) {
        setOpacity(1);
        phase = 'wait';
        phaseEnd = clock + 1.2;
      }
    }
  }

  // ---- controls ----
  function setPlaying(v) {
    playing = v;
    syncButtons();
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  replayBtn.addEventListener('click', () => {
    setOpacity(1);
    fade = 1;
    resetGame('wait', 0.5);
    setPlaying(true);
  });
  const onReduce = () => { if (reduceMotion.matches) setPlaying(false); };
  reduceMotion.addEventListener('change', onReduce);

  // ---- camera / resize ----
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const onPointer = (e) => {
    if (e.pointerType !== 'mouse' || reduceMotion.matches) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  };
  addEventListener('pointermove', onPointer, { passive: true });

  let size = { w: 0, h: 0 };
  function applyQuality() {
    const t = tiers[tier];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, t.dpr));
    key.shadow.mapSize.set(t.shadow, t.shadow);
    key.shadow.map?.dispose();
    key.shadow.map = null;
    renderer.setSize(size.w, size.h, false);
  }
  function resize() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === size.w && h === size.h) return;
    size = { w, h };
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyQuality();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);

  const dir = new THREE.Vector3();
  function placeCamera() {
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(7.2 / (tanV * camera.aspect), 5.4 / tanV);
    const az = -0.32 + pointer.sx * 0.07;
    const el = 0.78 - pointer.sy * 0.04;
    dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(lookAt).addScaledVector(dir, dist);
    camera.lookAt(lookAt);
  }

  // ---- loop ----
  let raf = 0, last = performance.now(), visible = true, slow = 0, frames = 0, ready = false;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000) * speed;
    last = t;
    now += dt;
    if (playing) tickPlayback(dt);

    for (const h of highlights) {
      if (h.userData.t === undefined) continue;
      h.userData.t += dt;
      h.material.opacity = 0.32 * Math.exp(-h.userData.t * 0.8) * (phase === 'fadeOut' ? fade : 1);
    }
    neural.update(now);
    edgeLines.material.opacity = 0.2 + neural.activity * 0.45;
    placeCamera();
    renderer.render(scene, camera);

    if (!ready) { ready = true; root.classList.add('is-ready'); }
    slow += dt > 0.034 ? 1 : 0;
    if (++frames === 90) {
      if (slow > 30 && tier > 0) { tier--; applyQuality(); }
      slow = frames = 0;
    }
  }
  function start() {
    if (raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); });
  io.observe(root);
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);

  // ---- boot ----
  populate();
  syncButtons();
  resize();
  start();

  function destroy() {
    stop();
    io.disconnect();
    ro.disconnect();
    removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVis);
    reduceMotion.removeEventListener('change', onReduce);
    factory.dispose();
    neural.dispose();
    [lightSq, darkSq, sqGeo, frameMat, frameGeo, hlGeo, ...highlights.map((h) => h.material), edgeLines.geometry, edgeLines.material]
      .forEach((x) => x.dispose());
    renderer.dispose();
  }
  addEventListener('pagehide', (e) => { if (!e.persisted) destroy(); });

  if (debug) window.__chess = { get chess() { return chess; }, pieces: () => pieces, consistent };
  return { destroy };
}
