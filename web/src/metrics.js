// Morphometrics with NeuroM's definitions, so generated cells can be scored
// against real ones measured in Python (tests/test_metrics_parity.py checks it).

import { APICAL, AXON, BASAL, SOMA, childCounts, sections } from "./tree.js";

export const SHOLL_RADII = [50, 100, 150, 200, 250, 300];
// Dendrite metrics are scored against held-out cells. Axons in slices are
// truncated, so axon metrics only serve as fitting targets.
export const DENDRITE_METRICS = [
  "basal_length", "basal_bifurcations", "basal_max_order",
  "apical_length", "apical_bifurcations", "apical_max_order",
  "basal_trunks", "apical_height", ...SHOLL_RADII.map((r) => `sholl_${r}`),
];
export const METRICS = [...DENDRITE_METRICS, "axon_length", "axon_depth"];

export function summary(tree) {
  const { n, xyz, parent, kind } = tree;
  const kids = childCounts(tree);
  const order = new Int32Array(n);
  const out = Object.fromEntries(METRICS.map((m) => [m, 0]));
  const name = { [BASAL]: "basal", [APICAL]: "apical", [AXON]: "axon" };
  const cx = xyz[0], cy = xyz[1], cz = xyz[2];
  const d2 = (i) => (xyz[3 * i] - cx) ** 2 + (xyz[3 * i + 1] - cy) ** 2 + (xyz[3 * i + 2] - cz) ** 2;
  let height = -Infinity, depth = -Infinity;

  for (let i = 1; i < n; i++) {
    const p = parent[i], k = name[kind[i]];
    if (kind[p] === SOMA) {
      order[i] = 0;
      if (kind[i] === BASAL) out.basal_trunks++;
    } else {
      order[i] = order[p] + (kids[p] >= 2 ? 1 : 0);
    }
    if (!k) continue;
    if (kind[i] === APICAL) height = Math.max(height, xyz[3 * i + 1]);
    if (kind[i] === AXON) depth = Math.max(depth, -xyz[3 * i + 1]);
    if (k !== "axon") {
      if (kids[i] === 2) out[`${k}_bifurcations`]++;
      out[`${k}_max_order`] = Math.max(out[`${k}_max_order`], order[i]);
    }
    if (kind[p] === SOMA) continue; // NeuroM neurites start at their first point
    out[`${k}_length`] += Math.hypot(xyz[3 * i] - xyz[3 * p], xyz[3 * i + 1] - xyz[3 * p + 1],
      xyz[3 * i + 2] - xyz[3 * p + 2]);
    if (k === "axon") continue;
    const a = d2(p), b = d2(i);
    for (const r of SHOLL_RADII) {
      const r2 = r * r;
      if ((a <= r2 && r2 <= b) || (b <= r2 && r2 <= a)) out[`sholl_${r}`]++;
    }
  }
  out.apical_height = height === -Infinity ? 0 : height;
  out.axon_depth = depth === -Infinity ? 0 : depth;
  return out;
}

// Linear-interpolated percentile, as numpy's default.
export function percentile(xs, q) {
  const s = [...xs].sort((a, b) => a - b), pos = (q / 100) * (s.length - 1);
  const i = Math.floor(pos), f = pos - i;
  return i + 1 < s.length ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

export const median = (xs) => percentile(xs, 50);

// How a set of generated cells compares with a real band {key: [p5, p50, p95]}.
export function score(rows, band) {
  const out = {};
  for (const [key, [lo, mid, hi]] of Object.entries(band)) {
    const v = rows.map((r) => r[key]);
    out[key] = {
      median: median(v), real: mid,
      inBand: v.filter((x) => x >= lo && x <= hi).length / v.length,
      medianInBand: median(v) >= lo && median(v) <= hi,
    };
  }
  return out;
}

// Straightness: chord / path length of every section at least 20 µm long. Not a
// NeuroM feature and not part of summary(): it mirrors measure_morphology.py,
// which stores the pooled median as real_cells.json neurites[type].contraction.
// A fitting target only.
export function contractions(tree, kind) {
  const P = (i) => [tree.xyz[3 * i], tree.xyz[3 * i + 1], tree.xyz[3 * i + 2]], out = [];
  for (const sec of sections(tree, [kind])) {
    const nodes = sec[0] === 0 ? sec.slice(1) : sec; // NeuroM sections start at the first neurite point
    let path = 0;
    for (let k = 1; k < nodes.length; k++) {
      const a = P(nodes[k - 1]), b = P(nodes[k]);
      path += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    if (path < 20) continue;
    const a = P(nodes[0]), b = P(nodes[nodes.length - 1]);
    out.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / path);
  }
  return out;
}

// Two-sample Kolmogorov–Smirnov distance: the largest gap between the two
// empirical CDFs. 0 means the same distribution, 1 means no overlap. Ties
// (integer metrics) step both CDFs together.
export function ks(a, b) {
  const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

// The KS distance above which two samples of sizes n and m differ at p < 0.05.
export const ksCritical = (n, m) => 1.358 * Math.sqrt((n + m) / (n * m));
