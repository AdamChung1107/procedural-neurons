import assert from "node:assert/strict";
import { test } from "node:test";

import { ALGORITHMS } from "../src/grow/index.js";
import { contractions, DENDRITE_METRICS, ks, median, score, summary } from "../src/metrics.js";
import { Rng } from "../src/rng.js";
import { Grid } from "../src/spatial/grid.js";
import { APICAL, AXON, BASAL, SOMA } from "../src/tree.js";
import { loadJSON, paramsFor } from "../tools/data.mjs";

const real = loadJSON("real_cells.json");
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

test("rng streams are reproducible and forks are independent of parent draws", () => {
  const a = new Rng(7), b = new Rng(7);
  assert.deepEqual([a.random(), a.normal(), a.int(10)], [b.random(), b.normal(), b.int(10)]);
  const fresh = new Rng(7).fork("x").random();
  const used = new Rng(7); used.random(); used.random();
  assert.equal(used.fork("x").random(), fresh);
  assert.notEqual(new Rng(8).random(), new Rng(7).random());
});

for (const algo of Object.values(ALGORITHMS)) {
  test(`${algo.id}: same seed gives the same cell, and the cell is a well-formed tree`, () => {
    const p = paramsFor(algo.id);
    const t1 = algo.grow(p, new Rng("t"), real), t2 = algo.grow(p, new Rng("t"), real);
    assert.deepEqual(t1.xyz, t2.xyz);
    assert.equal(t1.kind[0], SOMA);
    assert.equal(t1.parent[0], -1);
    for (let i = 1; i < t1.n; i++) {
      assert.ok(t1.parent[i] >= 0 && t1.parent[i] < i, "parents precede children");
      assert.ok(t1.radius[i] > 0);
    }
    assert.deepEqual(new Set(t1.kind), new Set([SOMA, AXON, BASAL, APICAL]));
  });

  test(`${algo.id}: changing apical settings leaves the basal tree untouched`, () => {
    const key = Object.keys(algo.box).find((k) => k.startsWith("apical."));
    const p = paramsFor(algo.id), q = { ...p, [key]: algo.box[key][1] };
    const basal = (t) => t.xyz.filter((_, i) => t.kind[Math.floor(i / 3)] === BASAL);
    assert.deepEqual(basal(algo.grow(p, new Rng("s"), real)), basal(algo.grow(q, new Rng("s"), real)));
  });
}

test("fitted cells match held-out human cells (median in band, >= 50 % of cells in band)", () => {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(summary(ALGORITHMS.fitted.grow(paramsFor("fitted"), new Rng(`v/${i}`), real)));
  const s = score(rows, Object.fromEntries(DENDRITE_METRICS.map((m) => [m, real.heldout[m]])));
  for (const m of DENDRITE_METRICS) {
    assert.ok(s[m].medianInBand, `${m} median ${s[m].median} outside held-out band`);
    assert.ok(s[m].inBand >= 0.5, `${m}: only ${s[m].inBand} in band`);
  }
});

test("fitted dendrites are as straight as real ones (median chord / path within 0.03)", () => {
  for (const [type, kind] of [["basal", BASAL], ["apical", APICAL]]) {
    const ratios = [];
    for (let i = 0; i < 20; i++) ratios.push(...contractions(ALGORITHMS.fitted.grow(paramsFor("fitted"), new Rng(`c/${i}`), real), kind));
    const want = real.neurites[type].contraction;
    assert.ok(Math.abs(median(ratios) - want) <= 0.03, `${type}: ${median(ratios).toFixed(3)} vs real ${want}`);
  }
});

test("KS distance: 0 for the same sample, 1 for disjoint ones, ties step together", () => {
  assert.equal(ks([3, 1, 2], [1, 2, 3]), 0);
  assert.equal(ks([1, 2, 3], [4, 5]), 1);
  assert.ok(Math.abs(ks([1, 2, 3], [2, 3, 4]) - 1 / 3) < 1e-12);
  assert.equal(ks([1, 1, 2, 2], [1, 2]), 0);
});

test("grid neighbour queries equal brute force", () => {
  const rng = new Rng("grid"), pts = Array.from({ length: 2000 }, () => [rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 100)]);
  const g = new Grid(7);
  pts.forEach((p, i) => g.insert(i, p));
  for (let q = 0; q < 50; q++) {
    const c = [rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 100)];
    const got = [];
    g.near(c, 7, (id) => got.push(id));
    const want = pts.map((p, i) => [p, i]).filter(([p]) => dist2(p, c) <= 49).map(([, i]) => i);
    assert.deepEqual(got.sort((a, b) => a - b), want.sort((a, b) => a - b));
  }
});
