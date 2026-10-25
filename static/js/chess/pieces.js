import * as THREE from 'three';

const SEG = 40;
const TAU = Math.PI * 2;

const lathe = (pts, phiStart = 0, phiLength = TAU, seg = SEG) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLength);

// Points of a circular arc in (radius, height) profile space.
const arc = (cx, cy, r, a0, a1, n = 10) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [Math.max(0, cx + r * Math.cos(a)), cy + r * Math.sin(a)];
  });

const BASE = [[0, 0], [0.38, 0], [0.4, 0.03], [0.4, 0.07], [0.36, 0.1], [0.31, 0.12], [0.3, 0.17]];

const collar = (y, r) => [[r - 0.04, y], [r, y + 0.02], [r, y + 0.05], [r - 0.04, y + 0.07]];

function buildGeometries() {
  const g = {};

  g.pawn = [lathe([
    ...BASE, [0.2, 0.22], [0.14, 0.36], [0.115, 0.5], ...collar(0.5, 0.21),
    [0.1, 0.62], ...arc(0, 0.76, 0.16, -0.95, Math.PI / 2, 12),
  ])];

  const rookBody = lathe([
    ...BASE, [0.25, 0.24], [0.2, 0.45], [0.2, 0.72], [0.3, 0.78], [0.3, 0.9], [0.22, 0.9], [0, 0.9],
  ]);
  const merlon = lathe([[0.2, 0.9], [0.31, 0.9], [0.31, 1.04], [0.2, 1.04]], 0, 0.42, 6);
  g.rook = [rookBody, ...[0, 1, 2, 3].map((i) => merlon.clone().rotateY((i * TAU) / 4 + 0.2))];
  merlon.dispose();

  g.bishop = [lathe([
    ...BASE, [0.2, 0.24], [0.12, 0.45], [0.11, 0.62], ...collar(0.62, 0.2),
    [0.11, 0.78], [0.17, 0.86], [0.2, 0.98], [0.16, 1.12], [0.08, 1.22], [0.03, 1.27],
    ...arc(0, 1.3, 0.05, -Math.PI / 2, Math.PI / 2, 6),
  ])];

  const crownBase = [
    ...BASE, [0.22, 0.26], [0.14, 0.5], [0.12, 0.72], ...collar(0.72, 0.22),
    [0.14, 0.88], [0.22, 1.0], [0.28, 1.14], [0.22, 1.16], [0.12, 1.12], [0, 1.1],
  ];
  const bead = new THREE.SphereGeometry(0.05, 10, 8).translate(0.27, 1.17, 0);
  g.queen = [
    lathe(crownBase),
    ...Array.from({ length: 8 }, (_, i) => bead.clone().rotateY((i * TAU) / 8)),
    new THREE.SphereGeometry(0.07, 12, 10).translate(0, 1.19, 0),
  ];
  bead.dispose();

  g.king = [
    lathe([
      ...BASE, [0.22, 0.26], [0.14, 0.5], [0.12, 0.78], ...collar(0.78, 0.23),
      [0.15, 0.95], [0.24, 1.08], [0.27, 1.22], [0.2, 1.3], [0.08, 1.31], [0, 1.31],
    ]),
    new THREE.BoxGeometry(0.09, 0.3, 0.09).translate(0, 1.46, 0),
    new THREE.BoxGeometry(0.24, 0.08, 0.09).translate(0, 1.48, 0),
  ];

  // Knight: lathe pedestal + extruded, bevelled horse-head silhouette.
  const s = new THREE.Shape();
  s.moveTo(-0.27, 0);
  s.lineTo(0.28, 0);
  s.bezierCurveTo(0.3, 0.2, 0.22, 0.3, 0.14, 0.4);
  s.bezierCurveTo(0.2, 0.42, 0.3, 0.4, 0.4, 0.42);
  s.lineTo(0.52, 0.5);
  s.lineTo(0.5, 0.6);
  s.bezierCurveTo(0.42, 0.66, 0.34, 0.72, 0.28, 0.8);
  s.lineTo(0.27, 0.98);
  s.lineTo(0.16, 0.86);
  s.bezierCurveTo(0.05, 0.95, -0.15, 0.9, -0.2, 0.66);
  s.bezierCurveTo(-0.28, 0.45, -0.3, 0.2, -0.27, 0);
  const head = new THREE.ExtrudeGeometry(s, {
    depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 10,
  });
  head.translate(0, 0, -0.12).translate(0, 0.2, 0);
  g.knight = [
    lathe([...BASE, [0.28, 0.2], [0.27, 0.24], [0, 0.24]]),
    head,
  ];

  return g;
}

export function createPieceFactory() {
  const geo = buildGeometries();
  const mat = {
    w: new THREE.MeshPhysicalMaterial({ color: 0xeee6d2, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    b: new THREE.MeshPhysicalMaterial({ color: 0x2b2f3a, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  };
  const names = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };

  return {
    materials: mat,
    create(type, color) {
      const group = new THREE.Group();
      for (const geometry of geo[names[type]]) {
        const mesh = new THREE.Mesh(geometry, mat[color]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      // Knights are turned so the profile silhouette reads from the camera.
      if (type === 'n') group.rotation.y = color === 'w' ? 0.5 : -0.5;
      group.userData = { type, color };
      return group;
    },
    dispose() {
      Object.values(geo).flat().forEach((g) => g.dispose());
      Object.values(mat).forEach((m) => m.dispose());
    },
  };
}
