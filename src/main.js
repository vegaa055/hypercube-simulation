import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PolytopeView } from './view.js';
import { getPolytope, SHAPES } from './polytopes.js';
import { Panel, el } from './panel.js';
import { defaultState, PLANE_IDS, PRESETS } from './state.js';

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const wrapSigned = (a) => wrap(a + Math.PI) - Math.PI;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const loader = window.__loader ?? { progress() {}, done() {}, fail() {} };

const state = defaultState();

loader.progress(0.4, 'Setting up the scene');

// Renderer, scene, camera --------------------------------------------------

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  loader.fail("This browser couldn't start WebGL, so the tesseract can't be drawn. Turn on hardware acceleration or try another browser.");
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
document.getElementById('app').append(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = createBackdrop();
scene.fog = new THREE.Fog(0x0c1233, 14, 30);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 200);
const HOME = new THREE.Vector3(5.4, 3.3, 7.6);
camera.position.copy(HOME);

scene.add(new THREE.HemisphereLight(0xc4d2ff, 0x1c1236, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 1.7);
key.position.set(4, 7, 5);
const rim = new THREE.DirectionalLight(0x8ea6ff, 0.9);
rim.position.set(-6, -2, -5);
scene.add(key, rim);

const grid = new THREE.GridHelper(28, 28, 0x3b4896, 0x232c63);
grid.position.y = -3.2;
scene.add(grid);

// The object group carries the 3D position, rotation and size. The current
// shape's view sits inside it and is swapped out when the shape changes.
const object = new THREE.Group();
scene.add(object);
let view = new PolytopeView(getPolytope(state.shape));
object.add(view.group);

function createBackdrop() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size * 0.42, 0, size / 2, size / 2, size * 0.75);
  gradient.addColorStop(0, '#1d2863');
  gradient.addColorStop(0.55, '#111847');
  gradient.addColorStop(1, '#090d29');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Post-processing ----------------------------------------------------------

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.4, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Camera and object controls ------------------------------------------------

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 2;
orbit.maxDistance = 40;

const gizmo = new TransformControls(camera, canvas);
gizmo.attach(object);
const gizmoHelper = gizmo.getHelper();
scene.add(gizmoHelper);
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});

function applyGizmo() {
  gizmo.enabled = state.gizmo;
  gizmoHelper.visible = state.gizmo;
  gizmo.setMode(state.gizmoMode);
}
applyGizmo();

// Shift-drag turns the shape through w instead of orbiting the camera.
// These listeners run in the capture phase so they fire before OrbitControls.
let turn = null;
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (!e.shiftKey || e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    turn = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-turning');
  },
  { capture: true },
);
canvas.addEventListener('pointermove', (e) => {
  if (!turn || e.pointerId !== turn.id) return;
  state.angles.xw = wrap(state.angles.xw + (e.clientX - turn.x) * 0.008);
  state.angles.yw = wrap(state.angles.yw - (e.clientY - turn.y) * 0.008);
  turn.x = e.clientX;
  turn.y = e.clientY;
});
const endTurn = (e) => {
  if (!turn || e.pointerId !== turn.id) return;
  turn = null;
  canvas.classList.remove('is-turning');
};
canvas.addEventListener('pointerup', endTurn);
canvas.addEventListener('pointercancel', endTurn);
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!e.shiftKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    // Some browsers report shift+wheel as horizontal scroll.
    state.angles.zw = wrap(state.angles.zw + (e.deltaY || e.deltaX) * 0.0025);
  },
  { capture: true, passive: false },
);

// Actions -------------------------------------------------------------------

function applyPreset(preset) {
  for (const id of PLANE_IDS) {
    state.auto[id] = !!preset.auto[id];
    if (preset.speed[id] != null) state.speed[id] = preset.speed[id];
  }
  state.playing = true;
}

// Animates the unfold amount. Unfolding also eases every angle back to zero so
// the net lies flat in 3D and reads as Dalí's cross.
let unfoldAnim = null;
function animateUnfold(to, { duration = 1.8, delay = 0 } = {}) {
  const straighten = to === 1;
  if (straighten) state.playing = false;
  unfoldAnim = {
    from: state.unfold,
    to,
    start: performance.now() + delay * 1000,
    duration: Math.max(0.35, duration * Math.abs(to - state.unfold)) * 1000,
    angles: straighten ? { ...state.angles } : null,
    resume: to === 0,
  };
  if (reducedMotion) unfoldAnim.duration = 1;
}

function stepUnfold(now) {
  const anim = unfoldAnim;
  if (!anim || now < anim.start) return;
  const p = Math.min(1, (now - anim.start) / anim.duration);
  const e = easeInOut(p);
  state.unfold = anim.from + (anim.to - anim.from) * e;
  if (anim.angles) {
    for (const id of PLANE_IDS) state.angles[id] = wrap(anim.angles[id] - wrapSigned(anim.angles[id]) * e);
  }
  if (p === 1) {
    unfoldAnim = null;
    if (anim.resume && !reducedMotion) state.playing = true;
  }
}

function toggleUnfold() {
  animateUnfold(state.unfold < 0.5 ? 1 : 0);
}

function resetTransform() {
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.setScalar(1);
}

// Swaps in another polytope. Cell highlights don't carry over, since each
// shape has its own cells.
let shapePop = null;
function setShape(id) {
  state.shape = id;
  if (view.polytope.id === id) return;
  state.highlight = 'none';
  state.highlightPreview = null;
  object.remove(view.group);
  view.dispose();
  view = new PolytopeView(getPolytope(id));
  object.add(view.group);
  showShapeInfo();
  if (!reducedMotion) shapePop = performance.now();
}

function resetCamera() {
  camera.position.copy(HOME);
  orbit.target.set(0, 0, 0);
  orbit.update();
}

function resetAll() {
  unfoldAnim = null;
  Object.assign(state, defaultState());
  setShape(state.shape);
  resetTransform();
  resetCamera();
  applyGizmo();
}

function saveImage() {
  const gizmoWasVisible = gizmoHelper.visible;
  gizmoHelper.visible = false;
  composer.render();
  canvas.toBlob((blob) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${view.polytope.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  gizmoHelper.visible = gizmoWasVisible;
}

// Panel ---------------------------------------------------------------------

const panel = new Panel(document.body);
const ui = document.body;

const playButton = el('button', 'btn play');
playButton.type = 'button';
playButton.addEventListener('click', () => (state.playing = !state.playing));
const hideButton = el(
  'button',
  'icon-btn',
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
);
hideButton.type = 'button';
hideButton.setAttribute('aria-label', 'Hide controls');
hideButton.addEventListener('click', () => setPanelVisible(false));
panel.head.append(playButton, hideButton);
panel.watch(() => {
  const label = state.playing ? 'Pause rotation' : 'Resume rotation';
  if (playButton.dataset.label === label) return;
  playButton.dataset.label = label;
  playButton.innerHTML = state.playing
    ? `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="2.6" height="10" rx="0.6"/><rect x="9.4" y="3" width="2.6" height="10" rx="0.6"/></svg>${label}`
    : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>${label}`;
});

// Shape
const shapeSection = panel.section('Shape');
shapeSection.segmented(null, {
  options: SHAPES.map(({ id, name }) => ({ value: id, label: name })),
  get: () => state.shape,
  set: setShape,
});

// Rotation
const rotation = panel.section('Rotation');
rotation.add(
  el(
    'div',
    'plane-head',
    '<span>Auto</span><span>Plane</span><span>Speed</span><span></span><span>Angle</span>',
  ),
);
for (const id of PLANE_IDS) {
  rotation.planeRow(`<i>${id}</i>`, {
    auto: { get: () => state.auto[id], set: (v) => (state.auto[id] = v) },
    speed: { min: -180, max: 180, get: () => state.speed[id], set: (v) => (state.speed[id] = v) },
    angle: { get: () => state.angles[id], set: (v) => (state.angles[id] = v) },
  });
}
rotation.note(
  'Planes with <i>w</i> turn the cube through the fourth dimension. The other three are ordinary 3D spins.',
);
rotation.segmented('Presets', {
  stacked: true,
  options: PRESETS.map((preset, i) => ({ value: i, label: preset.label })),
  get: () =>
    PRESETS.findIndex((p) => PLANE_IDS.every((id) => !!p.auto[id] === state.auto[id] && (!p.auto[id] || p.speed[id] === state.speed[id]))),
  set: (i) => applyPreset(PRESETS[i]),
});
rotation.slider('Overall speed', {
  min: 0,
  max: 3,
  step: 0.05,
  digits: 2,
  unit: '×',
  get: () => state.speedScale,
  set: (v) => (state.speedScale = v),
});
rotation.toggle('Trace vertex paths', { get: () => state.trails, set: (v) => (state.trails = v) });
rotation.slider('Trail length', {
  min: 10,
  max: 240,
  step: 1,
  digits: 0,
  get: () => state.trailLength,
  set: (v) => (state.trailLength = v),
  enabled: () => state.trails,
});
rotation.buttons([
  {
    label: 'Zero all angles',
    onClick: () => PLANE_IDS.forEach((id) => (state.angles[id] = 0)),
  },
  {
    label: 'Turn off all planes',
    onClick: () => PLANE_IDS.forEach((id) => (state.auto[id] = false)),
  },
]);

// Unfold
const unfold = panel.section('Unfold');
const unfoldNote = unfold.note('');
const unfoldButton = unfold.buttons([{ label: 'Unfold into a net', onClick: toggleUnfold }]).firstChild;
panel.watch(() => {
  const target = unfoldAnim ? unfoldAnim.to : state.unfold < 0.5 ? 0 : 1;
  const label = target === 1 ? 'Fold back up' : 'Unfold into a net';
  if (unfoldButton.textContent !== label) unfoldButton.textContent = label;
});
unfold.slider('Unfolded', {
  min: 0,
  max: 100,
  step: 1,
  digits: 0,
  unit: '%',
  get: () => Math.round(state.unfold * 100),
  set: (v) => {
    unfoldAnim = null;
    state.unfold = v / 100;
  },
});

// Cross-section
const slice = panel.section('Cross-section');
const sliceNote = slice.note('');
slice.toggle('Show the slice', { get: () => state.slice, set: (v) => (state.slice = v) });
slice.slider('Slice at <i>w</i>', {
  min: -2.2,
  max: 2.2,
  step: 0.01,
  get: () => state.sliceLevel,
  set: (v) => {
    state.sliceLevel = v;
    state.sliceSweep = false;
  },
  enabled: () => state.slice,
});
slice.toggle('Sweep back and forth', {
  get: () => state.sliceSweep,
  set: (v) => (state.sliceSweep = v),
  enabled: () => state.slice,
});
slice.toggle('Dim the rest of the shape', {
  get: () => state.ghost,
  set: (v) => (state.ghost = v),
  enabled: () => state.slice,
});

// Cells
const cells = panel.section('Cells', { open: false });
const cellsNote = cells.note('');
const cellGrid = cells.add(el('div', 'cell-grid'));
const cellButtons = [];
const clearCell = el('button', 'cell-btn cell-none', 'No highlight');
clearCell.type = 'button';
clearCell.addEventListener('click', () => (state.highlight = 'none'));
panel.watch(() => {
  for (const [keyName, button] of cellButtons) {
    const on = String(state.highlight === keyName);
    if (button.getAttribute('aria-pressed') !== on) button.setAttribute('aria-pressed', on);
  }
  const none = String(state.highlight === 'none');
  if (clearCell.getAttribute('aria-pressed') !== none) clearCell.setAttribute('aria-pressed', none);
});

function buildCellButtons(polytope) {
  cellButtons.length = 0;
  cellGrid.replaceChildren();
  cellGrid.classList.toggle('is-dense', polytope.cells.length > 8);
  for (const cell of polytope.cells) {
    const button = el('button', 'cell-btn', `<span class="cell-dot" style="background:#${cell.color.getHexString()}"></span>${cell.html}`);
    button.type = 'button';
    button.setAttribute('aria-label', `Highlight the ${polytope.cellKind[1]} ${cell.text}`);
    button.addEventListener('click', () => (state.highlight = state.highlight === cell.key ? 'none' : cell.key));
    button.addEventListener('pointerenter', () => (state.highlightPreview = cell.key));
    button.addEventListener('pointerleave', () => (state.highlightPreview = null));
    button.addEventListener('focus', () => (state.highlightPreview = cell.key));
    button.addEventListener('blur', () => (state.highlightPreview = null));
    cellGrid.append(button);
    cellButtons.push([cell.key, button]);
  }
  cellGrid.append(clearCell);
}

// Projection
const projection = panel.section('Projection', { open: false });
projection.segmented('Type', {
  options: [
    { value: 'perspective', label: 'Perspective' },
    { value: 'orthographic', label: 'Orthographic' },
  ],
  get: () => state.projection,
  set: (v) => (state.projection = v),
});
projection.slider('Eye distance in <i>w</i>', {
  min: 2.2,
  max: 10,
  step: 0.05,
  get: () => state.wDistance,
  set: (v) => (state.wDistance = v),
  enabled: () => state.projection === 'perspective',
});
projection.slider('Shift along <i>w</i>', {
  min: -2.5,
  max: 2.5,
  step: 0.01,
  get: () => state.wOffset,
  set: (v) => (state.wOffset = v),
});
projection.toggle('Thicker when nearer in <i>w</i>', {
  get: () => state.depthScale,
  set: (v) => (state.depthScale = v),
  enabled: () => state.projection === 'perspective',
});

// Transform
const transform = panel.section('Position and size', { open: false });
const { position, scale } = object;
for (const axis of ['x', 'y', 'z']) {
  transform.slider(`Position <i>${axis}</i>`, {
    min: -6,
    max: 6,
    step: 0.01,
    get: () => position[axis],
    set: (v) => (position[axis] = v),
  });
}
transform.slider('Size', {
  min: 0.2,
  max: 3,
  step: 0.01,
  unit: '×',
  get: () => scale.x,
  set: (v) => scale.setScalar(v),
});
transform.toggle('Show move gizmo', {
  get: () => state.gizmo,
  set: (v) => {
    state.gizmo = v;
    applyGizmo();
  },
});
transform.segmented('Gizmo mode', {
  options: [
    { value: 'translate', label: 'Move' },
    { value: 'rotate', label: 'Rotate' },
    { value: 'scale', label: 'Scale' },
  ],
  get: () => state.gizmoMode,
  set: (v) => {
    state.gizmoMode = v;
    applyGizmo();
  },
  enabled: () => state.gizmo,
});
transform.buttons([
  { label: 'Reset position', onClick: resetTransform },
  { label: 'Reset camera', onClick: resetCamera },
]);

// Appearance
const look = panel.section('Appearance', { open: false });
look.toggle('Edges', { get: () => state.showEdges, set: (v) => (state.showEdges = v) });
look.slider('Edge thickness', {
  min: 0.005,
  max: 0.12,
  step: 0.001,
  digits: 3,
  get: () => state.edgeRadius,
  set: (v) => (state.edgeRadius = v),
  enabled: () => state.showEdges,
});
look.toggle('Vertices', { get: () => state.showVertices, set: (v) => (state.showVertices = v) });
look.slider('Vertex size', {
  min: 0.01,
  max: 0.25,
  step: 0.001,
  digits: 3,
  get: () => state.vertexRadius,
  set: (v) => (state.vertexRadius = v),
  enabled: () => state.showVertices,
});
look.toggle('Faces', { get: () => state.showFaces, set: (v) => (state.showFaces = v) });
look.slider('Face opacity', {
  min: 0,
  max: 0.6,
  step: 0.01,
  get: () => state.faceOpacity,
  set: (v) => (state.faceOpacity = v),
  enabled: () => state.showFaces,
});
look.segmented('Color', {
  options: [
    { value: 'depth', label: 'By <i>w</i>' },
    { value: 'cell', label: 'By cell' },
    { value: 'solid', label: 'Solid' },
  ],
  get: () => state.colorMode,
  set: (v) => (state.colorMode = v),
});
look.color('Solid color', {
  get: () => state.solidColor,
  set: (v) => (state.solidColor = v),
  enabled: () => state.colorMode === 'solid',
});
look.slider('Glow', {
  min: 0,
  max: 2,
  step: 0.01,
  get: () => state.glow,
  set: (v) => (state.glow = v),
});
look.toggle('Bloom', { get: () => state.bloom, set: (v) => (state.bloom = v) });
look.slider('Bloom strength', {
  min: 0,
  max: 2.5,
  step: 0.01,
  get: () => state.bloomStrength,
  set: (v) => (state.bloomStrength = v),
  enabled: () => state.bloom,
});
look.toggle('Floor grid', { get: () => state.grid, set: (v) => (state.grid = v) });

const footer = el('div', 'panel-foot');
for (const [label, onClick] of [
  ['Save image', saveImage],
  ['Reset everything', resetAll],
]) {
  const button = el('button', 'btn', label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  footer.append(button);
}
panel.body.append(footer);

panel.watch(() => ui.classList.toggle('is-depth', state.colorMode === 'depth' && state.unfold < 0.5));

// Header text, notes and cell buttons that describe the current shape.
const shapeName = document.getElementById('shape-name');
const shapeBlurb = document.getElementById('shape-blurb');
const shapeStats = document.getElementById('shape-stats');
function showShapeInfo() {
  const polytope = view.polytope;
  document.title = polytope.name;
  shapeName.textContent = polytope.name;
  shapeBlurb.textContent = polytope.blurb;
  shapeStats.textContent = polytope.stats;
  unfoldNote.innerHTML = polytope.unfoldNote;
  sliceNote.innerHTML = `Cut through it with a flat 3D space at one value of <i>w</i>. The colored solid is what a 3D observer would see as the ${polytope.name.toLowerCase()} passes through.`;
  cellsNote.innerHTML = polytope.cellsNote;
  buildCellButtons(polytope);
}
showShapeInfo();

// Panel visibility and keyboard ---------------------------------------------

const showButton = el('button', 'btn show-panel', 'Show controls');
showButton.type = 'button';
showButton.addEventListener('click', () => setPanelVisible(true));
document.body.append(showButton);

function setPanelVisible(visible) {
  ui.classList.toggle('panel-hidden', !visible);
  (visible ? hideButton : showButton).focus({ preventScroll: true });
  updateViewOffset();
}

// The help card folds away after the first drag and can be reopened.
const setHints = (visible) => ui.classList.toggle('hints-hidden', !visible);
document.getElementById('hints-close').addEventListener('click', () => setHints(false));
document.getElementById('hints-open').addEventListener('click', () => setHints(true));
canvas.addEventListener('pointerdown', () => setHints(false), { once: true });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, button, summary, [role="slider"]')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    state.playing = !state.playing;
    e.preventDefault();
  } else if (k === 'u') {
    toggleUnfold();
  } else if (k === 'c') {
    state.slice = !state.slice;
  } else if (k === 'p') {
    state.trails = !state.trails;
  } else if (k === 'g') {
    state.gizmo = !state.gizmo;
    applyGizmo();
  } else if (k === 't' || k === 'r' || k === 's') {
    state.gizmoMode = { t: 'translate', r: 'rotate', s: 'scale' }[k];
    state.gizmo = true;
    applyGizmo();
  } else if (k === 'h') {
    setPanelVisible(ui.classList.contains('panel-hidden'));
  } else if (k === '?') {
    setHints(ui.classList.contains('hints-hidden'));
  } else if (k === 'escape') {
    state.highlight = 'none';
  } else if (SHAPES[Number(k) - 1]) {
    setShape(SHAPES[Number(k) - 1].id);
  }
});

// Keep the shape centered in the space the panel leaves free, and widen
// the field of view on tall screens so it still fits side to side.
function updateViewOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let dx = 0;
  let dy = 0;
  if (!ui.classList.contains('panel-hidden')) {
    const rect = panel.el.getBoundingClientRect();
    if (w > 760) dx = (w - rect.left + 16) / 2;
    else dy = (h - rect.top) / 2;
  }
  const aspect = w / h;
  const fitWidth = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(24)) / aspect));
  camera.fov = Math.max(38, fitWidth);
  camera.aspect = aspect;
  camera.setViewOffset(w, h, dx, dy, w, h);
  camera.updateProjectionMatrix();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  updateViewOffset();
}
window.addEventListener('resize', resize);
new ResizeObserver(updateViewOffset).observe(panel.el);
resize();

// Loop ----------------------------------------------------------------------

const timer = new THREE.Timer();
let sweepPhase = 0;

function frame(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const now = performance.now();
  stepUnfold(now);
  if (shapePop !== null) {
    // A new shape grows briefly into place so the switch reads as a change.
    const p = Math.min(1, (now - shapePop) / 450);
    view.group.scale.setScalar(0.8 + 0.2 * (1 - Math.pow(1 - p, 3)));
    if (p === 1) shapePop = null;
  }
  if (state.playing && !unfoldAnim) {
    for (const id of PLANE_IDS) {
      if (state.auto[id]) {
        state.angles[id] = wrap(state.angles[id] + THREE.MathUtils.degToRad(state.speed[id] * state.speedScale) * dt);
      }
    }
  }
  if (state.slice && state.sliceSweep) {
    sweepPhase += dt * 0.55 * (reducedMotion ? 0.4 : 1);
    const [low, high] = view.wRange;
    state.sliceLevel = (low + high) / 2 + ((high - low) / 2) * 0.94 * Math.sin(sweepPhase);
  }
  orbit.update(dt);
  view.update(state);
  grid.visible = state.grid;
  bloom.enabled = state.bloom;
  bloom.strength = state.bloomStrength;
  panel.refresh();
  composer.render(dt);
}

// Startup -------------------------------------------------------------------

async function start() {
  loader.progress(0.55, 'Loading fonts');
  await Promise.race([document.fonts.ready, sleep(2500)]);

  loader.progress(0.75, 'Compiling shaders');
  // Start as the flat net so the intro can fold it up.
  state.unfold = reducedMotion ? 0 : 1;
  state.playing = false;
  view.showAll();
  await renderer.compileAsync(scene, camera);
  view.update(state);
  composer.render();

  loader.progress(1, 'Ready');
  // Leave the loader up long enough to register instead of flashing.
  await sleep(Math.max(0, 1100 - performance.now()));
  loader.done();
  renderer.setAnimationLoop(frame);

  if (reducedMotion) return;
  animateUnfold(0, { duration: 2.6, delay: 0.7 });
}

start().catch((error) => {
  loader.fail(`Something went wrong while starting: ${error.message}. Reload the page to try again.`);
  console.error(error);
});
