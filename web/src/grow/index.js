// The growth algorithms behind one interface:
//   { id, label, short, defaults, box, controls, grow(params, rng, real, kinds?) -> tree }
// `box` is the parameter search space used by tools/fit.mjs; `controls` are the
// parameters the demo exposes as sliders; `kinds` limits growth to some neurite
// types (the fit tunes each type on its own metrics).

import { colonization } from "./colonization.js";
import { fitted } from "./fitted.js";
import { lsystem } from "./lsystem.js";

export const ALGORITHMS = { fitted, lsystem, colonization };
