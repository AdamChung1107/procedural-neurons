// The demo page: two tabs over one three.js view. Every control change
// regenerates from the seed, so the same seed and settings always give the
// same result.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { ALGORITHMS } from "./src/grow/index.js";
import { COLORS, dispose, lines, tubes } from "./src/mesh.js";
import { DENDRITE_METRICS, summary } from "./src/metrics.js";
import { Rng } from "./src/rng.js";
import { APICAL, AXON, BASAL, toSWC } from "./src/tree.js";

const [real, fittedParams, bench] = await Promise.all(
  ["real_cells", "params", "benchmark"].map((f) => fetch(`data/${f}.json`).then((r) => r.json())));

const $ = (id) => document.getElementById(id);
const state = {
  tab: "cell", seed: "1", algo: "fitted",
  params: Object.fromEntries(Object.values(ALGORITHMS).map((a) => [a.id, { ...a.defaults, ...fittedParams[a.id] }])),
  asTubes: true,
};
let tree = null;

// --- three.js view --------------------------------------------------------
// Log depth keeps precision when zoomed from a whole cell down to its finest branches.
const renderer = new THREE.WebGLRenderer({ canvas: $("canvas"), antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1418);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Zoom toward the rotation centre. Zoom-to-cursor would move the centre with
// every wheel step and drag it off the neuron; the arrow keys move it instead.
controls.zoomSpeed = 3;
scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a2228, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 2, 1.5);
scene.add(sun);
let current = null;

function resize() {
  const v = $("view"), w = Math.max(1, v.clientWidth), h = Math.max(1, v.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// Observe the view itself: it also changes size when the panel reflows, not only on window resize.
new ResizeObserver(resize).observe($("view"));
resize();

// Clip planes follow the zoom. Fixed planes set at reframe clipped everything
// once the camera zoomed in closer than `near`, which blacked out the view.
let sceneRadius = 1;
function fitClipPlanes() {
  const d = camera.position.distanceTo(controls.target);
  camera.near = Math.max(d / 1000, sceneRadius / 1e5);
  camera.far = d + sceneRadius * 4;
  camera.updateProjectionMatrix();
}

// Bottom-right readout: how much of the scene the view spans at the orbit target.
const WORLD_UNIT_NM = 1000; // scenes are in µm
const length = (nm) => (nm >= 1e6 ? `${(nm / 1e6).toPrecision(3)} mm` : nm >= 1000 ? `${(nm / 1000).toPrecision(3)} µm` : `${nm.toPrecision(3)} nm`);
let homeDistance = 1; // camera distance at the last reframe = zoom 1x
function updateScale() {
  const d = camera.position.distanceTo(controls.target);
  const span = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect; // world units across
  const nm = WORLD_UNIT_NM, px = renderer.domElement.clientWidth;
  $("scale").textContent = `view ${length(span * nm)} wide · 1 px ≈ ${length((span * nm) / px)} · zoom ${(homeDistance / d).toFixed(1)}×`;
}

renderer.setAnimationLoop(() => {
  controls.update(); fitClipPlanes(); updateScale(); placeTags(); placePivot(); watchHelp(); renderer.render(scene, camera);
});

// --- name tags ------------------------------------------------------------
// A boxed name with a leader line down to a neuron's soma, re-placed every frame.
const tagLayer = document.createElement("div");
tagLayer.id = "tags";
$("view").append(tagLayer);
let tags = [];
function setTags(items) {
  tagLayer.innerHTML = "<svg></svg>";
  const svg = tagLayer.querySelector("svg");
  tags = items.map(([text, at]) => {
    const el = document.createElement("div");
    el.className = "tag";
    el.textContent = text;
    tagLayer.append(el);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    svg.append(line);
    return { el, line, at: new THREE.Vector3(...at) };
  });
}
const projected = new THREE.Vector3();
function toScreen(at) {
  projected.copy(at).project(camera);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  return { x: ((projected.x + 1) / 2) * w, y: ((1 - projected.y) / 2) * h, behind: projected.z > 1 };
}
function placeTags() {
  for (const t of tags) {
    const { x, y, behind } = toScreen(t.at), cx = x - 90, cy = y - 110; // box corner, up and left of the soma
    t.el.style.display = t.line.style.display = behind ? "none" : "";
    t.el.style.transform = `translate(${cx}px, ${cy}px) translate(-100%, -100%)`;
    t.line.setAttribute("x1", cx); t.line.setAttribute("y1", cy);
    t.line.setAttribute("x2", x); t.line.setAttribute("y2", y);
  }
}

// --- rotation centre --------------------------------------------------------
// Arrow keys move the orbit centre: left/right step from neuron to neuron,
// up/down raise or lower it. The camera moves with it, so the view pans
// instead of swinging round. A marker shows the centre for a moment after.
let somata = [], focus = 0, pivotShownAt = -Infinity;
const pivot = document.createElement("div");
pivot.id = "pivot";
$("view").append(pivot);
function placePivot() {
  const age = performance.now() - pivotShownAt, { x, y } = toScreen(controls.target);
  pivot.style.opacity = age < 1200 ? 1 : 0;
  pivot.style.transform = `translate(${x}px, ${y}px)`;
}
addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  const step = new THREE.Vector3();
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && somata.length) {
    focus = (focus + (e.key === "ArrowRight" ? 1 : -1) + somata.length) % somata.length;
    const [x, , z] = somata[focus];
    step.set(x - controls.target.x, 0, z - controls.target.z);
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    step.set(0, (e.key === "ArrowUp" ? 1 : -1) * sceneRadius * 0.04, 0);
  } else return;
  e.preventDefault();
  controls.target.add(step);
  camera.position.add(step);
  pivotShownAt = performance.now();
  if (step.lengthSq()) tick("centre");
});

const START_ZOOM = 1.5;
function show(object, reframe, centres) {
  somata = centres;
  if (current) { scene.remove(current); dispose(current); }
  current = object;
  scene.add(object);
  if (!reframe) return;
  // Orbit the middle neuron's soma, not the centre of the bounding box, which
  // sits on no neuron. The radius is measured from the soma so all of it fits.
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
  focus = Math.floor(centres.length / 2);
  const soma = new THREE.Vector3(...centres[focus]);
  sceneRadius = sphere.radius + sphere.center.distanceTo(soma);
  controls.target.copy(soma);
  camera.position.copy(soma).add(new THREE.Vector3(0.35, 0.15, 1).normalize().multiplyScalar(sceneRadius * 2.6 / START_ZOOM));
  controls.minDistance = sceneRadius / 2000; // close enough for fine branches, never onto the target
  controls.maxDistance = sceneRadius * 12;
  homeDistance = sceneRadius * 2.6;
  setHelpBaseline();
}

// --- wheel zoom ---------------------------------------------------------------
// Zooming toward the rotation centre alone ran the camera through the soma's
// wall, since the centre sits inside the soma, and left no way to zoom onto a
// branch. So the wheel zooms in toward the first surface under the cursor, or
// on the line to the centre when the cursor is over empty space. The view is
// scaled about that point, which stays put on screen and becomes the new centre;
// the camera only moves along an unobstructed line to it, so it never enters
// the neuron. Zooming out still backs away from the centre. Pinch zoom on touch
// screens is left to OrbitControls.
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
let anchor = null, anchorTime = 0, anchorX = 0, anchorY = 0;
function zoomAnchor(x, y) {
  const el = renderer.domElement, d = camera.position.distanceTo(controls.target);
  raycaster.params.Line.threshold = (4 * 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / el.clientHeight; // ~4 px
  pointer.set((x / el.clientWidth) * 2 - 1, 1 - (y / el.clientHeight) * 2);
  raycaster.setFromCamera(pointer, camera);
  const underCursor = current && raycaster.intersectObject(current, true)[0];
  if (underCursor) return underCursor.point;
  raycaster.set(camera.position, controls.target.clone().sub(camera.position).normalize());
  const inTheWay = current && raycaster.intersectObject(current, true)[0];
  return inTheWay && inTheWay.distance < d ? inTheWay.point : controls.target.clone();
}
// Listen on the view in the capture phase so this runs instead of OrbitControls' own wheel zoom.
$("view").addEventListener("wheel", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const rect = renderer.domElement.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const dy = Math.max(-200, Math.min(200, e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY));
  const d = camera.position.distanceTo(controls.target);
  const k = THREE.MathUtils.clamp(0.95 ** ((-controls.zoomSpeed * dy) / 100), controls.minDistance / d, controls.maxDistance / d);
  if (k >= 1) {
    camera.position.sub(controls.target).multiplyScalar(k).add(controls.target);
    anchor = null;
    return;
  }
  // One ray per gesture: a trackpad sends dozens of wheel events, and the point stays fixed while scaling.
  const now = performance.now();
  if (!anchor || now - anchorTime > 200 || Math.hypot(x - anchorX, y - anchorY) > 3) anchor = zoomAnchor(x, y);
  anchorTime = now; anchorX = x; anchorY = y;
  camera.position.sub(anchor).multiplyScalar(k).add(anchor);
  controls.target.sub(anchor).multiplyScalar(k).add(anchor);
}, { capture: true, passive: false });

// --- controls helper ----------------------------------------------------------
// A small corner checklist of the view's controls. A row ticks when the viewer
// really does that thing, in any order, and nothing has to be read or dismissed.
// Zoom and rotation are read from the camera, not from input events, so mouse,
// trackpad and pinch all count: wheel zoom and the arrow keys move the camera
// and the centre together, so camera − centre changes only with zoom and
// rotation. That offset can't see the arrow keys, so they report from their
// own handler. Left and right have nothing to step to with a single neuron, so
// the arrows row names only the keys that do something on the open tab.
const HELP_SEEN_KEY = "neurons.helpSeen";
const HELP_ZOOM_RATIO = 1.25; // about two wheel notches, so one stray notch doesn't count
const HELP_ROTATE_ANGLE = THREE.MathUtils.degToRad(15); // a drag, not a click that nudged the camera
const HELP_DONE_MS = 1500; // how long "You've got it" stays up
const coarsePointer = matchMedia("(pointer: coarse)").matches; // no keyboard, so no arrows row

const help = document.createElement("section");
help.id = "help";
help.setAttribute("aria-label", "View controls");
help.innerHTML = `<header><span aria-live="polite"></span><button aria-label="Hide the controls guide" title="Hide">×</button></header>
  <ul>
    <li data-does="zoom"><i></i><kbd>${coarsePointer ? "Pinch" : "Scroll"}</kbd>zoom</li>
    <li data-does="rotate"><i></i><kbd>Drag</kbd>rotate</li>
    ${coarsePointer ? "" : `<li data-does="centre"><i></i><kbd></kbd>move centre</li>`}
  </ul>`;
const helpTitle = help.querySelector("span"), helpArrows = help.querySelector("[data-does=centre] kbd");
const helpOpener = document.createElement("button");
helpOpener.id = "help-open";
helpOpener.textContent = "?";
helpOpener.title = "How to move around";
helpOpener.setAttribute("aria-label", "Show the controls guide");
$("view").append(help, helpOpener);

const helpFrom = new THREE.Vector3(), helpNow = new THREE.Vector3();
let helpOpen = false, helpDoneTimer = 0;
function setHelpBaseline() { helpFrom.subVectors(camera.position, controls.target); }
function setHelpOpen(open) {
  clearTimeout(helpDoneTimer);
  helpOpen = open;
  help.hidden = !open;
  helpOpener.hidden = open;
}
function closeHelp() {
  try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* no storage: it just shows again next visit */ }
  setHelpOpen(false);
}
function reopenHelp() {
  help.querySelectorAll("li").forEach((row) => row.classList.remove("done"));
  helpTitle.textContent = "Try it";
  setHelpBaseline();
  setHelpOpen(true);
}
function tick(does) {
  const row = help.querySelector(`[data-does=${does}]:not(.done)`);
  if (!helpOpen || !row) return;
  row.classList.add("done");
  if (help.querySelector("li:not(.done)")) return;
  helpTitle.textContent = "You've got it";
  helpDoneTimer = setTimeout(closeHelp, HELP_DONE_MS);
}
function watchHelp() {
  if (!helpOpen || !helpFrom.lengthSq()) return; // no baseline before the first neuron: angleTo a zero vector gives 90°
  helpNow.subVectors(camera.position, controls.target);
  const ratio = helpNow.length() / helpFrom.length();
  if (ratio > HELP_ZOOM_RATIO || ratio < 1 / HELP_ZOOM_RATIO) tick("zoom");
  if (helpNow.angleTo(helpFrom) > HELP_ROTATE_ANGLE) tick("rotate");
}
help.querySelector("button").addEventListener("click", closeHelp);
helpOpener.addEventListener("click", reopenHelp);
helpTitle.textContent = "Try it";
let helpSeen = false;
try { helpSeen = localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch { /* no storage: treat as a first visit */ }
setHelpOpen(!helpSeen);

// --- small UI builders ----------------------------------------------------
const label = (key) => key.replace(".", " · ").replace(/([A-Z])/g, " $1").toLowerCase();

function slider(parent, name, [lo, hi], get, set, integer = false) {
  const row = document.createElement("div");
  row.className = "row";
  const step = integer ? 1 : (hi - lo) / 100;
  row.innerHTML = `<label>${name}</label><input type="range" min="${lo}" max="${hi}" step="${step}"><span class="val"></span>`;
  const input = row.querySelector("input"), val = row.querySelector(".val");
  const fmt = (x) => (integer ? String(Math.round(x)) : Number(x).toPrecision(3));
  input.value = get();
  val.textContent = fmt(get());
  input.addEventListener("input", () => { val.textContent = fmt(input.value); set(Number(input.value)); });
  input.addEventListener("change", regenerate);
  parent.append(row);
}

function select(parent, name, options, get, set) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<label>${name}</label><select>${Object.entries(options)
    .map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>`;
  const s = row.querySelector("select");
  s.value = get();
  s.addEventListener("change", () => { set(s.value); renderControls(); regenerate(true); });
  parent.append(row);
}

function toggle(parent, name, get, set) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<label><input type="checkbox"> ${name}</label>`;
  const c = row.querySelector("input");
  c.checked = get();
  c.addEventListener("change", () => { set(c.checked); regenerate(); });
  parent.append(row);
}

function heading(parent, text) {
  const h = document.createElement("h2");
  h.textContent = text;
  parent.append(h);
}

function card(parent) {
  const d = document.createElement("div");
  d.className = "card";
  parent.append(d);
  return d;
}

const isInteger = (k) => /trunks|attractors/.test(k);
const algoOptions = Object.fromEntries(Object.values(ALGORITHMS).map((a) => [a.id, a.label]));

function renderControls() {
  const c = $("controls");
  c.replaceChildren();
  if (state.tab === "cell") {
    heading(c, "Growth");
    const growth = card(c);
    select(growth, "Algorithm", algoOptions, () => state.algo, (v) => { state.algo = v; });
    const a = ALGORITHMS[state.algo], p = state.params[a.id];
    for (const k of a.controls) slider(growth, label(k), a.box[k], () => p[k], (v) => { p[k] = v; }, isInteger(k));
    heading(c, "Display");
    const display = card(c);
    toggle(display, "Draw as tubes", () => state.asTubes, (v) => { state.asTubes = v; });
    const dl = document.createElement("button");
    dl.className = "btn";
    dl.textContent = "Download SWC";
    dl.onclick = () => download(`${state.algo}_${state.seed}.swc`, toSWC(tree, `${ALGORITHMS[state.algo].label}, seed ${state.seed}`));
    c.append(dl);
  }
}

// --- the two views ---------------------------------------------------------
function regenerate(reframe = false) {
  const status = $("status");
  status.textContent = "growing…";
  setTimeout(() => {
    const t0 = performance.now();
    if (state.tab === "cell") showCell(reframe);
    else showBenchmark();
    status.textContent = state.tab === "benchmark" ? "" : `generated in ${(performance.now() - t0).toFixed(0)} ms`;
  }, 10);
}

function showCell(reframe) {
  const a = ALGORITHMS[state.algo];
  tree = a.grow(state.params[a.id], new Rng(state.seed), real);
  const g = new THREE.Group();
  g.add(state.asTubes ? tubes(tree) : lines(tree));
  show(g, reframe || !current, [[tree.xyz[0], tree.xyz[1], tree.xyz[2]]]);
  setTags([]);

  const m = summary(tree);
  const rows = DENDRITE_METRICS.map((k) => {
    const [lo, mid, hi] = real.heldout[k], ok = m[k] >= lo && m[k] <= hi;
    return `<tr><td>${label(k).replace(/_/g, " ")}</td><td class="${ok ? "ok" : "out"}">${fmt(m[k])}</td><td>${fmt(lo)}–${fmt(hi)}</td></tr>`;
  }).join("");
  $("info").innerHTML = `<h2>Compared with real cells</h2>
    <div class="card"><table><tr><th></th><th>This cell</th><th>Real 5–95 %</th></tr>${rows}</table></div>`;
}

function showBenchmark() {
  // The three algorithms side by side, grown from the same seed, each tagged.
  const g = new THREE.Group(), algos = Object.values(ALGORITHMS);
  const somaAt = (i) => [(i - 1) * 900, 0, 0];
  algos.forEach((a, i) => {
    const t = a.grow(state.params[a.id], new Rng(state.seed), real);
    const cell = state.asTubes ? tubes(t) : lines(t);
    cell.position.set(...somaAt(i));
    g.add(cell);
  });
  show(g, true, algos.map((_, i) => somaAt(i)));
  setTags(algos.map((a, i) => [a.short, somaAt(i)]));

  // KS distance between generated and held-out real cells per measure (0 is
  // the same distribution, 1 no overlap), next to two sets of real cells.
  const rows = Object.entries(bench.algorithms), ref = bench.reference, n = DENDRITE_METRICS.length;
  const SHORT = { fitted: "Data-fit", lsystem: "L-sys", colonization: "Colon." };
  const ks = (d) => `<td class="${d <= bench.critical ? "ok" : "out"}">${d.toFixed(2)}</td>`;
  const summaryRow = (name, s, cls = "") =>
    `<tr class="${cls}"><td>${name}</td>${ks(s.untargeted)}${ks(s.targeted)}<td>${s.indistinguishable}/${n}</td></tr>`;
  const perMeasure = (keys) => keys.map((k) => `<tr><td>${label(k).replace(/_/g, " ")}</td>${rows.map(([, b]) =>
    ks(b.perMetric[k].ks)).join("")}${ks(ref.perMetric[k])}</tr>`).join("");
  const group = (title) => `<tr class="group"><td colspan="${rows.length + 2}">${title}</td></tr>`;
  const trained = DENDRITE_METRICS.filter((k) => !bench.untargeted.includes(k));
  $("info").innerHTML = `<h2>Distance from real cells</h2>
    <div class="card"><table class="ks"><tr><th></th><th>Unseen</th><th>Trained</th><th>Like real</th></tr>
      ${rows.map(([id, b]) => summaryRow(ALGORITHMS[id].short, { ...b.ks, indistinguishable: b.indistinguishable })).join("")}
      ${summaryRow("Real cells", ref, "ref")}</table></div>
    <p class="note">KS distance from ${bench.heldoutCells} held-out human cells; 0 is identical. Unseen: the Sholl
      counts, never fitted to. Like real: no significant difference.</p>
    <h2>Per measure</h2>
    <div class="card"><table class="ks"><tr><th></th>${rows.map(([id]) => `<th>${SHORT[id] ?? ALGORITHMS[id].short}</th>`).join("")}<th>Real</th></tr>
      ${group("Unseen")}${perMeasure(bench.untargeted)}${group("Trained")}${perMeasure(trained)}</table></div>`;
}

// Bottom-left key to the neurite colours.
function legend() {
  $("legend").innerHTML = [[COLORS[BASAL], "basal"], [COLORS[APICAL], "apical"], [COLORS[AXON], "axon"]]
    .map(([c, t]) => `<span><i style="background:#${c.toString(16).padStart(6, "0")}"></i>${t}</span>`).join("");
}
legend();

const fmt = (x) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString() : Number(x.toFixed(1)).toString());

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- wiring -----------------------------------------------------------------
function openTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === tab));
  history.replaceState(null, "", `#${tab}`);
  if (helpArrows) helpArrows.textContent = tab === "benchmark" ? "← → ↑ ↓" : "↑ ↓";
  renderControls();
  regenerate(true);
}
document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
$("seed").addEventListener("change", (e) => { state.seed = e.target.value.trim() || "1"; regenerate(); });
$("dice").addEventListener("click", () => {
  state.seed = Math.random().toString(36).slice(2, 7);
  $("seed").value = state.seed;
  regenerate();
});
const start = location.hash.slice(1);
openTab(["cell", "benchmark"].includes(start) ? start : "cell");
