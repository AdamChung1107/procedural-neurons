"""Download human MTG layer 2/3 pyramidal reconstructions from NeuroMorpho.Org.

Two archives cover this cell type in the middle temporal gyrus (Brodmann area 21):
  DeKock            Mohan et al. 2015, Cereb Cortex, doi:10.1093/cercor/bhv188
  Allen Cell Types  Allen Institute human patch-seq / morphology, mostly MTG

Files are the standardised CNG versions. They land in data/morphologies/ with a
metadata.json that records where every cell came from.

    python scripts/fetch_morphologies.py
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://neuromorpho.org/api/neuron/select"
SWC_URL = "https://neuromorpho.org/dableFiles/{archive}/CNG%20version/{name}.CNG.swc"
OUT = Path(__file__).resolve().parents[1] / "data" / "morphologies"

LAYERS = {"layer 2", "layer 3", "layer 2-3", "layer 3a", "layer 3b", "layer 3c"}


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def query() -> list[dict]:
    cells, page = [], 0
    while True:
        params = urllib.parse.urlencode({
            "q": "species:human",
            "fq": "brain_region:middle temporal gyrus",
            "size": 500,
            "page": page,
        })
        d = json.loads(_get(f"{API}?{params}"))
        cells += d["_embedded"]["neuronResources"]
        page += 1
        if page >= d["page"]["totalPages"]:
            return cells


def keep(n: dict) -> bool:
    if "pyramidal" not in n["cell_type"] or not set(n["brain_region"]) & LAYERS:
        return False
    # Every DeKock cell is "Dendrites Moderate" (cut by the slice) but they are
    # the BA21 reference set; Allen cells must have complete dendrites.
    return n["archive"] == "DeKock" or "Dendrites Complete" in n["physical_Integrity"]


def main() -> int:
    cells = [n for n in query() if keep(n)]
    OUT.mkdir(parents=True, exist_ok=True)
    meta = []
    for n in cells:
        path = OUT / f"{n['neuron_name']}.swc"
        if not path.exists():
            url = SWC_URL.format(archive=urllib.parse.quote(n["archive"].lower()),
                                 name=urllib.parse.quote(n["neuron_name"]))
            try:
                path.write_bytes(_get(url))
            except OSError as e:
                print(f"skip {n['neuron_name']}: {e}", file=sys.stderr)
                continue
        meta.append({k: n[k] for k in (
            "neuron_id", "neuron_name", "archive", "brain_region", "cell_type",
            "physical_Integrity", "domain", "min_age", "max_age", "gender",
            "experiment_condition", "slicing_thickness", "reference_doi")})
    (OUT / "metadata.json").write_text(json.dumps(meta, indent=1))
    by_archive = {}
    for m in meta:
        by_archive[m["archive"]] = by_archive.get(m["archive"], 0) + 1
    print(f"{len(meta)} cells in {OUT}: {by_archive}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
