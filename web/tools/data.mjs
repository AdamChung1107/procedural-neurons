// Node-side access to web/data (the browser fetches the same files).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ALGORITHMS } from "../src/grow/index.js";

export const DATA = fileURLToPath(new URL("../data/", import.meta.url));

export const loadJSON = (name) => JSON.parse(readFileSync(DATA + name, "utf8"));

export function paramsFor(id) {
  const fittedParams = existsSync(DATA + "params.json") ? loadJSON("params.json")[id] : null;
  return { ...ALGORITHMS[id].defaults, ...(fittedParams ?? {}) };
}
