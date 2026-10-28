// Uniform-grid spatial hash for fixed-radius neighbour queries in 3-D.
// Cell size equals the query radius, so a query checks at most 27 cells.
// Cell coordinates are packed into one number (16 bits per axis, offset), which
// is much faster as a Map key than a string.

const OFFSET = 32768;
const pack = (i, j, k) => ((i + OFFSET) * 65536 + (j + OFFSET)) * 65536 + (k + OFFSET);

export class Grid {
  constructor(cellSize) {
    this.h = cellSize;
    this.cells = new Map();
  }

  cellOf(p) { return pack(Math.floor(p[0] / this.h), Math.floor(p[1] / this.h), Math.floor(p[2] / this.h)); }

  insert(id, p) {
    const k = this.cellOf(p);
    let bucket = this.cells.get(k);
    if (!bucket) this.cells.set(k, (bucket = []));
    bucket.push({ id, p });
  }

  remove(id, p) {
    const bucket = this.cells.get(this.cellOf(p));
    const i = bucket ? bucket.findIndex((e) => e.id === id) : -1;
    if (i >= 0) bucket.splice(i, 1);
  }

  // Calls fn(id, point, distance^2) for every entry within radius r (r <= cell size).
  near(p, r, fn) {
    const cx = Math.floor(p[0] / this.h), cy = Math.floor(p[1] / this.h), cz = Math.floor(p[2] / this.h);
    const r2 = r * r;
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (let k = cz - 1; k <= cz + 1; k++) {
          const bucket = this.cells.get(pack(i, j, k));
          if (!bucket) continue;
          for (const e of bucket) {
            const d2 = (e.p[0] - p[0]) ** 2 + (e.p[1] - p[1]) ** 2 + (e.p[2] - p[2]) ** 2;
            if (d2 <= r2) fn(e.id, e.p, d2);
          }
        }
  }

  // Nearest entry within radius r, or null.
  nearest(p, r) {
    let best = null, bestD2 = Infinity;
    this.near(p, r, (id, q, d2) => { if (d2 < bestD2) { best = id; bestD2 = d2; } });
    return best;
  }
}
