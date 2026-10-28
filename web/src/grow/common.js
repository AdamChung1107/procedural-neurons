// Pieces shared by the three growth algorithms.

import { APICAL, AXON, BASAL, assignRadii } from "../tree.js";
import { normalize } from "../vec.js";

export const STEP_UM = 2;
export const NEURITES = [["basal", BASAL], ["apical", APICAL], ["axon", AXON]];
export const AXIS = { basal: null, apical: [0, 1, 0], axon: [0, -1, 0] };

// Azimuths for n stems around the soma: one per equal sector, jittered within
// it, the whole set turned at random. Real basal stems spread out; independent
// azimuths often bunch them on one side.
export function spreadAzimuths(rng, n) {
  const turn = rng.uniform(0, 2 * Math.PI);
  return Array.from({ length: n }, (_, t) => turn + ((t + rng.uniform(0.2, 0.8)) * 2 * Math.PI) / n);
}

// One step of a random walk: turn the heading by w, optionally pull it toward
// an axis, renormalise.
export function steer(d, w, axis = null, pull = 0) {
  let h = [d[0] + w[0], d[1] + w[1], d[2] + w[2]];
  if (pull && axis) {
    h = normalize(h);
    h = [h[0] * (1 - pull) + pull * axis[0], h[1] * (1 - pull) + pull * axis[1], h[2] * (1 - pull) + pull * axis[2]];
  }
  return normalize(h);
}

// Lay down `length` µm from node `from` as a chain of STEP_UM nodes; returns the
// last node and the final heading. The turn per step is an AR(1) process: each
// step keeps `persist` of the previous turn and adds fresh noise, scaled so the
// turn's spread stays `wander`. persist = 0 is independent jitter every step;
// near 1 the branch bends in smooth arcs instead of kinking every 2 µm.
export function extend(b, from, d, length, kind, rng, wander, axis = null, pull = 0, persist = 0) {
  const n = Math.max(1, Math.ceil(length / STEP_UM)), step = length / n;
  const fresh = wander * Math.sqrt(1 - persist * persist);
  let p = b.point(from), node = from, w = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    w = [persist * w[0] + fresh * rng.normal(), persist * w[1] + fresh * rng.normal(), persist * w[2] + fresh * rng.normal()];
    d = steer(d, w, axis, pull);
    p = [p[0] + step * d[0], p[1] + step * d[1], p[2] + step * d[2]];
    node = b.add(p, node, kind);
  }
  return { node, d };
}

// Radii from the measured tip and trunk sizes of real cells. Each cell draws
// its trunk radius per neurite type from the measured distribution (never
// thinner than a tip), so trunks vary from cell to cell as real ones do.
export function finish(tree, real, rng) {
  const tip = {}, trunk = {};
  for (const [name, kind] of NEURITES) {
    const s = real.neurites[name];
    tip[kind] = s.tip_radius;
    trunk[kind] = Math.max(rng.fork(name).quantile(s.trunk_radius), s.tip_radius);
  }
  return assignRadii(tree, tip, trunk);
}
