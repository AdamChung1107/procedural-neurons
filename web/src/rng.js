// Seeded random numbers that give the same stream in the browser and in Node.
//
// Every generator draws from an Rng keyed by a string. fork(label) derives an
// independent child stream from the key alone, never from how many numbers the
// parent has drawn, so a cell's dendrites do not change when its axon settings do.

function hash32(str) {
  // FNV-1a, then the murmur3 finaliser for avalanche.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.key = String(seed);
    // sfc32 state from four hashes of the key.
    this.a = hash32(this.key + "#a"); this.b = hash32(this.key + "#b");
    this.c = hash32(this.key + "#c"); this.d = hash32(this.key + "#d");
    this.spare = null;
    for (let i = 0; i < 12; i++) this.next();
  }

  next() {
    // sfc32 (Chris Doty-Humphrey): 32-bit output in [0, 2^32).
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  fork(label) { return new Rng(`${this.key}/${label}`); }

  random() { return this.next() / 4294967296; }
  uniform(lo, hi) { return lo + (hi - lo) * this.random(); }
  int(n) { return Math.floor(this.random() * n); }

  normal(mean = 0, sd = 1) {
    // Box-Muller, keeping the second variate for the next call.
    if (this.spare !== null) { const z = this.spare; this.spare = null; return mean + sd * z; }
    let u = 0;
    while (u === 0) u = this.random();
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * this.random();
    this.spare = r * Math.sin(th);
    return mean + sd * r * Math.cos(th);
  }

  unitVector() {
    const z = this.uniform(-1, 1), t = this.uniform(0, 2 * Math.PI), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(t), z, s * Math.sin(t)];
  }

  // Inverse-CDF sample from a distribution stored as evenly spaced quantiles.
  quantile(q) {
    const u = this.random() * (q.length - 1), i = Math.min(Math.floor(u), q.length - 2);
    return q[i] + (u - i) * (q[i + 1] - q[i]);
  }
}
