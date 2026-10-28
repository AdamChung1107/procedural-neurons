// Geometry for three.js: skeletons as tubes or lines. Browser only (imports three).

import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

import { APICAL, AXON, BASAL, childCounts, sections } from "./tree.js";

export const COLORS = { [BASAL]: 0x6fb7c9, [APICAL]: 0x9bd3a6, [AXON]: 0xe0a36c, soma: 0xa9c2b6 };
const RADIAL = 8;
const SOMA_BLEND = 3; // trunks fade from the soma's colour to their own over this many soma radii

// Tube radius for a skeleton radius: real scale, with a floor so fine tips stay visible.
const TUBE = { scale: 1, min: 0.5 };
const tubeRadius = (r) => Math.max(r * TUBE.scale, TUBE.min);

// Two passes of [1 2 1] smoothing with fixed ends. Drawing only: it takes the
// 2 µm zig-zag out of the walk without moving the skeleton the metrics use.
function smooth(pts) {
  for (let pass = 0; pass < 2; pass++)
    pts = pts.map((p, k) => (k === 0 || k === pts.length - 1 ? p
      : p.clone().multiplyScalar(2).add(pts[k - 1]).add(pts[k + 1]).multiplyScalar(0.25)));
  return pts;
}

// Tubes swept along each unbranched section with parallel-transport frames:
// the frame is carried from one ring to the next by the smallest rotation that
// maps the old tangent onto the new one, so tubes never twist or pinch. Each
// section tapers linearly from its own radius to its thickest child's, so the
// main line runs on without a step at branch points; tips get a cone cap.
export function tubes(tree) {
  const pos = [], col = [], idx = [];
  const P = (i) => new THREE.Vector3(tree.xyz[3 * i], tree.xyz[3 * i + 1], tree.xyz[3 * i + 2]);
  const kids = childCounts(tree), somaR = tree.radius[0], thickestChild = new Float64Array(tree.n);
  for (let i = 1; i < tree.n; i++) thickestChild[tree.parent[i]] = Math.max(thickestChild[tree.parent[i]], tree.radius[i]);
  const fromSoma = new Float64Array(tree.n);
  for (let i = 1; i < tree.n; i++) fromSoma[i] = fromSoma[tree.parent[i]] + P(i).distanceTo(P(tree.parent[i]));
  const somaColor = new THREE.Color(COLORS.soma), own = new THREE.Color(), color = new THREE.Color();
  for (const sec of sections(tree, [BASAL, APICAL, AXON])) {
    const pts = smooth(sec.map(P));
    if (pts.length < 2) continue;
    own.setHex(COLORS[tree.kind[sec[1]]]);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const L = cum[cum.length - 1] || 1, last = sec[sec.length - 1];
    const r0 = tubeRadius(tree.radius[sec[1]]), r1 = tubeRadius(kids[last] ? thickestChild[last] : tree.radius[last]);
    let t = pts[1].clone().sub(pts[0]).normalize();
    let n = new THREE.Vector3(0, 1, 0).cross(t);
    if (n.lengthSq() < 1e-6) n = new THREE.Vector3(1, 0, 0).cross(t);
    n.normalize();
    const base = pos.length / 3;
    pts.forEach((p, k) => {
      if (k > 0) {
        const t2 = (k < pts.length - 1 ? pts[k + 1].clone().sub(pts[k - 1]) : pts[k].clone().sub(pts[k - 1])).normalize();
        n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(t, t2));
        t = t2;
      }
      const b = t.clone().cross(n);
      const r = r0 + (r1 - r0) * (cum[k] / L);
      color.copy(somaColor).lerp(own, Math.min(1, (fromSoma[sec[0]] + cum[k]) / (SOMA_BLEND * somaR)));
      for (let j = 0; j < RADIAL; j++) {
        const a = (j / RADIAL) * Math.PI * 2;
        const off = n.clone().multiplyScalar(Math.cos(a) * r).add(b.clone().multiplyScalar(Math.sin(a) * r));
        pos.push(p.x + off.x, p.y + off.y, p.z + off.z);
        col.push(color.r, color.g, color.b);
      }
      if (k > 0) {
        const ra = base + (k - 1) * RADIAL, rb = base + k * RADIAL;
        for (let j = 0; j < RADIAL; j++) {
          const j2 = (j + 1) % RADIAL;
          idx.push(ra + j, rb + j, rb + j2, ra + j, rb + j2, ra + j2);
        }
      }
    });
    if (kids[last] === 0) {
      const tip = pts[pts.length - 1].clone().addScaledVector(t, r1), apex = pos.length / 3;
      const ring = base + (pts.length - 1) * RADIAL;
      pos.push(tip.x, tip.y, tip.z);
      col.push(color.r, color.g, color.b);
      for (let j = 0; j < RADIAL; j++) idx.push(ring + j, apex, ring + ((j + 1) % RADIAL));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })));
  group.add(soma(tree));
  return group;
}

// The soma as one smooth surface: a sphere smooth-unioned with tapered cones
// along the first stretch of every trunk. The apical cone is long, which gives
// the pyramidal teardrop; basal and axon stems get short flares. The surface is
// the zero set of a signed distance field, polygonised by marching cubes.
export function soma(tree, resolution = 48) {
  const R = tree.radius[0], xyz = (i) => [tree.xyz[3 * i], tree.xyz[3 * i + 1], tree.xyz[3 * i + 2]];
  const cones = []; // [a, b, ra, rb]: a round cone from a (radius ra) to b (radius rb)
  for (const sec of sections(tree, [BASAL, APICAL, AXON])) {
    if (sec[0] !== 0) continue;
    const apical = tree.kind[sec[1]] === APICAL;
    const reach = (apical ? 2.2 : 1.2) * R, r0 = (apical ? 0.9 : 0.5) * R, rEnd = tubeRadius(tree.radius[sec[1]]);
    const width = (s) => rEnd + (r0 - rEnd) * (1 - Math.min(1, s / reach)) ** 2;
    let a = xyz(0), s = 0;
    for (let k = 1; k < sec.length && s < reach; k++) {
      const b = xyz(sec[k]), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      cones.push([a, b, width(s), width(s + len)]);
      a = b;
      s += len;
    }
  }
  const sdf = (p) => {
    let d = Math.hypot(p[0], p[1], p[2]) - R;
    const k = 0.5 * R;
    for (const [a, b, ra, rb] of cones) {
      const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2 || 1)));
      const c = Math.hypot(pa[0] - h * ba[0], pa[1] - h * ba[1], pa[2] - h * ba[2]) - (ra + (rb - ra) * h);
      const m = Math.max(k - Math.abs(d - c), 0) / k; // polynomial smooth minimum
      d = Math.min(d, c) - m * m * k * 0.25;
    }
    return d;
  };

  let extent = R;
  for (const [a, b, ra, rb] of cones) extent = Math.max(extent, Math.hypot(...a) + ra, Math.hypot(...b) + rb);
  const H = extent * (1 + 6 / resolution); // half-width of the grid cube, with a margin of cells
  const mc = new MarchingCubes(resolution, new THREE.MeshStandardMaterial({ color: COLORS.soma, roughness: 0.6 }), false, false, 60000);
  mc.isolation = 0;
  // MarchingCubes maps grid index i to object coordinate (i - size/2) / (size/2) in [-1, 1].
  const o = tree.xyz, half = mc.halfsize, f = mc.field;
  for (let z = 0; z < mc.size; z++)
    for (let y = 0; y < mc.size; y++)
      for (let x = 0; x < mc.size; x++)
        f[x + y * mc.size + z * mc.size2] = -sdf([(x - half) / half * H, (y - half) / half * H, (z - half) / half * H]);
  mc.update();
  mc.position.set(o[0], o[1], o[2]);
  mc.scale.setScalar(H);
  return mc;
}

// One line segment per edge; cheaper than tubes.
export function lines(tree) {
  const pos = [], col = [], c = new THREE.Color();
  for (let i = 1; i < tree.n; i++) {
    const p = tree.parent[i];
    if (p === 0) continue;
    pos.push(tree.xyz[3 * p], tree.xyz[3 * p + 1], tree.xyz[3 * p + 2], tree.xyz[3 * i], tree.xyz[3 * i + 1], tree.xyz[3 * i + 2]);
    c.setHex(COLORS[tree.kind[i]]);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
}

export function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose());
  });
}
