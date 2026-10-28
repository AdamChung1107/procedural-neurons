// Fit growth algorithms to real human cells with the same search budget, then
// benchmark every algorithm on held-out cells it never saw (benchmark.mjs).
//
//   node web/tools/fit.mjs [--budget 200] [--cells 16] [--algo fitted,lsystem]
//
// Fit: for each neurite type, random search over that type's parameter box.
// A candidate grows `cells` neurites with fixed seeds (common random numbers, so
// candidates differ only by their parameters) and is scored by how far its
// 5th/50th/95th percentiles sit from the training cells', in units of the
// training 5-95 % spread. Algorithms with a straightness parameter for the type
// (`<type>.persist`) are also scored on how far their median section
// straightness (chord / path) sits from the measured one, weighted as one more
// metric; for the others the term would fight their other targets with no knob
// to fix it. The top 5 are re-scored on 4x more cells.
//
// --algo fits only the listed algorithms and keeps the others' parameters from
// params.json; the benchmark always covers all of them.
//
// Writes web/data/params.json and web/data/benchmark.json.

import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { ALGORITHMS } from "../src/grow/index.js";
import { contractions, median, percentile, summary } from "../src/metrics.js";
import { Rng } from "../src/rng.js";
import { APICAL, AXON, BASAL } from "../src/tree.js";
import { TYPE_METRICS, writeBenchmark } from "./benchmark.mjs";
import { DATA, loadJSON } from "./data.mjs";

const KIND = { basal: BASAL, apical: APICAL, axon: AXON };
const CONTRACTION_SPREAD = 0.1; // a straightness error of 0.1 counts as one training spread

const { values } = parseArgs({
  options: {
    budget: { type: "string", default: "200" },
    cells: { type: "string", default: "16" },
    algo: { type: "string", default: Object.keys(ALGORITHMS).join(",") },
  },
});
const BUDGET = Number(values.budget), CELLS = Number(values.cells);
const CHOSEN = values.algo.split(",");
for (const id of CHOSEN) if (!ALGORITHMS[id]) throw new Error(`unknown algorithm ${id}`);
const real = loadJSON("real_cells.json");

function objective(algo, params, type, n) {
  const straight = `${type}.persist` in algo.box;
  const rows = [], straightness = [];
  for (let c = 0; c < n; c++) {
    const tree = algo.grow(params, new Rng(`fit/cell/${c}`), real, [type]);
    rows.push(summary(tree));
    if (straight) straightness.push(...contractions(tree, KIND[type]));
  }
  let sum = 0, terms = 0;
  for (const m of TYPE_METRICS[type]) {
    const [p5, , p95] = real.train[m], spread = Math.max(p95 - p5, 1e-9);
    [5, 50, 95].forEach((q, i) => {
      sum += ((percentile(rows.map((r) => r[m]), q) - real.train[m][i]) / spread) ** 2;
      terms++;
    });
  }
  if (straight) {
    const off = straightness.length ? (median(straightness) - real.neurites[type].contraction) / CONTRACTION_SPREAD : 1;
    sum += 3 * off ** 2;
    terms += 3;
  }
  return sum / terms;
}

function fit(algo) {
  let params = { ...algo.defaults };
  const log = {};
  for (const type of Object.keys(TYPE_METRICS)) {
    const keys = Object.keys(algo.box).filter((k) => k.startsWith(`${type}.`));
    if (!keys.length) continue;
    const draw = new Rng(`fit/${algo.id}/${type}`);
    const candidates = [params];
    for (let i = 1; i < BUDGET; i++) {
      const c = { ...params };
      for (const k of keys) c[k] = draw.uniform(...algo.box[k]);
      candidates.push(c);
    }
    const scored = candidates.map((c) => ({ c, f: guarded(() => objective(algo, c, type, CELLS)) }))
      .sort((a, b) => a.f - b.f).slice(0, 5)
      .map(({ c }) => ({ c, f: guarded(() => objective(algo, c, type, 4 * CELLS)) }))
      .sort((a, b) => a.f - b.f);
    params = scored[0].c;
    log[type] = round(scored[0].f, 4);
    process.stdout.write(`  ${algo.id}.${type}: objective ${scored[0].f.toFixed(3)}\n`);
  }
  return { params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, round(v, 4)])), log };
}

// A candidate that blows up (runaway growth) simply loses.
function guarded(fn) {
  try { return fn(); } catch { return Infinity; }
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

const params = existsSync(DATA + "params.json") ? loadJSON("params.json") : {};
const prior = existsSync(DATA + "benchmark.json") ? loadJSON("benchmark.json") : { algorithms: {} };
const logs = Object.fromEntries(Object.entries(prior.algorithms).map(([id, b]) => [id, b.fit]));
for (const id of CHOSEN) {
  console.log(`fitting ${ALGORITHMS[id].label}`);
  const { params: p, log } = fit(ALGORITHMS[id]);
  params[id] = p;
  logs[id] = log;
}
writeFileSync(DATA + "params.json", JSON.stringify(params, null, 1));
console.log("-> web/data/params.json\nbenchmark");
writeBenchmark(params, logs, { budget: BUDGET, cellsPerCandidate: CELLS });
