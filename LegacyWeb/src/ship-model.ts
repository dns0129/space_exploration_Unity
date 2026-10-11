import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const SHIP_LENGTH_KM = 10;

type HullSection = { z: number; width: number; top: number; bottom: number };
const HULL_SECTIONS: HullSection[] = [
  { z: -0.77, width: 0.009, top: 0.009, bottom: 0.009 },
  { z: -0.65, width: 0.075, top: 0.055, bottom: 0.05 },
  { z: -0.45, width: 0.125, top: 0.12, bottom: 0.092 },
  { z: -0.22, width: 0.17, top: 0.158, bottom: 0.13 },
  { z: 0.05, width: 0.19, top: 0.155, bottom: 0.145 },
  { z: 0.28, width: 0.173, top: 0.13, bottom: 0.135 },
  { z: 0.47, width: 0.133, top: 0.095, bottom: 0.105 },
];

/** A panel follows the fuselage curvature, with real gaps between armor plates. */
function hullPanel(start: HullSection, end: HullSection, angleStart: number, angleEnd: number, inset = 0) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 4, columns = 8;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const z = THREE.MathUtils.lerp(start.z, end.z, t);
    const width = THREE.MathUtils.lerp(start.width, end.width, t) + inset;
    for (let column = 0; column <= columns; column++) {
      const theta = THREE.MathUtils.lerp(angleStart, angleEnd, column / columns);
      const vertical = Math.cos(theta);
      const height = THREE.MathUtils.lerp(vertical >= 0 ? start.top : start.bottom, vertical >= 0 ? end.top : end.bottom, t) + inset;
      positions.push(Math.sin(theta) * width, vertical * height, z);
      uvs.push(column / columns, t);
      if (row < rows && column < columns) {
        const current = row * (columns + 1) + column;
        indices.push(current, current + columns + 1, current + 1,
          current + 1, current + columns + 1, current + columns + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Original survey ship: layered armor, glazed flight deck and exposed twin ion drives. */
export function createShip() {
  const group = new THREE.Group();
  group.name = "Voyager survey ship";
  const hull = new THREE.MeshStandardMaterial({ color: "#cbd5d9", metalness: 0.6, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: "#182632", metalness: 0.78, roughness: 0.36 });
  const trim = new THREE.MeshStandardMaterial({ color: "#c27c39", metalness: 0.4, roughness: 0.4 });
  const titanium = new THREE.MeshStandardMaterial({ color: "#647c8c", metalness: 0.92, roughness: 0.22 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#123e57", emissive: "#0d3a4a", emissiveIntensity: 0.28,
    metalness: 0.45, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
  const lights = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 1.8), toneMapped: false });
  const warmLights = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 0.12), toneMapped: false });
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, position = new THREE.Vector3(), rotation = new THREE.Euler(), scale = new THREE.Vector3(1, 1, 1)) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.applyMatrix4(new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale));
    if (flat !== geometry) geometry.dispose();
    const batch = batches.get(material) ?? [];
    batch.push(flat);
    batches.set(material, batch);
  };
  const box = (size: number[], position: number[], material: THREE.Material, roll = 0) =>
    part(new THREE.BoxGeometry(...size as [number, number, number]), material,
      new THREE.Vector3(...position as [number, number, number]), new THREE.Euler(0, 0, roll));
  const ring = (radius: number, thickness: number, position: number[], material: THREE.Material) =>
    part(new THREE.TorusGeometry(radius, thickness, 8, 48), material, new THREE.Vector3(...position as [number, number, number]));
  const tube = (points: number[][], radius: number, material: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point as [number, number, number])));
    part(new THREE.TubeGeometry(curve, 24, radius, 8, false), material);
  };
  const plate = (points: number[][], height: number, material: THREE.Material, bevel = 0.003) => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], index) => index ? shape.lineTo(x, z) : shape.moveTo(x, z));
    shape.closePath();
    part(new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: bevel > 0,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 }), material,
    new THREE.Vector3(0, height, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  };

  // The dark pressure hull remains visible in the physically recessed armor seams.
  for (let section = 0; section < HULL_SECTIONS.length - 1; section++) {
    const start = HULL_SECTIONS[section], end = HULL_SECTIONS[section + 1];
    part(hullPanel(start, end, 0, Math.PI * 2), dark);
    for (let sector = 0; sector < 8; sector++) {
      const gap = 0.019;
      const first = { ...start, z: start.z + 0.003 };
      const last = { ...end, z: end.z - 0.003 };
      part(hullPanel(first, last, sector * Math.PI / 4 + gap, (sector + 1) * Math.PI / 4 - gap, 0.003),
        sector === 3 || sector === 4 ? titanium : hull);
    }
  }
  box([0.095, 0.027, 0.67], [0, -0.146, -0.005], dark);
  box([0.036, 0.012, 0.48], [0, -0.165, 0.045], trim);
  part(new THREE.CircleGeometry(0.134, 48), dark, new THREE.Vector3(0, 0, 0.474), new THREE.Euler(), new THREE.Vector3(1, 0.76, 1));
  box([0.106, 0.07, 0.02], [0, -0.015, 0.485], titanium);
  for (let vent = 0; vent < 7; vent++) box([0.092, 0.004, 0.009], [0, -0.043 + vent * 0.011, 0.499], dark);

  // High subdivision glazing and curved structural ribs create a distinct cockpit silhouette.
  part(new THREE.SphereGeometry(1, 48, 24), glass, new THREE.Vector3(0, 0.172, -0.29),
    new THREE.Euler(), new THREE.Vector3(0.112, 0.083, 0.238));
  tube([[0, 0.184, -0.53], [0, 0.237, -0.44], [0, 0.256, -0.29], [0, 0.235, -0.14], [0, 0.183, -0.052]], 0.006, titanium);
  for (const side of [-1, 1]) {
    tube([[side * 0.03, 0.183, -0.52], [side * 0.098, 0.187, -0.43], [side * 0.116, 0.184, -0.28],
      [side * 0.097, 0.177, -0.13], [side * 0.035, 0.172, -0.06]], 0.008, titanium);
    tube([[side * 0.036, 0.182, -0.515], [side * 0.096, 0.199, -0.42], [side * 0.115, 0.194, -0.29]], 0.0024, lights);
    tube([[side * 0.103, 0.189, -0.19], [side * 0.082, 0.236, -0.19], [0, 0.247, -0.19]], 0.005, trim);
    box([0.011, 0.016, 0.18], [side * 0.16, 0.08, -0.07], trim, side * -0.35);
    box([0.024, 0.019, 0.046], [side * 0.062, 0.041, -0.595], titanium);
    box([0.018, 0.013, 0.004], [side * 0.062, 0.043, -0.621], lights);
  }

  for (const side of [-1, 1]) {
    const mirror = (points: number[][]) => points.map(([x, z]) => [side * x, z]);
    // Separate beveled plates keep the leading edges crisp and seams readable up close.
    plate(mirror([[0.13, -0.27], [1.0, 0.16], [0.89, 0.39], [0.16, 0.25]]), -0.005, titanium, 0.006);
    plate(mirror([[0.18, -0.225], [0.596, -0.02], [0.562, 0.21], [0.19, 0.195]]), 0.006, hull);
    plate(mirror([[0.626, -0.004], [0.967, 0.168], [0.854, 0.346], [0.586, 0.224]]), 0.006, hull);
    plate(mirror([[0.207, 0.224], [0.571, 0.236], [0.837, 0.355], [0.3, 0.26]]), 0.005, dark, 0.001);
    plate(mirror([[0.641, 0.13], [0.905, 0.205], [0.872, 0.295], [0.62, 0.214]]), 0.011, trim, 0.001);
    box([0.042, 0.029, 0.218], [side * 0.966, 0.008, 0.152], dark);
    box([0.015, 0.009, 0.118], [side * 0.967, 0.028, 0.151], lights);
    box([0.30, 0.048, 0.10], [side * 0.30, -0.008, 0.105], dark);
    for (let vent = 0; vent < 8; vent++) {
      box([0.106, 0.005, 0.009], [side * 0.31, 0.026, 0.021 + vent * 0.024], titanium);
      box([0.052, 0.004, 0.01], [side * 0.72, 0.014, 0.07 + vent * 0.015], dark);
    }
    // Flush fasteners and service hatches are geometry rather than painted dots.
    for (const [x, z] of [[0.23, -0.15], [0.35, -0.09], [0.6, 0.075], [0.81, 0.155], [0.82, 0.29]]) {
      part(new THREE.CylinderGeometry(0.005, 0.005, 0.003, 10), titanium, new THREE.Vector3(side * x, 0.013, z));
    }
    box([0.055, 0.007, 0.047], [side * 0.27, 0.015, -0.11], dark);
    box([0.041, 0.008, 0.032], [side * 0.27, 0.018, -0.11], titanium);

    const engineX = side * 0.49;
    const engineY = 0.025;
    part(new THREE.CylinderGeometry(0.083, 0.112, 0.65, 48, 6, true), hull,
      new THREE.Vector3(engineX, engineY, 0.165), new THREE.Euler(-Math.PI / 2, 0, 0));
    // Front intake: recessed center, concentric casing and twelve turbine vanes.
    ring(0.079, 0.006, [engineX, engineY, -0.164], titanium);
    part(new THREE.CircleGeometry(0.071, 48), dark, new THREE.Vector3(engineX, engineY, -0.162), new THREE.Euler(0, Math.PI, 0));
    for (let blade = 0; blade < 12; blade++) {
      const angle = blade * Math.PI / 6;
      box([0.012, 0.034, 0.008], [engineX + Math.sin(angle) * 0.041, engineY + Math.cos(angle) * 0.041, -0.171], titanium, -angle + 0.4);
    }
    part(new THREE.SphereGeometry(0.021, 20, 12), dark, new THREE.Vector3(engineX, engineY, -0.176), new THREE.Euler(), new THREE.Vector3(1, 1, 0.7));
    for (const z of [-0.08, 0.15, 0.365]) ring(0.091 + (z + 0.08) * 0.034, 0.005, [engineX, engineY, z], titanium);
    for (let rail = 0; rail < 8; rail++) {
      const angle = rail * Math.PI / 4;
      box([0.013, 0.018, 0.21], [engineX + Math.sin(angle) * 0.094, engineY + Math.cos(angle) * 0.094, 0.225], dark, -angle);
    }
    // Open nozzle, heat shields, internal copper coils and a luminous ion throat.
    part(new THREE.CylinderGeometry(0.105, 0.103, 0.12, 48, 1, true), dark,
      new THREE.Vector3(engineX, engineY, 0.505), new THREE.Euler(Math.PI / 2, 0, 0));
    ring(0.104, 0.009, [engineX, engineY, 0.568], titanium);
    ring(0.081, 0.008, [engineX, engineY, 0.536], trim);
    ring(0.055, 0.006, [engineX, engineY, 0.54], lights);
    part(new THREE.CircleGeometry(0.051, 48), lights, new THREE.Vector3(engineX, engineY, 0.532));
    for (let fin = 0; fin < 12; fin++) {
      const angle = fin * Math.PI / 6;
      box([0.01, 0.028, 0.09], [engineX + Math.sin(angle) * 0.107, engineY + Math.cos(angle) * 0.107, 0.505], titanium, -angle);
    }
    const fin = new THREE.Shape();
    fin.moveTo(-0.105, 0); fin.lineTo(0.035, 0.19); fin.lineTo(0.15, 0.075); fin.lineTo(0.15, 0); fin.closePath();
    part(new THREE.ExtrudeGeometry(fin, { depth: 0.018, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 }), hull,
      new THREE.Vector3(engineX + 0.009, 0.11, 0.235), new THREE.Euler(0, -Math.PI / 2, 0));
    box([0.008, 0.016, 0.066], [engineX, 0.267, 0.269], trim);
    box([0.036, 0.043, 0.08], [side * 0.133, 0.12, 0.282], titanium, side * 0.22);
    box([0.013, 0.008, 0.04], [side * 0.145, 0.151, 0.279], lights);
    part(new THREE.SphereGeometry(0.008, 16, 10), side < 0 ? warmLights : lights, new THREE.Vector3(side * 0.984, 0.025, 0.181));
  }
  // Hundreds of static parts still become just seven material batches.
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries)!;
    geometries.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = "Merged ship armor and hardware";
    group.add(mesh);
  }
  const hullBounds = new THREE.Box3().setFromObject(group);
  const hullLength = hullBounds.max.z - hullBounds.min.z;

  const exhaust = new THREE.Group();
  exhaust.name = "Layered ion exhaust";
  exhaust.position.z = 0.565;
  // View-dependent soft edges avoid the opaque triangular appearance of a solid cone.
  const makePlume = (radius: number, length: number, core: boolean) => {
    const geometries: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const flame = new THREE.ConeGeometry(radius, length, 32, 12, true).toNonIndexed();
      flame.rotateX(Math.PI / 2).translate(side * 0.49, 0.025, length / 2);
      geometries.push(flame);
    }
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach(part => part.dispose());
    const material = new THREE.ShaderMaterial({
      uniforms: { core: { value: Number(core) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = -view.xyz;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: `
        uniform float core;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 0.7);
          float envelope = pow(1.0 - vUv.y, 1.5) * smoothstep(0.0, 0.025, vUv.y);
          float diamonds = 0.75 + 0.25 * pow(0.5 + 0.5 * cos(vUv.y * 48.0), 6.0);
          vec3 blue = mix(vec3(0.05, 0.38, 1.1), vec3(0.38, 1.25, 1.9), core);
          vec3 color = mix(blue, vec3(0.65, 1.3, 1.9), pow(1.0 - vUv.y, 5.0));
          gl_FragColor = vec4(color, envelope * facing * diamonds * mix(0.42, 0.86, core));
        }
      `,
    });
    exhaust.add(new THREE.Mesh(geometry, material));
  };
  makePlume(0.09, 0.83, false);
  makePlume(0.046, 0.62, true);
  group.add(exhaust);

  const gear = new THREE.Group();
  gear.name = "Hydraulic landing gear";
  const gearBatches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const gearPart = (geometry: THREE.BufferGeometry, material: THREE.Material, position: number[], rotation = new THREE.Euler()) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position as [number, number, number]), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1)));
    if (flat !== geometry) geometry.dispose();
    const batch = gearBatches.get(material) ?? [];
    batch.push(flat); gearBatches.set(material, batch);
  };
  for (const [x, z] of [[-0.42, 0.15], [0.42, 0.15], [0, -0.4]]) {
    gearPart(new THREE.BoxGeometry(0.068, 0.047, 0.084), dark, [x, -0.12, z]);
    gearPart(new THREE.CylinderGeometry(0.024, 0.027, 0.12, 20), titanium, [x, -0.185, z]);
    gearPart(new THREE.CylinderGeometry(0.013, 0.013, 0.145, 20), trim, [x, -0.29, z]);
    gearPart(new THREE.CylinderGeometry(0.031, 0.031, 0.025, 20), dark, [x, -0.255, z]);
    gearPart(new THREE.BoxGeometry(0.118, 0.027, 0.154), titanium, [x, -0.38, z]);
    gearPart(new THREE.BoxGeometry(0.092, 0.01, 0.124), dark, [x, -0.398, z]);
    for (const side of [-1, 1]) gearPart(new THREE.CylinderGeometry(0.007, 0.007, 0.15, 12), titanium,
      [x + side * 0.021, -0.28, z], new THREE.Euler(0, 0, side * 0.18));
  }
  for (const [material, geometries] of gearBatches) {
    gear.add(new THREE.Mesh(mergeGeometries(geometries)!, material));
    geometries.forEach(geometry => geometry.dispose());
  }
  gear.visible = false;
  group.add(gear);
  const landingFootOffset = -new THREE.Box3().setFromObject(gear).min.y;
  return { group, exhaust, gear, hullLength, landingFootOffset };
}
