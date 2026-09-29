import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PLANES } from './polytopes.js';

const COOL = new THREE.Color('#35c8f0');
const MID = new THREE.Color('#b4acff');
const WARM = new THREE.Color('#ff4d6a');
const GOLD = new THREE.Color('#ffcf6e');
const SLICE_EDGE = new THREE.Color('#e9dcb8');
const W_RANGE = 1.25;
const DIM = 0.26;
const GHOST = 0.3;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

function depthColor(w, out) {
  const t = clamp01(0.5 + w / (2 * W_RANGE));
  return t < 0.5 ? out.lerpColors(COOL, MID, t * 2) : out.lerpColors(MID, WARM, (t - 0.5) * 2);
}

// Adds self-illumination proportional to the surface color so the bloom pass
// has something to catch without washing out the lit shading.
function injectGlow(material, shader) {
  shader.uniforms.uGlow = material.userData.glow;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uGlow;')
    .replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;',
    );
}

function createBallMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 });
  material.userData.glow = { value: 0.3 };
  material.onBeforeCompile = (shader) => injectGlow(material, shader);
  material.customProgramCacheKey = () => 'tesseract-ball';
  return material;
}

// Tubes are unit cylinders stretched between two points. Each instance carries
// a radius and color for both ends, so one tube can taper and fade along w.
function createTubeMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
  material.userData.glow = { value: 0.3 };
  material.onBeforeCompile = (shader) => {
    injectGlow(material, shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aRadius;
attribute vec3 aColorA;
attribute vec3 aColorB;
varying vec3 vTubeColor;`,
      )
      .replace(
        '#include <begin_vertex>',
        `float tubeT = position.y + 0.5;
float tubeR = mix(aRadius.x, aRadius.y, tubeT);
vec3 transformed = vec3(position.x * tubeR, position.y, position.z * tubeR);
vTubeColor = mix(aColorA, aColorB, tubeT);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTubeColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTubeColor;');
  };
  material.customProgramCacheKey = () => 'tesseract-tube';
  return material;
}

class TubeSet {
  constructor(max, material) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
    this.radius = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.colorA = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.colorB = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const attr of [this.radius, this.colorA, this.colorB]) attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRadius', this.radius);
    geometry.setAttribute('aColorA', this.colorA);
    geometry.setAttribute('aColorB', this.colorB);
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.n = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  begin() {
    this.n = 0;
  }

  push(pa, pb, ra, rb, ca, cb, scale = 1) {
    const i = this.n++;
    const dir = this._dir.subVectors(pb, pa);
    const length = dir.length();
    if (length > 1e-6) this._q.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.divideScalar(length));
    this._mid.addVectors(pa, pb).multiplyScalar(0.5);
    this._s.set(1, Math.max(length, 1e-4), 1);
    this.mesh.setMatrixAt(i, this._m.compose(this._mid, this._q, this._s));
    this.radius.setXY(i, ra, rb);
    this.colorA.setXYZ(i, ca.r * scale, ca.g * scale, ca.b * scale);
    this.colorB.setXYZ(i, cb.r * scale, cb.g * scale, cb.b * scale);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.radius.needsUpdate = true;
    this.colorA.needsUpdate = true;
    this.colorB.needsUpdate = true;
  }
}

class BallSet {
  constructor(max, material) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // Allocate instanceColor up front so the shader compiles with it.
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, MID);
    this.n = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  begin() {
    this.n = 0;
  }

  push(p, r, color, scale = 1) {
    const i = this.n++;
    this._s.setScalar(r);
    this.mesh.setMatrixAt(i, this._m.compose(p, this._q, this._s));
    this.mesh.setColorAt(i, this._c.copy(color).multiplyScalar(scale));
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// Translucent polygons with per-vertex RGBA color, rebuilt every frame.
class PolygonSet {
  constructor(maxVerts, maxTris, material) {
    this.position = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(maxVerts * 4), 4);
    this.index = new THREE.BufferAttribute(new Uint16Array(maxTris * 3), 1);
    for (const attr of [this.position, this.color, this.index]) attr.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setIndex(this.index);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.nv = 0;
    this.ni = 0;
  }

  begin() {
    this.nv = 0;
    this.ni = 0;
  }

  vertex(p, color, alpha) {
    this.position.setXYZ(this.nv, p.x, p.y, p.z);
    this.color.setXYZW(this.nv, color.r, color.g, color.b, alpha);
    return this.nv++;
  }

  triangle(a, b, c) {
    this.index.array[this.ni++] = a;
    this.index.array[this.ni++] = b;
    this.index.array[this.ni++] = c;
  }

  end() {
    this.mesh.geometry.setDrawRange(0, this.ni);
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
    this.index.needsUpdate = true;
  }
}

// Fading light trails behind the vertices of the folded shape. Drawn as
// screen-space fat lines with additive blending, so fading a segment's color
// toward black fades it out.
class Trails {
  constructor(points, max) {
    this.points = points;
    this.max = max;
    this.history = new Float32Array(points * max * 3);
    this.historyColor = new Float32Array(points * max * 3);
    this.head = -1;
    this.count = 0;
    const segments = points * (max - 1);
    this.positions = new Float32Array(segments * 6);
    this.colors = new Float32Array(segments * 6);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(this.positions);
    geometry.setColors(this.colors);
    this.mesh = new LineSegments2(
      geometry,
      new LineMaterial({
        vertexColors: true,
        linewidth: 2.5,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  clear() {
    this.head = -1;
    this.count = 0;
  }

  record(positions, colors) {
    const { max, history: h } = this;
    if (this.count > 0) {
      let moved = 0;
      for (let i = 0; i < this.points; i++) {
        const o = (i * max + this.head) * 3;
        moved = Math.max(moved, positions[i].distanceToSquared({ x: h[o], y: h[o + 1], z: h[o + 2] }));
      }
      if (moved < 1e-7) return;
    }
    this.head = (this.head + 1) % max;
    this.count = Math.min(this.count + 1, max);
    for (let i = 0; i < this.points; i++) {
      const o = (i * max + this.head) * 3;
      h[o] = positions[i].x;
      h[o + 1] = positions[i].y;
      h[o + 2] = positions[i].z;
      this.historyColor[o] = colors[i].r;
      this.historyColor[o + 1] = colors[i].g;
      this.historyColor[o + 2] = colors[i].b;
    }
  }

  build(length, opacity) {
    const { max, history: h, historyColor: hc, positions: pos, colors: col } = this;
    const n = Math.min(this.count, length);
    let v = 0;
    for (let i = 0; i < this.points; i++) {
      for (let k = 0; k < n - 1; k++) {
        for (const age of [k, k + 1]) {
          const o = (i * max + ((this.head - age + max) % max)) * 3;
          const fade = Math.pow(1 - age / length, 1.6) * opacity;
          pos[v] = h[o];
          pos[v + 1] = h[o + 1];
          pos[v + 2] = h[o + 2];
          col[v] = hc[o] * fade;
          col[v + 1] = hc[o + 1] * fade;
          col[v + 2] = hc[o + 2] * fade;
          v += 3;
        }
      }
    }
    const geometry = this.mesh.geometry;
    geometry.instanceCount = v / 6;
    geometry.attributes.instanceStart.data.needsUpdate = true;
    geometry.attributes.instanceColorStart.data.needsUpdate = true;
  }
}

// Renders one polytope: rotates and projects it from 4D every frame, and draws
// its edges, vertices, faces, cross-section and trails.
export class PolytopeView {
  constructor(polytope) {
    this.polytope = polytope;
    this.group = new THREE.Group();
    const { folded, unfolded, cells, vertices } = polytope;

    this.tubeMaterial = createTubeMaterial();
    this.ballMaterial = createBallMaterial();
    this.faceMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sliceMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const faceVerts = unfolded.faces.reduce((n, f) => n + f.poly.length, 0);
    const faceTris = unfolded.faces.reduce((n, f) => n + f.poly.length - 2, 0);
    // A cell sliced by a flat 3D space leaves a polygon of at most six corners.
    const sliceSlots = cells.length * 6;
    this.edges = new TubeSet(unfolded.edges.length, this.tubeMaterial);
    this.vertices = new BallSet(unfolded.points.length, this.ballMaterial);
    this.faces = new PolygonSet(faceVerts, faceTris, this.faceMaterial);
    this.sliceFill = new PolygonSet(sliceSlots, cells.length * 4, this.sliceMaterial);
    this.sliceEdges = new TubeSet(sliceSlots, this.tubeMaterial);
    this.sliceJoints = new BallSet(sliceSlots, this.ballMaterial);
    this.trails = new Trails(vertices.length, 240);

    this.group.add(
      this.faces.mesh,
      this.sliceFill.mesh,
      this.edges.mesh,
      this.vertices.mesh,
      this.sliceEdges.mesh,
      this.sliceJoints.mesh,
      this.trails.mesh,
    );

    // Translucent faces add up where they overlap, so shapes with many faces
    // get fainter ones to keep the same overall haze.
    this.faceScale = Math.sqrt(24 / folded.faces.length);

    const n = unfolded.points.length;
    this.p4 = new Float32Array(n * 4);
    this.p3 = Array.from({ length: n }, () => new THREE.Vector3());
    this.factor = new Float32Array(n);
    this.colors = Array.from({ length: n }, () => new THREE.Color());
    // The folded vertices, tracked separately for the trails.
    this.home3 = vertices.map(() => new THREE.Vector3());
    this.homeColors = vertices.map(() => new THREE.Color());

    this.wRange = [-2, 2];
    this._v = [0, 0, 0, 0];
    this._out = [0, 0, 0, 0];
    this._c = new THREE.Color();
    this._solid = new THREE.Color();
    this._slice = Array.from({ length: 6 }, () => new THREE.Vector3());
    this._order = Array.from({ length: 6 }, () => ({ angle: 0, p: new THREE.Vector3() }));
    this._tmp = Array.from({ length: 5 }, () => new THREE.Vector3());
  }

  // Makes every part visible so shaders can be compiled up front.
  showAll() {
    for (const child of this.group.children) child.visible = true;
  }

  dispose() {
    this.group.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      object.geometry?.dispose();
    });
    const materials = [this.tubeMaterial, this.ballMaterial, this.faceMaterial, this.sliceMaterial, this.trails.mesh.material];
    for (const material of materials) material.dispose();
  }

  // Unfold, rotate and offset one vertex. Writes the 4D result into out4 and
  // returns its projection factor.
  transform(id, cell, t, trig, state, out4) {
    const v = this._v;
    const source = this.polytope.vertices[id];
    for (let k = 0; k < 4; k++) v[k] = source[k];
    this.polytope.unfold(v, cell, t);
    for (let p = 0; p < PLANES.length; p++) {
      const { a, b } = PLANES[p];
      const [c, s] = trig[p];
      const va = v[a];
      const vb = v[b];
      v[a] = c * va - s * vb;
      v[b] = s * va + c * vb;
    }
    v[3] += state.wOffset;
    for (let k = 0; k < 4; k++) out4[k] = v[k];
    return this.projectFactor(v[3], state);
  }

  // The 4D eye sits at w = wDistance looking toward -w. Normalized so a point
  // at w = 0 keeps its size whatever the eye distance.
  projectFactor(w, state) {
    if (state.projection !== 'perspective') return 1;
    return state.wDistance / Math.max(state.wDistance - w, 0.15);
  }

  update(state) {
    const trig = PLANES.map((p) => [Math.cos(state.angles[p.id]), Math.sin(state.angles[p.id])]);
    const t = state.unfold;
    const topology = t > 0 ? this.polytope.unfolded : this.polytope.folded;
    const key = state.highlightPreview ?? state.highlight;
    const selected = this.polytope.cells.find((cell) => cell.key === key) ?? null;
    const solid = state.colorMode === 'solid' ? this._solid.set(state.solidColor) : null;
    const pointColor = (w, out) => {
      if (solid) return out.copy(solid);
      if (state.colorMode === 'cell') return out.copy(MID);
      return depthColor(w, out);
    };
    const out4 = this._out;
    // How far the shape currently reaches along w, so a sweeping slice can
    // stay inside it.
    this.wRange[0] = Infinity;
    this.wRange[1] = -Infinity;

    topology.points.forEach(({ id, cell }, i) => {
      const f = this.transform(id, cell, t, trig, state, out4);
      this.wRange[0] = Math.min(this.wRange[0], out4[3]);
      this.wRange[1] = Math.max(this.wRange[1], out4[3]);
      this.p4.set(out4, i * 4);
      this.factor[i] = f;
      this.p3[i].set(out4[0] * f, out4[1] * f, out4[2] * f);
      pointColor(out4[3], this.colors[i]);
    });

    this.tubeMaterial.userData.glow.value = state.glow;
    this.ballMaterial.userData.glow.value = state.glow;

    const ghost = state.slice && state.ghost ? GHOST : 1;
    const thickness = (f) => (state.depthScale ? Math.pow(THREE.MathUtils.clamp(f, 0.2, 4), 0.8) : 1);
    const ctx = { state, topology, selected, thickness, ghost, unfold: smooth(t) };

    this.edges.mesh.visible = state.showEdges;
    if (state.showEdges) this.updateEdges(ctx);
    this.vertices.mesh.visible = state.showVertices;
    if (state.showVertices) this.updateVertices(ctx);
    this.faces.mesh.visible = state.showFaces;
    if (state.showFaces) this.updateFaces(ctx);

    for (const part of [this.sliceFill, this.sliceEdges, this.sliceJoints]) part.mesh.visible = state.slice;
    if (state.slice) this.updateSlice(ctx);

    this.updateTrails(state, trig, t, pointColor);
  }

  updateEdges({ state, topology, selected, thickness, ghost }) {
    const { points } = topology;
    this.edges.begin();
    for (const { a, b } of topology.edges) {
      let radius = state.edgeRadius;
      let dim = ghost;
      let tint = null;
      if (selected) {
        if (selected.has(points[a].id) && selected.has(points[b].id)) {
          radius *= 1.5;
          tint = GOLD;
        } else {
          radius *= 0.75;
          dim *= DIM;
        }
      }
      if (ghost < 1) radius *= 0.55;
      this.edges.push(
        this.p3[a],
        this.p3[b],
        radius * thickness(this.factor[a]),
        radius * thickness(this.factor[b]),
        tint ?? this.colors[a],
        tint ?? this.colors[b],
        dim,
      );
    }
    this.edges.end();
  }

  updateVertices({ state, topology, selected, thickness, ghost }) {
    this.vertices.begin();
    topology.points.forEach(({ id }, i) => {
      const highlighted = selected?.has(id);
      let r = state.vertexRadius * thickness(this.factor[i]);
      if (selected) r *= highlighted ? 1.3 : 0.8;
      if (ghost < 1) r *= 0.55;
      const dim = ghost * (selected && !highlighted ? DIM : 1);
      this.vertices.push(this.p3[i], r, highlighted ? GOLD : this.colors[i], dim);
    });
    this.vertices.end();
  }

  updateFaces({ state, topology, selected, ghost, unfold }) {
    const { points } = topology;
    const color = this._c;
    const split = topology === this.polytope.unfolded;
    this.faces.begin();
    for (const face of topology.faces) {
      const highlighted = selected && face.poly.every((p) => selected.has(points[p].id));
      let alpha = state.faceOpacity * this.faceScale * face.alpha;
      if (split) alpha *= 1 + 2.2 * unfold;
      if (selected) alpha = highlighted ? Math.min(1, alpha * 2 + 0.12) : alpha * 0.3;
      alpha *= ghost < 1 ? 0.2 : 1;
      const first = this.faces.nv;
      for (const p of face.poly) {
        if (highlighted) color.copy(GOLD);
        else if (state.colorMode === 'cell') color.copy(face.color);
        else color.copy(this.colors[p]).lerp(face.color, unfold);
        this.faces.vertex(this.p3[p], color, alpha);
      }
      for (let i = 1; i < face.poly.length - 1; i++) this.faces.triangle(first, first + i, first + i + 1);
    }
    this.faces.end();
  }

  // Intersect every cell with the 3D space w = sliceLevel. Each cell leaves a
  // convex polygon; together they form the cross-section.
  updateSlice({ state, topology, selected, thickness }) {
    const level = state.sliceLevel + 1e-5;
    const f = this.projectFactor(level, state);
    const radius = state.edgeRadius * 0.9 * thickness(f);
    const p4 = this.p4;
    const pts = this._slice;
    this.sliceFill.begin();
    this.sliceEdges.begin();
    this.sliceJoints.begin();

    topology.cellEdges.forEach((pairs, c) => {
      let n = 0;
      for (const [a, b] of pairs) {
        const wa = p4[a * 4 + 3] - level;
        const wb = p4[b * 4 + 3] - level;
        if (wa < 0 === wb < 0) continue;
        const k = wa / (wa - wb);
        pts[n++].set(
          (p4[a * 4] + (p4[b * 4] - p4[a * 4]) * k) * f,
          (p4[a * 4 + 1] + (p4[b * 4 + 1] - p4[a * 4 + 1]) * k) * f,
          (p4[a * 4 + 2] + (p4[b * 4 + 2] - p4[a * 4 + 2]) * k) * f,
        );
        if (n === 6) break;
      }
      if (n < 3) return;
      const ring = this.orderPolygon(pts, n);
      const cell = this.polytope.cells[c];
      let alpha = 0.42;
      if (selected) alpha = selected === cell ? 0.75 : 0.1;
      const first = this.sliceFill.nv;
      for (let i = 0; i < n; i++) this.sliceFill.vertex(ring[i].p, cell.color, alpha);
      for (let i = 1; i < n - 1; i++) this.sliceFill.triangle(first, first + i, first + i + 1);
      for (let i = 0; i < n; i++) {
        this.sliceEdges.push(ring[i].p, ring[(i + 1) % n].p, radius, radius, SLICE_EDGE, SLICE_EDGE, 0.55);
        this.sliceJoints.push(ring[i].p, radius, SLICE_EDGE, 0.55);
      }
    });

    this.sliceFill.end();
    this.sliceEdges.end();
    this.sliceJoints.end();
  }

  // Sort polygon corners by angle around their centroid.
  orderPolygon(pts, n) {
    const [center, normal, u, v, d] = this._tmp;
    center.set(0, 0, 0);
    for (let i = 0; i < n; i++) center.add(pts[i]);
    center.divideScalar(n);
    normal.set(0, 0, 0);
    let best = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        u.subVectors(pts[i], center);
        v.subVectors(pts[j], center);
        const cross = u.cross(v);
        const len = cross.lengthSq();
        if (len > best) {
          best = len;
          normal.copy(cross);
        }
      }
    }
    normal.normalize();
    u.subVectors(pts[0], center).normalize();
    v.crossVectors(normal, u);
    const ring = this._order.slice(0, n);
    for (let i = 0; i < n; i++) {
      d.subVectors(pts[i], center);
      ring[i].p.copy(pts[i]);
      ring[i].angle = Math.atan2(d.dot(v), d.dot(u));
    }
    return ring.sort((x, y) => x.angle - y.angle);
  }

  updateTrails(state, trig, t, pointColor) {
    const trails = this.trails;
    const active = state.trails && t === 0;
    trails.mesh.visible = active;
    if (!active) {
      trails.clear();
      return;
    }
    const out4 = this._out;
    for (let i = 0; i < this.home3.length; i++) {
      const f = this.transform(i, -1, 0, trig, state, out4);
      this.home3[i].set(out4[0] * f, out4[1] * f, out4[2] * f);
      pointColor(out4[3], this.homeColors[i]);
    }
    trails.record(this.home3, this.homeColors);
    trails.build(state.trailLength, 0.9);
  }
}
