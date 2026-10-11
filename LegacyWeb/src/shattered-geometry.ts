import * as THREE from "three";

type Curve = readonly (readonly [number, number])[];
// Unequal, non-repeating fault events. CPU geometry and GLSL are generated from
// the same knots; no periodic sine wave determines the fracture silhouette.
const CURVES = {
  Main: [[-1, -.08], [-.86, -.16], [-.72, -.12], [-.63, .025], [-.53, -.045], [-.39, .08], [-.25, .015],
    [-.12, .205], [.015, .155], [.12, .285], [.27, .18], [.37, .32], [.48, .235], [.63, .36], [.75, .27], [.89, .40], [1, .31]],
  MainWidth: [[-1, .013], [-.85, .025], [-.73, .008], [-.675, -.008], [-.62, .021], [-.51, .014], [-.4, .048],
    [-.27, .026], [-.15, .062], [-.035, .033], [.08, .015], [.20, .041], [.32, .017], [.43, .012], [.49, -.012],
    [.55, .018], [.68, .031], [.81, .008], [.91, .018], [1, .010]],
  Warp: [[-1, .034], [-.62, -.019], [-.27, .041], [.10, -.026], [.43, .018], [.72, -.011], [1, .029]],
  A: [[-1, .68], [0, .59], [.12, .51], [.22, .46], [.31, .49], [.42, .27], [.48, .33], [.57, .18], [.68, .22], [.76, .05], [.87, .13], [1.08, .035]],
  AWidth: [[-1, .004], [.1, .008], [.22, .012], [.37, .006], [.45, .017], [.54, -.006], [.60, .005], [.71, .014], [.82, .006], [.96, -.004], [1.1, .005]],
  B: [[-1, -.63], [0, -.54], [.15, -.47], [.24, -.50], [.33, -.31], [.44, -.37], [.54, -.18], [.62, -.23], [.76, -.06], [.87, -.13], [1.1, -.01]],
  BWidth: [[-1, .006], [.15, .009], [.31, .016], [.42, .005], [.51, .012], [.63, -.004], [.71, .008], [.86, .013], [1.1, .004]],
  Side: [[-1, .59], [-.51, .67], [-.38, .79], [-.26, .73], [-.10, .86], [.03, .73], [.18, .79], [.29, .71], [.45, .84], [.61, .75], [.8, .86], [1, .84]],
  SideWidth: [[-1, -.01], [-.43, .004], [-.31, .011], [-.16, -.005], [-.04, .004], [.13, .007], [.28, .002], [.40, -.003], [.53, .008], [.64, .002], [1, -.01]],
} satisfies Record<string, Curve>;
function curve(t: number, knots: Curve) {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (t < knots[i][0]) {
      const a = knots[i - 1], b = knots[i];
      return THREE.MathUtils.lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
    }
  }
  return knots[knots.length - 1][1];
}
function fractureHash(i: number, seed: number) {
  let n = ((i * 37 + seed * 17) % 251 + 251) % 251;
  n = (n * n * 13 + 19) % 251;
  return n / 250;
}
function fractureNoise(t: number, seed: number) {
  const i = Math.floor(t);
  return THREE.MathUtils.lerp(fractureHash(i, seed), fractureHash(i + 1, seed), t - i);
}
const FRACTURE_NOISE_MEAN = Array.from({ length: 251 }, (_, i) => fractureHash(i, 0)).reduce((sum, n) => sum + n, 0) / 251;
function edgeRoughness(q: THREE.Vector3, seed: number) {
  return (fractureNoise(q.y * 29 + q.z * 17 + q.x * 11, seed) - FRACTURE_NOISE_MEAN) * 0.008
    + (fractureNoise(q.y * 73 - q.z * 41 + q.x * 29, seed + 7) - FRACTURE_NOISE_MEAN) * 0.0038
    + (fractureNoise(q.y * 179 + q.z * 83 - q.x * 61, seed + 19) - FRACTURE_NOISE_MEAN) * 0.0016;
}
function roughBand(delta: number, width: number, q: THREE.Vector3, seed: number) {
  if (width <= 0.003) return Math.abs(delta) - width;
  const envelope = THREE.MathUtils.smoothstep(width, 0.003, 0.016);
  const rough = edgeRoughness(q, seed + (delta < 0 ? 31 : 83));
  return Math.abs(delta) - width - envelope * rough;
}
const glslNumber = (n: number) => n.toFixed(7);
function curveGLSL(name: string, knots: Curve) {
  let code = `float shatteredCurve${name}(float t) { if(t <= ${glslNumber(knots[0][0])}) return ${glslNumber(knots[0][1])};`;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i];
    code += `if(t < ${glslNumber(b[0])}) return mix(${glslNumber(a[1])}, ${glslNumber(b[1])}, (t-(${glslNumber(a[0])}))/${glslNumber(b[0] - a[0])});`;
  }
  return `${code} return ${glslNumber(knots[knots.length - 1][1])}; }`;
}

/** Both the true openings and the finer material damage use exactly this map. */
export const SHATTERED_FRACTURE_GLSL = /* glsl */ `
  ${Object.entries(CURVES).map(([name, knots]) => curveGLSL(name, knots)).join("\n")}
  float shatteredHash(float i, float seed) {
    float n=mod(i*37.0+seed*17.0,251.0);
    return mod(n*n*13.0+19.0,251.0)/250.0;
  }
  float shatteredNoise(float t, float seed) {
    float i=floor(t); return mix(shatteredHash(i,seed),shatteredHash(i+1.0,seed),fract(t));
  }
  float shatteredEdgeRoughness(vec3 q, float seed) {
    const float mean=${FRACTURE_NOISE_MEAN.toFixed(10)};
    return (shatteredNoise(q.y*29.0+q.z*17.0+q.x*11.0,seed)-mean)*0.008
      +(shatteredNoise(q.y*73.0-q.z*41.0+q.x*29.0,seed+7.0)-mean)*0.0038
      +(shatteredNoise(q.y*179.0+q.z*83.0-q.x*61.0,seed+19.0)-mean)*0.0016;
  }
  float shatteredRoughBand(float delta, float width, vec3 q, float seed) {
    if(width<=0.003) return abs(delta)-width;
    float envelope=smoothstep(0.003,0.016,width);
    float rough=shatteredEdgeRoughness(q,seed+(delta<0.0?31.0:83.0));
    return abs(delta)-width-envelope*rough;
  }
  vec3 shatteredCoordinates(vec3 p, float small) {
    vec3 q=normalize(p); q.x*=1.0-small*2.0; q.y=mix(q.y,-q.y,small); return q;
  }
  float shatteredMainPath(vec3 q) { return shatteredCurveMain(q.y)+shatteredCurveWarp(q.z); }
  float shatteredFault(vec3 p, float small) {
    vec3 q=shatteredCoordinates(p,small);
    float seed=11.0+small*36.0, warp=shatteredCurveWarp(q.z);
    float path=shatteredMainPath(q)+0.004*(shatteredNoise(q.y*47.0+q.z*13.0,seed)-0.5);
    float width=shatteredCurveMainWidth(q.y+warp*0.3)*(0.86+0.28*shatteredNoise(q.y*17.0+q.z*11.0,seed+5.0));
    float d=shatteredRoughBand(q.x-path,width,q,seed);
    if(q.x>path+0.008 && q.z>-0.48) {
      float a=q.y-(shatteredCurveA(q.x)+warp*0.4+0.004*(shatteredNoise(q.x*47.0+q.z*19.0,seed+3.0)-0.5));
      float b=q.y-(shatteredCurveB(q.x)-warp*0.7+0.004*(shatteredNoise(q.x*43.0-q.z*17.0,seed+9.0)-0.5));
      d=min(d,shatteredRoughBand(a,shatteredCurveAWidth(q.x),q,seed+23.0));
      d=min(d,shatteredRoughBand(b,shatteredCurveBWidth(q.x),q,seed+47.0));
      if(q.x>0.53 && q.z>-0.20 && q.y>-0.43 && q.y<0.64) {
        float side=q.x-(shatteredCurveSide(q.y)+warp*0.5);
        d=min(d,shatteredRoughBand(side,shatteredCurveSideWidth(q.y),q,seed+61.0));
      }
    }
    // Short dead-end splinters terminate inside the crust, independently of
    // the three major tears. Negative widths above retain real rock bridges.
    float forkA=abs(q.y-(-0.18+0.72*(q.x+0.08)+warp*0.3))-0.005;
    forkA=max(forkA,max(q.x-path+0.018,path-0.26-q.x));
    forkA=max(forkA,max(-0.39-q.y,q.y+0.06));
    float forkB=abs(q.y-(0.67-1.2*(q.x-0.33)-warp*0.4))-0.004;
    forkB=max(forkB,max(0.35-q.x,q.x-0.60));
    forkB=max(forkB,max(0.42-q.y,q.y-0.76));
    if(q.z>0.18) d=min(d,min(forkA,forkB));
    return d;
  }
  float shatteredDamage(vec3 p, float small) {
    vec3 q=shatteredCoordinates(p,small);
    float side=smoothstep(-0.11,0.38,q.x-shatteredMainPath(q));
    float seam=1.0-smoothstep(0.0,0.13,shatteredFault(p,small));
    return max(side*(0.72+0.28*smoothstep(-0.5,0.6,q.z)),seam*0.92);
  }
`;

type Sample = { q: THREE.Vector3; path: number; width: number; a: number; b: number; side: number; fault: number };
function sampleFracture(p: THREE.Vector3, small: boolean): Sample {
  const q = p.clone().normalize();
  if (small) { q.x *= -1; q.y *= -1; }
  const seed = small ? 47 : 11, warp = curve(q.z, CURVES.Warp);
  const path = curve(q.y, CURVES.Main) + warp + 0.004 * (fractureNoise(q.y * 47 + q.z * 13, seed) - 0.5);
  const width = curve(q.y + warp * 0.3, CURVES.MainWidth) * (0.86 + 0.28 * fractureNoise(q.y * 17 + q.z * 11, seed + 5));
  const a = q.y - (curve(q.x, CURVES.A) + warp * 0.4 + 0.004 * (fractureNoise(q.x * 47 + q.z * 19, seed + 3) - 0.5));
  const b = q.y - (curve(q.x, CURVES.B) - warp * 0.7 + 0.004 * (fractureNoise(q.x * 43 - q.z * 17, seed + 9) - 0.5));
  const side = q.x - (curve(q.y, CURVES.Side) + warp * 0.5);
  let fault = roughBand(q.x - path, width, q, seed);
  if (q.x > path + 0.008 && q.z > -0.48) {
    fault = Math.min(fault, roughBand(a, curve(q.x, CURVES.AWidth), q, seed + 23),
      roughBand(b, curve(q.x, CURVES.BWidth), q, seed + 47));
    if (q.x > 0.53 && q.z > -0.20 && q.y > -0.43 && q.y < 0.64) {
      fault = Math.min(fault, roughBand(side, curve(q.y, CURVES.SideWidth), q, seed + 61));
    }
  }
  let forkA = Math.abs(q.y - (-0.18 + 0.72 * (q.x + 0.08) + warp * 0.3)) - 0.005;
  forkA = Math.max(forkA, q.x - path + 0.018, path - 0.26 - q.x, -0.39 - q.y, q.y + 0.06);
  let forkB = Math.abs(q.y - (0.67 - 1.2 * (q.x - 0.33) - warp * 0.4)) - 0.004;
  forkB = Math.max(forkB, 0.35 - q.x, q.x - 0.60, 0.42 - q.y, q.y - 0.76);
  if (q.z > 0.18) fault = Math.min(fault, forkA, forkB);
  return { q, path, width, a, b, side, fault };
}

type Data = { positions: number[]; sources: number[]; normals: number[]; shells: number[]; uvs: number[] };
type Vertex = { position: THREE.Vector3; source: THREE.Vector3; normal?: THREE.Vector3 };
function data(): Data { return { positions: [], sources: [], normals: [], shells: [], uvs: [] }; }
function face(target: Data, a: Vertex, b: Vertex, c: Vertex, shell: number) {
  const normal = b.position.clone().sub(a.position).cross(c.position.clone().sub(a.position)).normalize();
  const uvs = [a, b, c].map(v => {
    const p = v.source.clone().normalize();
    return [0.5 + Math.atan2(p.z, p.x) / (Math.PI * 2), 0.5 + Math.asin(p.y) / Math.PI];
  });
  const seam = Math.max(...uvs.map(uv => uv[0])) - Math.min(...uvs.map(uv => uv[0])) > 0.5;
  [a, b, c].forEach((v, i) => {
    target.positions.push(v.position.x, v.position.y, v.position.z);
    target.sources.push(v.source.x, v.source.y, v.source.z);
    const n = v.normal ?? normal;
    target.normals.push(n.x, n.y, n.z);
    target.shells.push(shell);
    target.uvs.push(uvs[i][0] + (seam && uvs[i][0] < 0.5 ? 1 : 0), uvs[i][1]);
  });
}
function finish(target: Data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute("aSourcePosition", new THREE.Float32BufferAttribute(target.sources, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(target.normals, 3));
  geometry.setAttribute("aShell", new THREE.Float32BufferAttribute(target.shells, 1));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(target.uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

const key = (p: THREE.Vector3) => `${Math.round(p.x * 1000000)},${Math.round(p.y * 1000000)},${Math.round(p.z * 1000000)}`;
function radius(p: THREE.Vector3, small: boolean) {
  const seed = small ? 8.3 : 3.1;
  return 0.976 + 0.0013 * Math.sin(p.x * 32 + p.y * 14 + seed) * Math.sin(p.z * 27 - p.y * 19)
    + 0.0008 * Math.sin(p.y * 63 - p.z * 31 + seed) * Math.sin(p.x * 47 + p.z * 53);
}
function vertex(p: THREE.Vector3, offset: THREE.Vector3, small: boolean, inner = false): Vertex {
  const radial = p.clone().normalize();
  const r = inner ? 0.925 + 0.0015 * Math.sin(radial.x * 37 + radial.y * 23) * Math.sin(radial.z * 29) : radius(radial, small);
  const source = radial.clone().multiplyScalar(r);
  return { position: source.clone().add(connectedOffset(radial, offset, small)), source, normal: radial };
}

type Edge = { a: THREE.Vector3; b: THREE.Vector3; count: number; offset: THREE.Vector3 };
function walls(target: Data, edges: Map<string, Edge>, small: boolean, fragmentThickness?: number) {
  let count = 0;
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    let a = vertex(edge.a, edge.offset, small), b = vertex(edge.b, edge.offset, small);
    for (let level = 1; level <= 3; level++) {
      const t = level === 1 ? 0.22 : level === 2 ? 0.61 : 1;
      const inner = (p: THREE.Vector3): Vertex => {
        const outerR = radius(p, small);
        const innerRadius = fragmentThickness === undefined ? 0.924 : outerR - fragmentThickness;
        const seed = (small ? 47 : 11) + level * 7;
        const envelope = Math.sin(t * Math.PI);
        const rough = (fractureNoise(p.x * 39 + p.y * 57 + p.z * 23, seed) - 0.5) * 0.006 * envelope;
        const r = THREE.MathUtils.lerp(outerR, innerRadius, t) + rough;
        const source = p.clone().multiplyScalar(r);
        // Irregular, connected layer ledges replace a single straight knife
        // wall. A shared position function keeps neighbouring edges watertight.
        const slump = new THREE.Vector3(fractureNoise(p.x * 31 + p.y * 17 - p.z * 29, seed) - 0.5,
          fractureNoise(p.y * 37 - p.z * 19 + p.x * 23, seed + 3) - 0.5,
          fractureNoise(p.z * 41 + p.x * 13 - p.y * 31, seed + 9) - 0.5);
        slump.addScaledVector(p, -slump.dot(p));
        source.addScaledVector(slump, (fragmentThickness === undefined ? 0.011 : 0.004) * envelope);
        return { source, position: source.clone().add(connectedOffset(p, edge.offset, small)) };
      };
      const nextA = inner(edge.a), nextB = inner(edge.b);
      face(target, a, nextA, b, 0.2);
      face(target, b, nextA, nextB, 0.2);
      a = nextA; b = nextB; count += 2;
    }
  }
  return count;
}

function plateOffset(sample: Sample, small: boolean) {
  let id = 0;
  if (sample.q.x > sample.path) id = (sample.a > 0 ? 1 : sample.b > 0 ? 2 : 3) + (sample.side > 0 ? 3 : 0);
  const offsets = [new THREE.Vector3(-0.003, 0, 0), new THREE.Vector3(0.010, 0.006, 0.009),
    new THREE.Vector3(0.014, -0.001, 0.012), new THREE.Vector3(0.008, -0.009, 0.007),
    new THREE.Vector3(0.014, 0.007, 0.002), new THREE.Vector3(0.017, -0.002, 0.004),
    new THREE.Vector3(0.012, -0.008, 0.001)];
  const offset = offsets[id];
  if (small) { offset.x *= -1; offset.y *= -1; }
  return { id, offset };
}

function connectedOffset(p: THREE.Vector3, base: THREE.Vector3, small: boolean) {
  // Bridge displacement is sampled at each shared vertex, never at a face's
  // centroid, so neighbouring shell triangles remain exactly joined.
  if (base.lengthSq() < 1e-14) return base;
  const sample = sampleFracture(p, small), offset = base.clone();
  if (small) { offset.x *= -1; offset.y *= -1; }
  if (offset.x !== -0.003) {
    const rightBridgeOffset = new THREE.Vector3(0.011, 0.001, 0.008);
    for (const [distance, width] of [[Math.abs(sample.a), curve(sample.q.x, CURVES.AWidth)],
      [Math.abs(sample.b), curve(sample.q.x, CURVES.BWidth)], [Math.abs(sample.side), curve(sample.q.y, CURVES.SideWidth)]]) {
      const influence = THREE.MathUtils.clamp((0.007 - width) / 0.012, 0, 1)
        * THREE.MathUtils.clamp((0.09 - distance) / 0.055, 0, 1);
      offset.lerp(rightBridgeOffset, influence);
    }
    const bridge = THREE.MathUtils.clamp((0.008 - sample.width) / 0.014, 0, 1)
      * THREE.MathUtils.clamp((0.14 - Math.abs(sample.q.x - sample.path)) / 0.10, 0, 1);
    offset.lerp(new THREE.Vector3(-0.003, 0, 0), bridge);
  }
  if (small) { offset.x *= -1; offset.y *= -1; }
  return offset;
}

type Chip = { center: THREE.Vector3; extent: number; thickness: number; drift: THREE.Vector3; rotation: THREE.Quaternion };
function chips(small: boolean): Chip[] {
  const random = (n: number) => { const v = Math.sin(n * 78.233 + (small ? 97.4 : 13.1)) * 43758.5453; return v - Math.floor(v); };
  return Array.from({ length: small ? 11 : 14 }, (_, i) => {
    const theta = 1.00 + random(i * 8 + 1) * 0.42;
    const phi = -1.03 + random(i * 8 + 2) * 1.90;
    const center = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta));
    if (small) { center.x *= -1; center.y *= -1; }
    const extent = i < 3 ? 0.045 + random(i * 8 + 3) * 0.024 : 0.012 + random(i * 8 + 3) * 0.022;
    const drift = center.clone().multiplyScalar(0.055 + random(i * 8 + 4) * 0.11);
    // The source locations stay on the real crust, while tangential drift
    // gathers fragments into unequal groups instead of an evenly spaced ring.
    const targetY = (i % 3 === 0 ? 0.61 : i % 3 === 1 ? -0.53 : 0.06) * (small ? -1 : 1);
    drift.y += (targetY - center.y * 0.976) * (i < 3 ? 0.38 : 0.61);
    drift.x += (small ? -1 : 1) * random(i * 8 + 5) * (i < 3 ? 0.085 : 0.045);
    const tiltAxis = center.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    const tilt = i < 3 ? 0.40 + random(i * 8 + 6) * 0.25 : 0.17 + random(i * 8 + 6) * 0.44;
    const rotation = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tilt);
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(center, (random(i * 8 + 7) - 0.5) * 2.6));
    return { center, extent, thickness: 0.006 + extent * 0.35, drift, rotation };
  });
}
function inChip(p: THREE.Vector3, chip: Chip) {
  if (p.dot(chip.center) < Math.cos(chip.extent * 1.55)) return false;
  const tangent = new THREE.Vector3(-chip.center.y, chip.center.x, 0).normalize();
  const bitangent = chip.center.clone().cross(tangent);
  const u = p.dot(tangent), v = p.dot(bitangent), angle = Math.atan2(v, u);
  const phase = chip.center.x * 31 + chip.center.y * 17;
  const contour = 1 + 0.20 * Math.sin(angle * 3 + phase) + 0.11 * Math.sin(angle * 5 - phase * 0.7)
    + 0.065 * Math.sin(angle * 9 + phase * 1.3);
  return Math.hypot(u / 1.12, v / 0.91) < chip.extent * contour;
}

/** Original spherical crust shards; all surfaces retain their original material coordinates. */
export function createShatteredGeometries(small: boolean) {
  const sourceGeometry = new THREE.IcosahedronGeometry(1, 70);
  const positions = sourceGeometry.getAttribute("position");
  const crustData = data(), mantleData = data(), debrisData = data();
  const edges = new Map<string, Edge>();
  const pieces = chips(small);
  const debrisEdges = pieces.map(() => new Map<string, Edge>());
  const centers = pieces.map(piece => piece.center.clone().multiplyScalar(radius(piece.center, small)));
  const register = (map: Map<string, Edge>, a: THREE.Vector3, b: THREE.Vector3, offset: THREE.Vector3, region = 0) => {
    const ka = key(a), kb = key(b), id = `${region}/${ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`}`;
    const previous = map.get(id);
    if (previous) previous.count++;
    else map.set(id, { a, b, count: 1, offset });
  };
  const driftVertex = (v: Vertex, index: number) => {
    const piece = pieces[index], center = centers[index];
    v.position.sub(center).applyQuaternion(piece.rotation).add(center).add(piece.drift);
    v.normal?.applyQuaternion(piece.rotation);
    return v;
  };
  const fragmentVertex = (p: THREE.Vector3, index: number, inner = false) => {
    const v = vertex(p, new THREE.Vector3(), small);
    if (inner) {
      const radial = p.clone().normalize();
      v.source = radial.multiplyScalar(radius(radial, small) - pieces[index].thickness);
      v.position.copy(v.source);
      v.normal?.negate();
    }
    return driftVertex(v, index);
  };
  const faultCache = new Map<string, number>();
  const fault = (p: THREE.Vector3) => {
    const id = key(p), previous = faultCache.get(id);
    if (previous !== undefined) return previous;
    const value = sampleFracture(p, small).fault;
    faultCache.set(id, value);
    return value;
  };
  const intersections = new Map<string, THREE.Vector3>();
  const intersection = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = key(a), kb = key(b), id = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
    const previous = intersections.get(id);
    if (previous) return previous;
    // The same canonical edge and root are shared by adjacent triangles, so
    // clipped shells and their walls meet without cracks or doubled slivers.
    const start = ka < kb ? a : b, end = ka < kb ? b : a;
    let low = 0, high = 1, lowFault = fault(start), highFault = fault(end);
    for (let step = 0; step < 6; step++) {
      const middle = (low + high) * 0.5;
      const value = fault(start.clone().lerp(end, middle).normalize());
      if ((value >= 0) === (lowFault >= 0)) { low = middle; lowFault = value; }
      else { high = middle; highFault = value; }
    }
    const weight = THREE.MathUtils.clamp(lowFault / (lowFault - highFault), 0, 1);
    const point = start.clone().lerp(end, THREE.MathUtils.lerp(low, high, weight)).normalize();
    intersections.set(id, point);
    return point;
  };
  const clipShell = (polygon: THREE.Vector3[]) => {
    const result: THREE.Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = fault(a) >= 0, insideB = fault(b) >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) result.push(intersection(a, b));
    }
    return result.filter((p, i) => p.distanceToSquared(result[(i + result.length - 1) % result.length]) > 1e-14);
  };
  const hiddenGaps = new Map<string, THREE.Vector3 | null>();
  const hiddenGap = (a: THREE.Vector3, b: THREE.Vector3) => {
    const fa = fault(a), fb = fault(b);
    if (fa <= 0 || fb <= 0 || Math.min(fa, fb) > a.distanceTo(b) * 1.8) return null;
    const ka = key(a), kb = key(b), id = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
    if (hiddenGaps.has(id)) return hiddenGaps.get(id)!;
    const start = ka < kb ? a : b, end = ka < kb ? b : a;
    let point: THREE.Vector3 | null = null, lowest = 0;
    for (const weight of [0.125, 0.25, 0.5, 0.75, 0.875]) {
      const candidate = start.clone().lerp(end, weight).normalize(), value = fault(candidate);
      if (value < lowest) { lowest = value; point = candidate; }
    }
    hiddenGaps.set(id, point);
    return point;
  };
  let surviving = 0, removed = 0, fragmentFaces = 0;
  const appendShell = (polygon: THREE.Vector3[]) => {
    if (polygon.length < 3) return;
    const center = polygon.reduce((sum, p) => sum.add(p), new THREE.Vector3()).normalize();
    const { id, offset } = plateOffset(sampleFracture(center, small), small);
    for (let i = 1; i < polygon.length - 1; i++) {
      face(crustData, vertex(polygon[0], offset, small), vertex(polygon[i], offset, small), vertex(polygon[i + 1], offset, small), 1);
      surviving++;
    }
    for (let i = 0; i < polygon.length; i++) register(edges, polygon[i], polygon[(i + 1) % polygon.length], offset, id);
  };
  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i).normalize();
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1).normalize();
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2).normalize();
    const p = a.clone().add(b).add(c).normalize();
    const chip = pieces.findIndex(piece => inChip(p, piece));
    if (chip >= 0) {
      const zero = new THREE.Vector3();
      face(debrisData, fragmentVertex(a, chip), fragmentVertex(b, chip), fragmentVertex(c, chip), 1);
      face(debrisData, fragmentVertex(a, chip, true), fragmentVertex(c, chip, true), fragmentVertex(b, chip, true), 0.2);
      register(debrisEdges[chip], a, b, zero); register(debrisEdges[chip], b, c, zero); register(debrisEdges[chip], c, a, zero);
      removed++; fragmentFaces += 2;
      continue;
    }
    const original = [a, b, c], boundary: THREE.Vector3[] = [];
    for (let edge = 0; edge < 3; edge++) {
      boundary.push(original[edge]);
      const gap = hiddenGap(original[edge], original[(edge + 1) % 3]);
      if (gap) boundary.push(gap);
    }
    const before = surviving;
    const local = sampleFracture(p, small);
    const roughEdge = p.z > 0.30 && local.width > 0.018 && Math.abs(local.q.x - local.path) < local.width + 0.026
      && original.some(v => fault(v) > 0) && original.some(v => fault(v) < 0);
    // Only a thin crack that crosses a triangle's interior needs a local fan.
    // All other faces keep their original resolution and are linearly clipped
    // at the exact fracture function rather than removed as whole grid teeth.
    if (boundary.length > 3 || roughEdge || original.every(v => fault(v) > 0) && fault(p) < 0) {
      for (let edge = 0; edge < boundary.length; edge++) appendShell(clipShell([p, boundary[edge], boundary[(edge + 1) % boundary.length]]));
    } else appendShell(clipShell(original));
    if (surviving === before) removed++;
  }
  const wallFaces = walls(crustData, edges, small);
  debrisEdges.forEach((map, index) => {
    const raw = data();
    fragmentFaces += walls(raw, map, small, pieces[index].thickness);
    for (let i = 0; i < raw.shells.length; i += 3) {
      const vertices = [0, 1, 2].map(j => {
        const o = (i + j) * 3;
        return driftVertex({ position: new THREE.Vector3(...raw.positions.slice(o, o + 3) as [number, number, number]),
          source: new THREE.Vector3(...raw.sources.slice(o, o + 3) as [number, number, number]),
          normal: new THREE.Vector3(...raw.normals.slice(o, o + 3) as [number, number, number]) }, index);
      });
      face(debrisData, vertices[0], vertices[1], vertices[2], 0.2);
    }
  });
  sourceGeometry.dispose();
  const mantleSource = new THREE.IcosahedronGeometry(1, 49);
  const source = mantleSource.getAttribute("position"), zero = new THREE.Vector3();
  for (let i = 0; i < source.count; i += 3) {
    const points = [0, 1, 2].map(j => vertex(new THREE.Vector3().fromBufferAttribute(source, i + j), zero, small, true));
    face(mantleData, points[0], points[1], points[2], 0);
  }
  mantleSource.dispose();
  const crust = finish(crustData), mantle = finish(mantleData), debris = finish(debrisData);
  crust.userData = { survivingFaces: surviving, removedFaces: removed, wallFaces,
    plateCount: 7, circularRadius: 0.976, innerRadius: 0.925 };
  debris.userData = { curvedShellFragments: pieces.length, fragmentFaces };
  return { crust, mantle, debris };
}
