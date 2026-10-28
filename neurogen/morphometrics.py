"""Standard morphometrics through NeuroM, shared by the fit script and the tests.

NeuroM is a development dependency; nothing in the generator imports this module.
"""

from __future__ import annotations

import neurom as nm
import numpy as np
from neurom.features import morphology as fm

TYPES = {"basal": nm.BASAL_DENDRITE, "apical": nm.APICAL_DENDRITE, "axon": nm.AXON}
SHOLL_RADII = [50, 100, 150, 200, 250, 300]


def from_text(swc_text: str):
    # Text, not a path: morphio cannot open non-ASCII paths on Windows.
    return nm.load_morphology(swc_text, reader="swc")


def neurites_of(m, kind: str) -> list:
    return [n for n in m.neurites if n.type == TYPES[kind]]


def extent(m, kind: str) -> float:
    """Apical: highest point above the soma. Axon: deepest point below it."""
    pts = np.vstack([n.points[:, :3] for n in neurites_of(m, kind)])
    return float(pts[:, 1].max() if kind == "apical" else -pts[:, 1].min())


def summary(m) -> dict[str, float]:
    out = {}
    for kind in ("basal", "apical"):
        t = TYPES[kind]
        out[f"{kind}_length"] = float(nm.get("total_length", m, neurite_type=t))
        out[f"{kind}_bifurcations"] = float(nm.get("number_of_bifurcations", m, neurite_type=t))
        orders = nm.get("section_branch_orders", m, neurite_type=t)
        out[f"{kind}_max_order"] = float(np.max(orders)) if len(orders) else 0.0
    out["basal_trunks"] = float(nm.get("number_of_neurites", m, neurite_type=nm.BASAL_DENDRITE))
    out["apical_height"] = extent(m, "apical")
    basal = fm.sholl_crossings(m, TYPES["basal"], m.soma.center, SHOLL_RADII)
    apical = fm.sholl_crossings(m, TYPES["apical"], m.soma.center, SHOLL_RADII)
    for r, a, b in zip(SHOLL_RADII, basal, apical):
        out[f"sholl_{r}"] = float(a + b)
    has_axon = bool(neurites_of(m, "axon"))
    out["axon_length"] = float(nm.get("total_length", m, neurite_type=nm.AXON)) if has_axon else 0.0
    out["axon_depth"] = extent(m, "axon") if has_axon else 0.0
    return out
