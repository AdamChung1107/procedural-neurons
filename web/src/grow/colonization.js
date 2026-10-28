// Space colonization (Runions, Lane & Prusinkiewicz 2007), the algorithm behind
// procedural trees and leaf veins, applied to dendrites and axons.
//
// Scatter attractor points in an envelope the neurite should fill. Growth
// happens only at tips, as in real neurites, which extend and branch at their
// growth cones. Every round, each attractor pulls on the nearest tip within the
// influence radius, if it lies inside that tip's perception cone (ahead of it).
// A tip steps toward the mean pull, or splits in two when its attractors fall
// into two groups more than `split` radians apart. A tip with nothing ahead
// stops. Attractors within the kill radius of new growth are consumed.
//
// The classic version lets any node sprout; on neurons that fills the envelope
// with short side twigs (archive/colonization-classic/).
//
// Envelopes: basal = a sphere around (and a little below) the soma; apical = a
// shaft up to the pia plus a tuft; axon = an ellipsoid below the soma.
// Attractor-to-tip queries go through uniform-grid spatial hashes.

import { Grid } from "../spatial/grid.js";
import { TreeBuilder } from "../tree.js";
import { dot, fromSpherical, normalize } from "../vec.js";
import { AXIS, NEURITES, finish, spreadAzimuths } from "./common.js";

const MAX_ROUNDS = 1500;
const MAX_NODES = 400_000;
const CONE = Math.cos((80 * Math.PI) / 180); // a tip feels attractors within 80° of its heading

export const colonization = {
  id: "colonization",
  label: "Space colonization",
  short: "Colonization",
  defaults: {
    "basal.trunks": 5, "basal.attractors": 1200, "basal.radius": 180, "basal.drop": 0.3,
    "basal.influence": 40, "basal.kill": 12, "basal.split": 0.6,
    "apical.attractors": 1200, "apical.height": 650, "apical.shaft": 60, "apical.tuft": 200,
    "apical.tuftShare": 0.4, "apical.influence": 50, "apical.kill": 14, "apical.split": 0.6,
    "axon.attractors": 1500, "axon.depth": 500, "axon.width": 350, "axon.influence": 70, "axon.kill": 16,
    "axon.split": 0.6,
    step: 3, jitter: 0.15,
  },
  box: {
    "basal.trunks": [3, 8], "basal.attractors": [100, 3000], "basal.radius": [60, 350], "basal.drop": [0, 0.8],
    "basal.influence": [15, 120], "basal.kill": [4, 40], "basal.split": [0.2, 1.4],
    "apical.attractors": [100, 3000], "apical.height": [250, 1200], "apical.shaft": [10, 200],
    "apical.tuft": [40, 400], "apical.tuftShare": [0, 0.9], "apical.influence": [15, 150], "apical.kill": [4, 40],
    "apical.split": [0.2, 1.4],
    "axon.attractors": [100, 4000], "axon.depth": [100, 1500], "axon.width": [50, 800],
    "axon.influence": [15, 200], "axon.kill": [4, 50], "axon.split": [0.2, 1.4],
  },
  controls: ["basal.attractors", "basal.split", "apical.tuftShare", "apical.height"],

  grow(params, rng, real, kinds = ["basal", "apical", "axon"]) {
    const somaR = rng.fork("soma").quantile(real.soma_radius);
    const b = new TreeBuilder(somaR);
    for (const [name, kind] of NEURITES) {
      if (!kinds.includes(name)) continue;
      const r = rng.fork(name), P = (k) => params[`${name}.${k}`];
      const attractors = scatter(name, P, r, somaR);
      const roots = [];
      const trunks = name === "basal" ? Math.round(P("trunks")) : 1, azimuths = spreadAzimuths(r, trunks);
      for (let t = 0; t < trunks; t++) {
        const d = name === "basal" ? fromSpherical(Math.acos(r.uniform(-1, 0.5)), azimuths[t])
          : AXIS[name];
        roots.push({ node: b.add([d[0] * somaR, d[1] * somaR, d[2] * somaR], 0, kind), d });
      }
      colonize(b, kind, roots, attractors, P("influence"), P("kill"), P("split"), params.step, params.jitter, r);
    }
    return finish(b.build(), real, rng.fork("radius"));
  },
};

function scatter(name, P, r, somaR) {
  const n = Math.round(P("attractors")), pts = [];
  const inBall = () => { for (;;) { const p = [r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)]; if (p[0] ** 2 + p[1] ** 2 + p[2] ** 2 <= 1) return p; } };
  while (pts.length < n) {
    let p;
    if (name === "basal") {
      const u = inBall(), R = P("radius");
      p = [u[0] * R, u[1] * R - P("drop") * R, u[2] * R];
    } else if (name === "apical") {
      if (r.random() < P("tuftShare")) {
        const u = inBall(), T = P("tuft");
        p = [u[0] * T, P("height") + u[1] * T * 0.4, u[2] * T];
      } else {
        const t = r.uniform(0, 2 * Math.PI), s = P("shaft") * Math.sqrt(r.random());
        p = [s * Math.cos(t), r.uniform(somaR, P("height")), s * Math.sin(t)];
      }
    } else {
      const u = inBall(), D = P("depth");
      p = [u[0] * P("width"), -D / 2 + u[1] * D / 2, u[2] * P("width")];
    }
    if (Math.hypot(p[0], p[1], p[2]) > somaR * 1.5) pts.push(p);
  }
  return pts;
}

// Grows from the root tips until no tip has attractors ahead. A round only
// visits the attractors within reach of some tip (grid query per tip), and
// gives each to its nearest tip, so its cost follows the growing front, not
// the whole envelope.
function colonize(b, kind, roots, attractors, influence, kill, split, step, jitter, r) {
  const alive = new Grid(influence), live = new Set();
  attractors.forEach((p, i) => { alive.insert(i, p); live.add(i); });
  const advance = (tip, d) => {
    const p = b.point(tip.node);
    const node = b.add([p[0] + step * d[0], p[1] + step * d[1], p[2] + step * d[2]], tip.node, kind);
    const hit = []; // collect first: remove() edits the buckets near() is walking
    alive.near(b.point(node), kill, (i) => hit.push(i));
    for (const i of hit) { live.delete(i); alive.remove(i, attractors[i]); }
    return { node, d };
  };

  // Trunks first grow straight until some attractor is within reach and ahead.
  // (Any attractor in reach is not enough: one beside or behind the trunk is
  // outside its perception cone, so the trunk would stop at once.)
  const ahead = (tip) => {
    const p = b.point(tip.node);
    let seen = false;
    alive.near(p, influence, (i, a) => {
      if (!seen) seen = dot(normalize([a[0] - p[0], a[1] - p[1], a[2] - p[2]]), tip.d) >= CONE;
    });
    return seen;
  };
  let tips = roots.map((root) => {
    let tip = root;
    for (let k = 0; k < 200 && !ahead(tip); k++) tip = advance(tip, tip.d);
    return tip;
  });

  for (let round = 0; round < MAX_ROUNDS && tips.length && live.size; round++) {
    const owner = new Map(); // attractor -> [nearest tip, distance^2]
    tips.forEach((t, j) => alive.near(b.point(t.node), influence, (i, a, d2) => {
      const o = owner.get(i);
      if (!o || d2 < o[1]) owner.set(i, [j, d2]);
    }));
    const pulls = tips.map(() => []);
    for (const [i, [j]] of owner) {
      const a = attractors[i], p = b.point(tips[j].node);
      const v = normalize([a[0] - p[0], a[1] - p[1], a[2] - p[2]]);
      if (dot(v, tips[j].d) >= CONE) pulls[j].push(v);
    }
    const next = [];
    tips.forEach((tip, j) => {
      if (!pulls[j].length) return; // nothing ahead: the branch ends here
      for (const d of headings(pulls[j], split)) {
        next.push(advance(tip, normalize([d[0] + jitter * r.normal(), d[1] + jitter * r.normal(), d[2] + jitter * r.normal()])));
      }
    });
    if (b.size > MAX_NODES) throw new Error("growth did not terminate");
    tips = next;
  }
}

// Where a tip goes next: the mean pull, or two headings when its attractors
// fall into two groups whose mean directions are more than `split` radians
// apart. The groups come from one two-means pass, seeded with the direction
// farthest from the mean and the one farthest from that.
function headings(pulls, split) {
  const mean = normalize(sum(pulls));
  if (pulls.length >= 4) {
    const a = farthest(pulls, mean), b = farthest(pulls, a), A = [], B = [];
    for (const v of pulls) (dot(v, a) >= dot(v, b) ? A : B).push(v);
    if (A.length >= 2 && B.length >= 2) {
      const ma = normalize(sum(A)), mb = normalize(sum(B));
      if (Math.acos(Math.min(1, dot(ma, mb))) > split) return [ma, mb];
    }
  }
  return [mean];
}

const sum = (vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const farthest = (vs, from) => vs.reduce((best, v) => (dot(v, from) < dot(best, from) ? v : best));
