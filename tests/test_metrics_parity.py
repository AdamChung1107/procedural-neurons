"""The JS engine scores generated cells with its own morphometrics (web/src/metrics.js).
They must equal NeuroM's on the same cells, or the benchmark would compare
generated and real cells on different rulers."""

import json
import shutil
import subprocess
from pathlib import Path

import morphio
import pytest

from neurogen.morphometrics import from_text, summary

ROOT = Path(__file__).resolve().parents[1]
ALGORITHMS = ["fitted", "lsystem", "colonization"]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs Node.js")


@pytest.mark.parametrize("algo", ALGORITHMS)
def test_js_metrics_equal_neurom(algo, tmp_path):
    morphio.set_maximum_warnings(0)
    subprocess.run(["node", str(ROOT / "web" / "tools" / "cli.mjs"), "grow", "--algo", algo,
                    "--n", "4", "--seed", "parity", "--out", str(tmp_path)], check=True, cwd=ROOT)
    js = json.loads((tmp_path / "metrics.json").read_text())
    for name, mine in js.items():
        ref = summary(from_text((tmp_path / f"{name}.swc").read_text()))
        for key, want in ref.items():
            # SWC stores 3 decimals, so lengths agree to rounding; counts must match.
            assert mine[key] == pytest.approx(want, rel=1e-3, abs=1e-2), (name, key)
