"""Measure real human MTG L2/3 pyramidal cells for the generators to imitate.

Splits the cells from fetch_morphologies.py into training (70 %) and held-out
(30 %) sets, stratified by archive, and writes web/data/real_cells.json with:

  neurites   per-type distributions measured on training cells, which the
             data-driven grower (web/src/grow/fitted.js) samples directly
  train      5/50/95th percentiles of every metric on training cells, the
             target every algorithm is fitted to (web/tools/fit.mjs)
  heldout    the same percentiles on held-out cells, used only for scoring
  train_rows, heldout_rows
             every cell's dendrite metrics, so the benchmark can compare
             whole distributions (web/tools/benchmark.mjs)

    python scripts/measure_morphology.py
"""

import datetime
import json
import sys
from pathlib import Path

import morphio
import neurom as nm
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from neurogen.morphometrics import SHOLL_RADII, neurites_of, summary  # noqa: E402

DATA = ROOT / "data" / "morphologies"
OUT = ROOT / "web" / "data" / "real_cells.json"
MIN_AXON_UM = 2000.0  # only cells with a substantial local axon inform the axon targets
MIN_SECTIONS_PER_ORDER = 10
N_QUANTILES = 41
SEED = 20261020
AXON_METRICS = ("axon_length", "axon_depth")


def quantiles(x) -> list[float]:
    x = np.asarray([v for v in x if v is not None], float)
    return [round(float(v), 4) for v in np.quantile(x, np.linspace(0, 1, N_QUANTILES))]


def initial_direction(points: np.ndarray, reach: float = 10.0):
    """Unit vector from the section start to the point ~reach µm along it; None if degenerate."""
    steps = np.linalg.norm(np.diff(points[:, :3], axis=0), axis=1)
    k = int(np.searchsorted(np.cumsum(steps), reach)) + 1
    v = points[min(k, len(points) - 1), :3] - points[0, :3]
    n = np.linalg.norm(v)
    return v / n if n > 0 else None


def angle(u, v):
    if u is None or v is None:
        return None
    return float(np.arccos(np.clip(np.dot(u, v), -1, 1)))


def load(names):
    cells = {}
    for name in names:
        try:
            # Pass the text, not the path: morphio cannot open non-ASCII paths on Windows.
            text = (DATA / f"{name}.swc").read_text(encoding="utf-8")
            cells[name] = nm.load_morphology(text, reader="swc")
        except Exception as e:  # malformed files are reported and skipped
            print(f"skip {name}: {e}", file=sys.stderr)
    return cells


def p_by_order(counts: dict) -> list[float]:
    """Bifurcation probability per branch order; sparse high orders share a pooled tail."""
    if not counts:
        return []
    p = []
    for o in range(max(counts) + 1):
        n, k = counts.get(o, [0, 0])
        if n < MIN_SECTIONS_PER_ORDER:
            tail = [counts[q] for q in counts if q >= o]
            n, k = sum(t[0] for t in tail), sum(t[1] for t in tail)
        p.append(round(k / n, 4) if n else 0.0)
    return p


def subtree_lengths(root) -> dict:
    total = {}
    for sec in root.ipostorder():
        total[sec.id] = sec.length + sum(total[c.id] for c in sec.children)
    return total


def has_long_axon(m) -> bool:
    return any(n.length >= MIN_AXON_UM for n in neurites_of(m, "axon"))


def measure(cells: dict, kind: str) -> dict:
    trunks, elev, trunk_r = [], [], []
    internal, terminal, bif_angle, contraction, tip_r = [], [], [], [], []
    side, main_line = {}, {}
    up = np.array([0.0, 1.0, 0.0])
    for m in cells.values():
        ns = neurites_of(m, kind)
        if kind == "axon":
            ns = [n for n in ns if n.length >= MIN_AXON_UM]
        if not ns:
            continue
        trunks.append(len(ns))
        for n in ns:
            root = n.root_node
            elev.append(angle(initial_direction(root.points), up))
            trunk_r.append(root.points[0, 3])
            # The main lineage follows the child with the most dendrite (or axon)
            # beneath it; basal trees have no main lineage.
            size = subtree_lengths(root)
            order, is_main = {}, {}
            for sec in root.ipreorder():
                if sec.is_root():
                    o, mn = 0, kind != "basal"
                else:
                    par = sec.parent
                    o = order[par.id] + 1
                    mn = is_main[par.id] and sec.id == max(par.children, key=lambda c: size[c.id]).id
                order[sec.id], is_main[sec.id] = o, mn
                splits = len(sec.children) >= 2
                counts = main_line if mn else side
                counts.setdefault(o, [0, 0])
                counts[o][0] += 1
                counts[o][1] += splits
                (internal if splits else terminal).append(sec.length)
                if sec.length >= 20:
                    chord = np.linalg.norm(sec.points[-1, :3] - sec.points[0, :3])
                    contraction.append(chord / sec.length)
                if splits:
                    a, b = sec.children[:2]
                    bif_angle.append(angle(initial_direction(a.points), initial_direction(b.points)))
                else:
                    tip_r.append(sec.points[-1, 3])

    return {
        "cells": len(trunks),
        "trunks": quantiles(trunks), "trunk_elevation": quantiles(elev),
        "internal_length": quantiles(internal), "terminal_length": quantiles(terminal),
        "bifurcation_angle": quantiles(bif_angle),
        "p_bifurcate": p_by_order(side), "p_bifurcate_main": p_by_order(main_line),
        "contraction": round(float(np.median(contraction)), 4),
        "tip_radius": round(float(np.median(tip_r)), 4),
        "trunk_radius": quantiles(trunk_r),
    }


def rows(cells: list[dict], keys) -> list[dict]:
    return [{k: round(float(r[k]), 2) for k in keys} for r in cells]


def bands(rows: list[dict], keys) -> dict:
    return {k: [round(float(np.percentile([r[k] for r in rows], q)), 2) for q in (5, 50, 95)]
            for k in keys}


def main() -> int:
    morphio.set_maximum_warnings(0)
    meta = json.loads((DATA / "metadata.json").read_text())
    rng = np.random.default_rng(SEED)
    train, held = [], []
    for archive in sorted({m["archive"] for m in meta}):
        names = sorted(m["neuron_name"] for m in meta if m["archive"] == archive)
        rng.shuffle(names)
        cut = int(round(0.7 * len(names)))
        train += names[:cut]
        held += names[cut:]
    train_cells, held_cells = load(train), load(held)
    # Cells without an apical dendrite are not L2/3 pyramids as reconstructed.
    train_cells = {k: m for k, m in train_cells.items() if neurites_of(m, "apical")}
    held_cells = {k: m for k, m in held_cells.items() if neurites_of(m, "apical")}

    neurites = {kind: measure(train_cells, kind) for kind in ("basal", "apical", "axon")}
    train_rows = [summary(m) for m in train_cells.values()]
    held_rows = [summary(m) for m in held_cells.values()]
    dendrite_keys = [k for k in train_rows[0] if k not in AXON_METRICS]
    # Axons in slices are truncated; only cells with a substantial local arbor set axon targets.
    axon_rows = [summary(m) for m in train_cells.values() if has_long_axon(m)]

    out = {
        "provenance": {
            "measured": datetime.date.today().isoformat(),
            "script": "scripts/measure_morphology.py", "seed": SEED,
            "sources": {"DeKock": "Mohan et al. 2015 Cereb Cortex, doi:10.1093/cercor/bhv188",
                        "Allen Cell Types": "Allen Institute human MTG, via NeuroMorpho.Org"},
            "train_cells": sorted(train_cells), "heldout_cells": sorted(held_cells),
            "axon_note": f"axon statistics from cells with >= {MIN_AXON_UM:.0f} um of local axon; "
                         "slice-truncated, so this is the local arbor only",
        },
        "sholl_radii_um": SHOLL_RADII,
        "soma_radius": quantiles([m.soma.radius for m in train_cells.values()]),
        "neurites": neurites,
        "train": {**bands(train_rows, dendrite_keys), **bands(axon_rows, AXON_METRICS)},
        "train_n": {"dendrites": len(train_rows), "axon": len(axon_rows)},
        "heldout": bands(held_rows, dendrite_keys),
        "heldout_n": len(held_rows),
        "train_rows": rows(train_rows, dendrite_keys),
        "heldout_rows": rows(held_rows, dendrite_keys),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"train {len(train_cells)} ({len(axon_rows)} with long axons), "
          f"held-out {len(held_cells)} -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
