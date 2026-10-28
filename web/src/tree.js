// A neuron skeleton as flat arrays: node i has a position, radius, parent and SWC type.
// Parents always come before children, so one forward or backward sweep visits
// the tree in topological order.

export const SOMA = 1, AXON = 2, BASAL = 3, APICAL = 4;

export class TreeBuilder {
  constructor(somaRadius) {
    this.xyz = [0, 0, 0];
    this.radius = [somaRadius];
    this.parent = [-1];
    this.kind = [SOMA];
  }

  get size() { return this.parent.length; }

  add(p, parent, kind, radius = 0) {
    this.xyz.push(p[0], p[1], p[2]);
    this.radius.push(radius);
    this.parent.push(parent);
    this.kind.push(kind);
    return this.parent.length - 1;
  }

  point(i) { return [this.xyz[3 * i], this.xyz[3 * i + 1], this.xyz[3 * i + 2]]; }

  build() {
    return {
      n: this.parent.length,
      xyz: Float64Array.from(this.xyz),
      radius: Float64Array.from(this.radius),
      parent: Int32Array.from(this.parent),
      kind: Uint8Array.from(this.kind),
    };
  }
}

export function childCounts(tree) {
  const c = new Int32Array(tree.n);
  for (let i = 1; i < tree.n; i++) c[tree.parent[i]]++;
  return c;
}

// Unbranched runs of nodes, each starting at the soma or a branch point.
export function sections(tree, kinds) {
  const kids = childCounts(tree), out = [];
  const child = new Int32Array(tree.n).fill(-1); // the only child, where there is exactly one
  for (let i = 1; i < tree.n; i++) if (kids[tree.parent[i]] === 1) child[tree.parent[i]] = i;
  for (let i = 1; i < tree.n; i++) {
    const p = tree.parent[i];
    if (!kinds.includes(tree.kind[i]) || (p !== 0 && kids[p] < 2)) continue;
    const nodes = [p, i];
    for (let j = i; kids[j] === 1; ) nodes.push((j = child[j]));
    out.push(nodes);
  }
  return out;
}

// Pipe-model radii (Rall's 3/2 rule): tips get tip[kind], each parent gets
// (sum of children^1.5)^(2/3), capped at max[kind]. One backward sweep, since
// every child comes after its parent.
export function assignRadii(tree, tip, max, exponent = 1.5) {
  const acc = new Float64Array(tree.n);
  const kids = childCounts(tree);
  for (let i = tree.n - 1; i >= 1; i--) {
    const k = tree.kind[i];
    const r = kids[i] === 0 ? tip[k] : Math.min(Math.pow(acc[i], 1 / exponent), max[k]);
    tree.radius[i] = r;
    if (tree.parent[i] > 0) acc[tree.parent[i]] += Math.pow(r, exponent);
  }
  return tree;
}

export function toSWC(tree, header = "") {
  const lines = header ? header.split("\n").map((h) => `# ${h}`) : [];
  for (let i = 0; i < tree.n; i++) {
    const p = tree.parent[i] >= 0 ? tree.parent[i] + 1 : -1;
    lines.push(`${i + 1} ${tree.kind[i]} ${tree.xyz[3 * i].toFixed(3)} ${tree.xyz[3 * i + 1].toFixed(3)} ` +
      `${tree.xyz[3 * i + 2].toFixed(3)} ${tree.radius[i].toFixed(4)} ${p}`);
  }
  return lines.join("\n") + "\n";
}
