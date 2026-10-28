// Stochastic parametric L-system (Prusinkiewicz & Lindenmayer, "The Algorithmic
// Beauty of Plants", ch. 1-2), the idea behind Ascoli's L-Neuron.
//
// Alphabet:  F(l) draw l µm   [ ] push / pop the turtle   / roll   & ^ pitch
//            A(o) side apex at branch order o   M(o) main apex (apical / axon stem)
//
// Productions, applied in parallel for `depth` derivation steps:
//   A(o) -> F(Li) /(phi) [ &(t) A(o+1) ] [ ^(t) A(o+1) ]   with p = p0 * decay^o   (dichotomous split)
//   A(o) -> F(Lt)                                          otherwise               (terminal)
//   M(o) -> F(Lm) /(phi) [ &(t) A(1) ] M(o+1)              with p = keep           (monopodial: lateral + stem)
//   M(o) -> F(Lm) /(phi) [ &(t) A(o+1) ] [ ^(t) A(o+1) ]   otherwise               (stem ends in a fork)
// Lengths are lognormal around their means. The turtle walks each F in 2 µm steps
// with heading noise (wander) and a tropism toward the pia (apical) or white matter (axon).

import { TreeBuilder } from "../tree.js";
import { dot, fromSpherical, normalize, perpendicular, rotate } from "../vec.js";
import { AXIS, NEURITES, STEP_UM, finish, spreadAzimuths } from "./common.js";

const MAX_MODULES = 200_000;

const perType = (keys) => Object.fromEntries(keys);

export const lsystem = {
  id: "lsystem",
  label: "Stochastic L-system",
  short: "L-system",
  defaults: perType([
    ["basal.trunks", 5], ["basal.Li", 25], ["basal.Lt", 140], ["basal.p0", 0.9], ["basal.decay", 0.75],
    ["basal.angle", 0.9], ["basal.wander", 0.15],
    ["apical.Lm", 35], ["apical.keep", 0.9], ["apical.Li", 25], ["apical.Lt", 120], ["apical.p0", 0.5],
    ["apical.decay", 0.8], ["apical.angle", 0.9], ["apical.wander", 0.12], ["apical.tropism", 0.05],
    ["axon.Lm", 40], ["axon.keep", 0.92], ["axon.Li", 35], ["axon.Lt", 90], ["axon.p0", 0.8],
    ["axon.decay", 0.9], ["axon.angle", 1.2], ["axon.wander", 0.12], ["axon.tropism", 0.02],
  ]),
  box: perType([
    ["basal.trunks", [3, 8]], ["basal.Li", [5, 80]], ["basal.Lt", [30, 300]], ["basal.p0", [0.3, 1]],
    ["basal.decay", [0.4, 1]], ["basal.angle", [0.3, 1.6]], ["basal.wander", [0.02, 0.4]],
    ["apical.Lm", [10, 80]], ["apical.keep", [0.6, 0.99]], ["apical.Li", [5, 80]], ["apical.Lt", [30, 300]],
    ["apical.p0", [0.1, 1]], ["apical.decay", [0.4, 1]], ["apical.angle", [0.3, 1.6]],
    ["apical.wander", [0.02, 0.4]], ["apical.tropism", [0, 0.2]],
    ["axon.Lm", [10, 120]], ["axon.keep", [0.6, 0.99]], ["axon.Li", [5, 120]], ["axon.Lt", [30, 400]],
    ["axon.p0", [0.1, 1]], ["axon.decay", [0.4, 1]], ["axon.angle", [0.3, 1.6]],
    ["axon.wander", [0.02, 0.4]], ["axon.tropism", [0, 0.2]],
  ]),
  controls: ["apical.keep", "basal.p0", "basal.decay", "basal.angle"],
  depth: 24,

  grow(params, rng, real, kinds = ["basal", "apical", "axon"]) {
    const somaR = rng.fork("soma").quantile(real.soma_radius);
    const b = new TreeBuilder(somaR);
    for (const [name, kind] of NEURITES) {
      if (!kinds.includes(name)) continue;
      const r = rng.fork(name), P = (k) => params[`${name}.${k}`];
      const stems = name === "basal" ? Math.round(P("trunks")) : 1, azimuths = spreadAzimuths(r, stems);
      for (let t = 0; t < stems; t++) {
        // Basal trunks leave the lower three quarters of the soma; the stems go straight.
        const h0 = name === "basal" ? fromSpherical(Math.acos(r.uniform(-1, 0.5)), azimuths[t])
          : AXIS[name];
        const word = derive(name === "basal" ? [{ s: "A", o: 0 }] : [{ s: "M", o: 0 }], P, r, this.depth);
        interpret(word, b, kind, h0, somaR, P, r, AXIS[name]);
      }
    }
    return finish(b.build(), real, rng.fork("radius"));
  },
};

const lognormal = (r, mean) => mean * Math.exp(0.5 * r.normal() - 0.125); // cv ~0.5, mean preserved

function derive(word, P, r, depth) {
  const theta = () => Math.max(0.05, r.normal(P("angle") / 2, 0.15 * P("angle")));
  for (let step = 0; step < depth; step++) {
    const next = [];
    let changed = false;
    for (const m of word) {
      if (m.s === "A") {
        changed = true;
        const p = Math.min(0.97, P("p0") * Math.pow(P("decay"), m.o));
        if (r.random() < p) {
          next.push({ s: "F", l: lognormal(r, P("Li")) }, { s: "/", a: r.uniform(0, 2 * Math.PI) },
            { s: "[" }, { s: "&", a: theta() }, { s: "A", o: m.o + 1 }, { s: "]" },
            { s: "[" }, { s: "^", a: theta() }, { s: "A", o: m.o + 1 }, { s: "]" });
        } else {
          next.push({ s: "F", l: lognormal(r, P("Lt")) });
        }
      } else if (m.s === "M") {
        changed = true;
        next.push({ s: "F", l: lognormal(r, P("Lm")) }, { s: "/", a: r.uniform(0, 2 * Math.PI) });
        if (r.random() < P("keep")) {
          next.push({ s: "[" }, { s: "&", a: theta() }, { s: "A", o: 1 }, { s: "]" }, { s: "M", o: m.o + 1 });
        } else {
          next.push({ s: "[" }, { s: "&", a: theta() }, { s: "A", o: m.o + 1 }, { s: "]" },
            { s: "[" }, { s: "^", a: theta() }, { s: "A", o: m.o + 1 }, { s: "]" });
        }
      } else {
        next.push(m);
      }
      if (next.length > MAX_MODULES) throw new Error("L-system word too long");
    }
    word = next;
    if (!changed) break;
  }
  // Apices still open after the last derivation step become terminal segments.
  return word.map((m) => (m.s === "A" || m.s === "M" ? { s: "F", l: lognormal(r, P("Lt")) } : m));
}

function interpret(word, b, kind, h0, somaR, P, r, axis) {
  const wander = P("wander"), tropism = P("tropism") ?? 0;
  let H = normalize(h0), L = perpendicular(H), node = b.add([H[0] * somaR, H[1] * somaR, H[2] * somaR], 0, kind);
  const stack = [];
  for (const m of word) {
    switch (m.s) {
      case "F": {
        const n = Math.max(1, Math.ceil(m.l / STEP_UM)), step = m.l / n;
        for (let i = 0; i < n; i++) {
          let h = [H[0] + wander * r.normal(), H[1] + wander * r.normal(), H[2] + wander * r.normal()];
          if (tropism && axis) h = [h[0] + tropism * axis[0], h[1] + tropism * axis[1], h[2] + tropism * axis[2]];
          H = normalize(h);
          L = normalize([L[0] - dot(L, H) * H[0], L[1] - dot(L, H) * H[1], L[2] - dot(L, H) * H[2]]);
          const p = b.point(node);
          node = b.add([p[0] + step * H[0], p[1] + step * H[1], p[2] + step * H[2]], node, kind);
        }
        break;
      }
      case "/": L = rotate(L, H, m.a); break;
      case "&": H = rotate(H, L, m.a); break;
      case "^": H = rotate(H, L, -m.a); break;
      case "[": stack.push({ node, H, L }); break;
      case "]": ({ node, H, L } = stack.pop()); break;
    }
  }
}
