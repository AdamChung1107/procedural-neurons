// Benchmark: how close each algorithm's cells are to real held-out cells.
//
//   node web/tools/benchmark.mjs     re-score web/data/params.json (seconds); fit.mjs also calls it
//
// For every dendrite metric, the Kolmogorov–Smirnov distance between generated
// cells and held-out real cells. It compares whole distributions, so making
// every cell alike is penalised as much as being off-target. Reference: the
// same distance between training and held-out real cells, which is as close as
// a perfect generator can expect to get at these sample sizes. Each algorithm
// grows as many cells as there are training cells, so both comparisons have
// the same sample sizes.
//
// Metrics are split into those the fit targets (TYPE_METRICS) and those it
// never sees (the Sholl profile); the untargeted ones are the headline. The
// old score, the share of cells inside the held-out 5-95 % range, is kept
// for comparison.
//
// Writes web/data/benchmark.json.

import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ALGORITHMS } from "../src/grow/index.js";
import { DENDRITE_METRICS, ks, ksCritical, median, score, summary } from "../src/metrics.js";
import { Rng } from "../src/rng.js";
import { DATA, loadJSON } from "./data.mjs";

// What the fit matches, per neurite type.
export const TYPE_METRICS = {
  basal: ["basal_length", "basal_bifurcations", "basal_max_order", "basal_trunks"],
  apical: ["apical_length", "apical_bifurcations", "apical_max_order", "apical_height"],
  axon: ["axon_length", "axon_depth"],
};
const TARGETED = new Set(Object.values(TYPE_METRICS).flat());
const UNTARGETED = DENDRITE_METRICS.filter((m) => !TARGETED.has(m));

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const column = (rows, m) => rows.map((r) => r[m]);

// Mean distance over the untargeted and targeted metrics, and how many metrics
// are statistically indistinguishable from the held-out cells.
function distances(rows, real) {
  const crit = ksCritical(rows.length, real.heldout_rows.length);
  const perMetric = Object.fromEntries(DENDRITE_METRICS.map((m) =>
    [m, round(ks(column(rows, m), column(real.heldout_rows, m)), 3)]));
  return {
    perMetric,
    untargeted: round(mean(UNTARGETED.map((m) => perMetric[m])), 3),
    targeted: round(mean([...TARGETED].filter((m) => m in perMetric).map((m) => perMetric[m])), 3),
    indistinguishable: DENDRITE_METRICS.filter((m) => perMetric[m] <= crit).length,
  };
}

export function benchmark(algo, params, real, n) {
  const rows = [];
  let ms = 0, nodes = 0;
  for (let c = 0; c < n; c++) {
    const t0 = performance.now();
    const tree = algo.grow(params, new Rng(`bench/cell/${c}`), real);
    ms += performance.now() - t0;
    nodes += tree.n;
    rows.push(summary(tree));
  }
  const d = distances(rows, real);
  const old = score(rows, Object.fromEntries(DENDRITE_METRICS.map((m) => [m, real.heldout[m]])));
  return {
    label: algo.label,
    ks: { untargeted: d.untargeted, targeted: d.targeted },
    indistinguishable: d.indistinguishable,
    meanInBand: round(mean(DENDRITE_METRICS.map((m) => old[m].inBand)), 3),
    msPerCell: round(ms / n, 1),
    nodesPerCell: Math.round(nodes / n),
    perMetric: Object.fromEntries(DENDRITE_METRICS.map((m) => [m, {
      ks: d.perMetric[m], targeted: TARGETED.has(m),
      median: round(median(column(rows, m)), 1), real: real.heldout[m][1], inBand: round(old[m].inBand, 2),
    }])),
  };
}

// Benchmark every algorithm and write benchmark.json. `fit` holds each
// algorithm's fit log, `meta` the fit settings, both carried into the file.
export function writeBenchmark(params, fit, meta) {
  const real = loadJSON("real_cells.json"), n = real.train_rows.length;
  const reference = distances(real.train_rows, real);
  const algorithms = {};
  for (const algo of Object.values(ALGORITHMS)) {
    algorithms[algo.id] = { ...benchmark(algo, params[algo.id], real, n), fit: fit[algo.id] };
    const b = algorithms[algo.id];
    console.log(`  ${algo.id}: KS untargeted ${b.ks.untargeted}, targeted ${b.ks.targeted}, ` +
      `${b.indistinguishable}/${DENDRITE_METRICS.length} indistinguishable, ${b.msPerCell} ms/cell`);
  }
  console.log(`  real vs real: KS untargeted ${reference.untargeted}, targeted ${reference.targeted}, ` +
    `${reference.indistinguishable}/${DENDRITE_METRICS.length} indistinguishable`);
  writeFileSync(DATA + "benchmark.json", JSON.stringify({
    ...meta, heldoutCells: real.heldout_n, trainCells: real.train_n, benchCells: n,
    critical: round(ksCritical(n, real.heldout_n), 3), untargeted: UNTARGETED,
    reference, algorithms,
  }, null, 1));
  console.log("-> web/data/benchmark.json");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const params = loadJSON("params.json");
  const prior = existsSync(DATA + "benchmark.json") ? loadJSON("benchmark.json") : { algorithms: {} };
  const fit = Object.fromEntries(Object.entries(prior.algorithms).map(([id, b]) => [id, b.fit]));
  writeBenchmark(params, fit, { budget: prior.budget, cellsPerCandidate: prior.cellsPerCandidate });
}
