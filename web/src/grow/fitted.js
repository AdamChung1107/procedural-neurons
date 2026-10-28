// Data-driven growth: a branching process that samples its decisions from
// distributions measured on real human cells (web/data/real_cells.json).
//
// For each section: decide to bifurcate with the measured probability for its
// branch order (main lineage and side branches have their own tables), draw its
// length from the internal or terminal length distribution by inverse CDF, walk
// it as a persistent random walk, then split by a sampled bifurcation angle.
// Only wander, persist and pull are free parameters; everything else is measured.
// Trunks spread evenly around the soma in azimuth.

import { TreeBuilder } from "../tree.js";
import { dot, fromSpherical, perpendicular, rotate } from "../vec.js";
import { AXIS, NEURITES, extend, finish, spreadAzimuths } from "./common.js";

const MAX_NODES = 400_000;

export const fitted = {
  id: "fitted",
  label: "Data-fitted branching process",
  short: "Data-fitted",
  defaults: {
    "basal.wander": 0.18, "apical.wander": 0.14, "axon.wander": 0.12,
    "basal.persist": 0.5, "apical.persist": 0.5, "axon.persist": 0.5,
    "apical.pull": 0.03, "axon.pull": 0.0,
  },
  box: {
    "basal.wander": [0.02, 0.5], "apical.wander": [0.02, 0.5], "axon.wander": [0.02, 0.5],
    "basal.persist": [0, 0.95], "apical.persist": [0, 0.95], "axon.persist": [0, 0.95],
    "apical.pull": [0, 0.15], "axon.pull": [0, 0.15],
  },
  controls: ["apical.pull", "basal.wander", "apical.wander", "basal.persist", "apical.persist"],

  grow(params, rng, real, kinds = ["basal", "apical", "axon"]) {
    const somaR = rng.fork("soma").quantile(real.soma_radius);
    const b = new TreeBuilder(somaR);
    for (const [name, kind] of NEURITES) {
      if (!kinds.includes(name)) continue;
      const s = real.neurites[name], r = rng.fork(name), axis = AXIS[name];
      const wander = params[`${name}.wander`], pull = params[`${name}.pull`] ?? 0, persist = params[`${name}.persist`];
      const trunks = Math.max(1, Math.round(r.quantile(s.trunks))), azimuths = spreadAzimuths(r, trunks);
      for (let t = 0; t < trunks; t++) {
        const d0 = fromSpherical(r.quantile(s.trunk_elevation), azimuths[t]);
        const root = b.add([d0[0] * somaR, d0[1] * somaR, d0[2] * somaR], 0, kind);
        const stack = [{ from: root, d: d0, order: 0, main: axis !== null }];
        while (stack.length) {
          const { from, d, order, main } = stack.pop();
          const table = main ? s.p_bifurcate_main : s.p_bifurcate;
          const splits = r.random() < (order < table.length ? table[order] : 0);
          const length = r.quantile(splits ? s.internal_length : s.terminal_length);
          const end = extend(b, from, d, length, kind, r, wander, axis, main ? pull : 0, persist);
          if (b.size > MAX_NODES) throw new Error("growth did not terminate");
          if (!splits) continue;
          const half = r.quantile(s.bifurcation_angle) / 2;
          const kids = [rotate(end.d, perpendicular(end.d), half), rotate(end.d, perpendicular(end.d), -half)];
          // Spin the split plane randomly about the parent heading.
          const spin = r.uniform(0, 2 * Math.PI);
          const dirs = kids.map((k) => rotate(k, end.d, spin));
          const mainKid = main ? (dot(dirs[0], axis) >= dot(dirs[1], axis) ? 0 : 1) : -1;
          dirs.forEach((k, i) => stack.push({ from: end.node, d: k, order: order + 1, main: i === mainKid }));
        }
      }
    }
    return finish(b.build(), real, rng.fork("radius"));
  },
};
