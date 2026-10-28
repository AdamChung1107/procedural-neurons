// Grow cells from the command line and write SWC files plus their metrics.
//
//   node web/tools/cli.mjs grow --algo fitted --n 20 --seed 0 --out results/cells
//
// Uses the fitted parameters in web/data/params.json when present, otherwise
// each algorithm's defaults. metrics.json holds the JS morphometrics of every
// cell, which tests/test_metrics_parity.py compares with NeuroM.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { ALGORITHMS } from "../src/grow/index.js";
import { summary } from "../src/metrics.js";
import { Rng } from "../src/rng.js";
import { toSWC } from "../src/tree.js";
import { loadJSON, paramsFor } from "./data.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    algo: { type: "string", default: "fitted" },
    n: { type: "string", default: "10" },
    seed: { type: "string", default: "0" },
    out: { type: "string", default: "results/cells" },
  },
});

if (positionals[0] !== "grow") {
  console.error("usage: node web/tools/cli.mjs grow --algo <" + Object.keys(ALGORITHMS).join("|") +
    "> --n N --seed S --out DIR");
  process.exit(1);
}

const real = loadJSON("real_cells.json");
const algo = ALGORITHMS[values.algo];
const params = paramsFor(values.algo);
mkdirSync(values.out, { recursive: true });
const metrics = {};
const t0 = performance.now();
for (let i = 0; i < Number(values.n); i++) {
  const name = `${values.algo}_${String(i).padStart(3, "0")}`;
  const tree = algo.grow(params, new Rng(`${values.seed}/cell/${i}`), real);
  writeFileSync(join(values.out, `${name}.swc`),
    toSWC(tree, `neurogen ${algo.label}, seed ${values.seed}, cell ${i}\n+y toward pia, um`));
  metrics[name] = summary(tree);
}
writeFileSync(join(values.out, "metrics.json"), JSON.stringify(metrics, null, 1));
console.log(`${values.n} ${values.algo} cells in ${(performance.now() - t0).toFixed(0)} ms -> ${values.out}`);
