import * as THREE from 'three';

// The six planes a 4D object can rotate in. xy, xz and yz are ordinary 3D
// rotations; xw, yw and zw turn the shape through the fourth axis.
export const PLANES = [
  { id: 'xy', a: 0, b: 1 },
  { id: 'xz', a: 0, b: 2 },
  { id: 'xw', a: 0, b: 3 },
  { id: 'yz', a: 1, b: 2 },
  { id: 'yw', a: 1, b: 3 },
  { id: 'zw', a: 2, b: 3 },
];

export const AXES = ['x', 'y', 'z', 'w'];

const EPS = 1e-6;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const sub = (a, b) => a.map((v, k) => v - b[k]);
const scale = (a, s) => a.map((v) => v * s);
const norm = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / norm(a));
const centroid = (points) => [0, 1, 2, 3].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length);
// Removes the components of v along each of the given unit vectors.
const reject = (v, units) => units.reduce((r, u) => sub(r, scale(u, dot(r, u))), v);

const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// Every sign pattern over n coordinates, as arrays of +1/-1.
function signPatterns(n) {
  return Array.from({ length: 1 << n }, (_, i) => Array.from({ length: n }, (_, k) => ((i >> k) & 1 ? 1 : -1)));
}

const axisNormals = () => [0, 1, 2, 3].flatMap((k) => [1, -1].map((s) => [0, 1, 2, 3].map((j) => (j === k ? s : 0))));

const TESSERACT_COLORS = {
  'x+': '#ff9150',
  'x-': '#ffc861',
  'y+': '#78e08c',
  'y-': '#2fd2b2',
  'z+': '#58a9ff',
  'z-': '#8f80ff',
  'w+': '#ff6096',
  'w-': '#d77fff',
};

const DEFINITIONS = [
  {
    id: 'tesseract',
    name: 'Tesseract',
    blurb: 'A four-dimensional cube projected into 3D.',
    faceKind: 'square',
    cellKind: ['cubic', 'cube', 'cubes'],
    vertices: () => signPatterns(4),
    normals: axisNormals,
    colors: TESSERACT_COLORS,
    // Hang the w+ cube off the y- cube so the flat net is Dalí's cross.
    net: { root: 'w-', parents: { 'w+': 'y-' } },
    cellsNote: 'A tesseract is bounded by eight cubes. Each one is where a single coordinate is pinned at +1 or −1.',
    unfoldNote: "Cut the tesseract open and lay its eight cubes out in 3D. The flat net is the cross in Dalí's <i>Corpus Hypercubus</i>.",
  },
  {
    id: '16-cell',
    name: '16-cell',
    blurb: 'The four-dimensional counterpart of the octahedron, projected into 3D.',
    faceKind: 'triangular',
    cellKind: ['tetrahedral', 'tetrahedron', 'tetrahedra'],
    vertices: () => axisNormals().map((v) => scale(v, 2)),
    normals: () => signPatterns(4).map((s) => scale(s, 0.5)),
    cellsNote: 'The 16-cell is bounded by sixteen tetrahedra, one for each way of choosing a sign on all four axes.',
    unfoldNote: 'Cut the 16-cell open and lay its sixteen tetrahedra out in 3D.',
  },
  {
    id: '24-cell',
    name: '24-cell',
    blurb: 'A regular shape with no counterpart in any other dimension, projected into 3D.',
    faceKind: 'triangular',
    cellKind: ['octahedral', 'octahedron', 'octahedra'],
    // Every permutation of (±√2, ±√2, 0, 0).
    vertices: () => {
      const out = [];
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) {
          for (const [sa, sb] of signPatterns(2)) {
            const v = [0, 0, 0, 0];
            v[a] = sa * Math.SQRT2;
            v[b] = sb * Math.SQRT2;
            out.push(v);
          }
        }
      }
      return out;
    },
    normals: () => [...axisNormals(), ...signPatterns(4).map((s) => scale(s, 0.5))],
    net: { root: 'w-' },
    cellsNote: 'The 24-cell is bounded by twenty-four octahedra. Eight face along the axes, and sixteen face the diagonals named by their signs.',
    unfoldNote: 'Cut the 24-cell open and lay its twenty-four octahedra out in 3D.',
  },
];

export const SHAPES = DEFINITIONS.map(({ id, name }) => ({ id, name }));

// Names a cell by the direction it faces: "x = +1" for an axis cell of the
// tesseract, "+x" for other axis cells, and a sign pattern for diagonal cells.
function describeCell(normal, offset) {
  const nonzero = [0, 1, 2, 3].filter((k) => Math.abs(normal[k]) > EPS);
  if (nonzero.length === 1) {
    const k = nonzero[0];
    const sign = normal[k] > 0 ? '+' : '−';
    const key = `${AXES[k]}${normal[k] > 0 ? '+' : '-'}`;
    if (Math.abs(offset - 1) < EPS) return { key, html: `<i>${AXES[k]}</i> = ${sign}1`, text: `where ${AXES[k]} = ${sign}1` };
    return { key, html: `${sign}<i>${AXES[k]}</i>`, text: `facing ${sign}${AXES[k]}` };
  }
  const signs = normal.map((c) => (c > 0 ? '+' : '−'));
  return {
    key: normal.map((c) => (c > 0 ? '+' : '-')).join(''),
    html: `<span class="cell-signs">${signs.join('')}</span>`,
    text: `facing (${signs.join(', ')})`,
  };
}

function cellColor(def, key, index, count) {
  if (def.colors?.[key]) return new THREE.Color(def.colors[key]);
  // Golden-ratio hue steps keep neighbouring cells visually distinct.
  const hue = (index * 0.618034 + 0.05) % 1;
  return new THREE.Color().setHSL(hue, 0.74, count > 16 ? 0.64 : 0.62, THREE.SRGBColorSpace);
}

// Orders a planar polygon's vertices around its centroid.
function orderPolygon(ids, vertices) {
  const pts = ids.map((i) => vertices[i]);
  const c = centroid(pts);
  const u = normalize(sub(pts[0], c));
  const v = normalize(reject(sub(pts[1], c), [u]));
  return ids
    .map((id, i) => {
      const d = sub(pts[i], c);
      return { id, angle: Math.atan2(dot(d, v), dot(d, u)) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((p) => p.id);
}

// Rotates v (in place) by angle in the plane spanned by unit vectors a and b,
// about the point origin.
export function rotateInPlane(v, origin, a, b, angle) {
  if (angle === 0) return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let ya = 0;
  let yb = 0;
  for (let k = 0; k < 4; k++) {
    const y = v[k] - origin[k];
    ya += y * a[k];
    yb += y * b[k];
  }
  const da = (c - 1) * ya - s * yb;
  const db = s * ya + (c - 1) * yb;
  for (let k = 0; k < 4; k++) v[k] += da * a[k] + db * b[k];
}

const ORIGIN = [0, 0, 0, 0];
const NET_FIT = 2.55;

function build(def) {
  const vertices = def.vertices();

  // Edges join the closest pairs of vertices.
  const pairs = [];
  let shortest = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const d = norm(sub(vertices[i], vertices[j]));
      pairs.push([i, j, d]);
      shortest = Math.min(shortest, d);
    }
  }
  const edges = pairs.filter(([, , d]) => d < shortest + EPS).map(([i, j]) => [i, j]);

  // Each cell is the set of vertices furthest along one facet normal.
  const normals = def.normals();
  const cells = normals.map((normal, index) => {
    const offset = Math.max(...vertices.map((v) => dot(v, normal)));
    const verts = vertices.map((_, i) => i).filter((i) => dot(vertices[i], normal) > offset - EPS);
    const members = new Set(verts);
    const label = describeCell(normal, offset);
    return {
      ...label,
      index,
      normal: normalize(normal),
      color: cellColor(def, label.key, index, normals.length),
      verts,
      has: (v) => members.has(v),
      edges: edges.map((_, e) => e).filter((e) => edges[e].every((v) => members.has(v))),
      faces: [],
    };
  });

  // Two cells that share at least three vertices meet in a polygonal face.
  const faces = [];
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const shared = cells[a].verts.filter((v) => cells[b].has(v));
      if (shared.length < 3) continue;
      const f = faces.length;
      faces.push({ verts: orderPolygon(shared, vertices), cells: [a, b] });
      cells[a].faces.push(f);
      cells[b].faces.push(f);
    }
  }

  const polytope = {
    ...def,
    vertices,
    edges,
    faces,
    cells,
    stats: `${vertices.length} vertices, ${edges.length} edges, ${faces.length} ${def.faceKind} faces, ${cells.length} ${def.cellKind[0]} cells`,
  };
  polytope.folded = foldedTopology(polytope);
  polytope.unfolded = unfoldedTopology(polytope);
  buildNet(polytope, def.net ?? {});
  return polytope;
}

// Folded, every element is drawn once.
function foldedTopology({ vertices, edges, faces, cells }) {
  return {
    points: vertices.map((_, id) => ({ id, cell: -1 })),
    edges: edges.map(([a, b], id) => ({ a, b, id })),
    faces: faces.map((face, id) => ({
      poly: face.verts,
      id,
      color: cells[face.cells[0]].color.clone().lerp(cells[face.cells[1]].color, 0.5),
      alpha: 1,
    })),
    cellEdges: cells.map((cell) => cell.edges.map((e) => edges[e])),
  };
}

// Unfolded, each cell carries its own copy of its vertices, edges and faces
// so it can swing away from the others. Copies keep the identity of the
// original element, so overlapping copies are always styled identically.
function unfoldedTopology({ edges, faces, cells }) {
  const topology = { points: [], edges: [], faces: [], cellEdges: [] };
  for (const cell of cells) {
    const offset = topology.points.length;
    const local = (v) => offset + cell.verts.indexOf(v);
    for (const id of cell.verts) topology.points.push({ id, cell: cell.index });
    for (const e of cell.edges) topology.edges.push({ a: local(edges[e][0]), b: local(edges[e][1]), id: e });
    for (const f of cell.faces) {
      topology.faces.push({ poly: faces[f].verts.map(local), id: f, color: cell.color, alpha: 0.5 });
    }
    topology.cellEdges.push(cell.edges.map((e) => edges[e].map(local)));
  }
  return topology;
}

// Builds a net: a spanning tree of cells joined by shared faces. Unfolding
// swings each cell about the face it shares with its parent until the two lie
// in the same 3D space, then turns the whole net to face the w axis.
function buildNet(polytope, { root: rootKey, parents: overrides = {} }) {
  const { vertices, faces, cells } = polytope;
  const neighbours = cells.map(() => []);
  faces.forEach((face, f) => {
    const [a, b] = face.cells;
    neighbours[a].push({ cell: b, face: f });
    neighbours[b].push({ cell: a, face: f });
  });

  const towardW = [0, 0, 0, -1];
  const root = rootKey
    ? cells.findIndex((c) => c.key === rootKey)
    : cells.reduce((best, c) => (dot(c.normal, towardW) > dot(cells[best].normal, towardW) + EPS ? c.index : best), 0);

  const parent = cells.map(() => null);
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const c = queue.shift();
    for (const n of neighbours[c]) {
      if (seen.has(n.cell)) continue;
      seen.add(n.cell);
      parent[n.cell] = { cell: c, face: n.face };
      queue.push(n.cell);
    }
  }
  for (const [childKey, parentKey] of Object.entries(overrides)) {
    const child = cells.findIndex((c) => c.key === childKey);
    const link = neighbours[child].find((n) => cells[n.cell].key === parentKey);
    if (link) parent[child] = { cell: link.cell, face: link.face };
  }

  const depth = (c) => (parent[c] ? depth(parent[c].cell) + 1 : 0);
  const cellCentroid = (c) => centroid(cells[c].verts.map((v) => vertices[v]));
  const hinges = cells.map((cell, c) => {
    if (!parent[c]) return null;
    const p = parent[c].cell;
    const faceVerts = faces[parent[c].face].verts.map((v) => vertices[v]);
    const f0 = centroid(faceVerts);
    const e1 = normalize(sub(faceVerts[1], faceVerts[0]));
    const e2 = normalize(reject(sub(faceVerts[2], faceVerts[0]), [e1]));
    // Directions from the face into each cell, with the face's own plane removed.
    const intoChild = normalize(reject(sub(cellCentroid(c), f0), [e1, e2]));
    const awayFromParent = scale(normalize(reject(sub(cellCentroid(p), f0), [e1, e2])), -1);
    const b = normalize(reject(awayFromParent, [intoChild]));
    return {
      origin: f0,
      a: intoChild,
      b,
      angle: Math.atan2(dot(awayFromParent, b), dot(awayFromParent, intoChild)),
      depth: depth(c),
    };
  });
  // Hinges are applied from the cell itself up toward the root.
  const chains = cells.map((_, c) => {
    const chain = [];
    for (let at = c; parent[at]; at = parent[at].cell) chain.push(hinges[at]);
    return chain;
  });

  // Deeper cells start swinging a little later, so the net opens in waves.
  const maxDepth = Math.max(...hinges.map((h) => h?.depth ?? 0));
  const span = 1 / (1 + 0.25 * (maxDepth - 1));
  const progress = (d, t) => smooth((t - (d - 1) * 0.25 * span) / span);

  // Turn the net so it lies flat across w, facing the viewer.
  const rootNormal = cells[root].normal;
  let align = null;
  if (dot(rootNormal, towardW) < 1 - EPS) {
    const q = normalize(reject(towardW, [rootNormal]));
    align = { a: rootNormal, b: q, angle: Math.atan2(dot(towardW, q), dot(towardW, rootNormal)) };
  }

  const place = (v, c, t, u) => {
    for (const h of chains[c]) rotateInPlane(v, h.origin, h.a, h.b, h.angle * progress(h.depth, t));
    if (align) rotateInPlane(v, ORIGIN, align.a, align.b, align.angle * u);
  };

  // Measure the fully open net so it can be centered and scaled to fit.
  const min = [Infinity, Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity, -Infinity];
  const flat = [];
  for (const { id, cell } of polytope.unfolded.points) {
    const v = [...vertices[id]];
    place(v, cell, 1, 1);
    flat.push(v);
    for (let k = 0; k < 4; k++) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  const center = min.map((m, k) => (m + max[k]) / 2);
  const reach = Math.max(...flat.map((v) => norm(sub(v, center))));
  const fit = Math.min(1, NET_FIT / reach);

  // t runs from 0 (folded) to 1 (flat net).
  polytope.unfold = (v, cell, t) => {
    if (t <= 0 || cell < 0) return;
    const u = smooth(t);
    place(v, cell, t, u);
    const s = 1 + (fit - 1) * u;
    for (let k = 0; k < 4; k++) v[k] = (v[k] - center[k] * u) * s;
  };
}

const cache = new Map();
export function getPolytope(id) {
  if (!cache.has(id)) cache.set(id, build(DEFINITIONS.find((d) => d.id === id) ?? DEFINITIONS[0]));
  return cache.get(id);
}
