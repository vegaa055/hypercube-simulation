export const PLANE_IDS = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'];

export function defaultState() {
  return {
    shape: 'tesseract',

    // Rotation, per plane. Angles in radians, speeds in degrees per second.
    angles: { xy: 0, xz: 0, xw: 0, yz: 0, yw: 0, zw: 0 },
    auto: { xy: false, xz: false, xw: true, yz: true, yw: false, zw: false },
    speed: { xy: 20, xz: 20, xw: 36, yz: 18, yw: 24, zw: 30 },
    playing: true,
    speedScale: 1,
    trails: false,
    trailLength: 150,

    // 0 is the folded tesseract, 1 is the flat net of eight cubes.
    unfold: 0,

    // Cross-section by the 3D space w = sliceLevel.
    slice: false,
    sliceLevel: 0,
    sliceSweep: true,
    ghost: true,

    // 4D to 3D projection.
    projection: 'perspective',
    wDistance: 3,
    wOffset: 0,
    depthScale: true,

    // Appearance.
    showEdges: true,
    edgeRadius: 0.035,
    showVertices: true,
    vertexRadius: 0.075,
    showFaces: true,
    faceOpacity: 0.07,
    colorMode: 'depth',
    solidColor: '#9fb0ff',
    glow: 0.3,
    bloom: true,
    bloomStrength: 0.45,
    grid: true,

    // Cell highlight, e.g. 'w+' for the cube at w = +1.
    highlight: 'none',
    highlightPreview: null,

    // 3D transform gizmo.
    gizmo: false,
    gizmoMode: 'translate',
  };
}

export const PRESETS = [
  { label: '<i>xw</i>', auto: { xw: true }, speed: { xw: 40 } },
  { label: '<i>xw</i> + <i>yz</i>', auto: { xw: true, yz: true }, speed: { xw: 36, yz: 18 } },
  { label: 'Isoclinic', auto: { xy: true, zw: true }, speed: { xy: 30, zw: 30 } },
  {
    label: 'All six',
    auto: { xy: true, xz: true, xw: true, yz: true, yw: true, zw: true },
    speed: { xy: 11, xz: 17, xw: 29, yz: 13, yw: 23, zw: 19 },
  },
];
