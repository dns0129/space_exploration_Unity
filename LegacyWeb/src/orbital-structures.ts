import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CelestialBody } from "./solar-system";
import type { PlanetModel } from "./planet-models";
import { orbitPosition } from "../shared/solar-orbits.mjs";

/** Fictional starship, bounded by a unit radius.
 * Local -Z points forward; the aft hangar approaches from +Z.
 * Keep the group unrotated: navigation uses this same station-local frame.
 */
export function createStationModel(body: CelestialBody): PlanetModel {
  const group = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xa7b8ca, emissive: 0x172536, emissiveIntensity: 0.24, metalness: 0.64, roughness: 0.38 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x26364a, emissive: 0x071522, emissiveIntensity: 0.28, metalness: 0.78, roughness: 0.42 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x586f84, emissive: 0x0b1c30, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.48 });
  const solar = new THREE.MeshStandardMaterial({ color: 0x123b69, emissive: 0x0b3e70, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.28, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xbda168, emissive: 0x34220a, emissiveIntensity: 0.18, metalness: 0.7, roughness: 0.4 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x65ddff });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffbb62 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3386a2, emissive: 0x0d5c7c, emissiveIntensity: 0.3, metalness: 0.25, roughness: 0.16, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide });
  const pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();
  function add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotation = new THREE.Euler()) {
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1)));
    const batch = pieces.get(material) ?? [];
    batch.push(geometry); pieces.set(material, batch);
  }
  // Long armored cruiser: forward bridge (-Z), hangar aft, four drive nacelles.
  add(new THREE.BoxGeometry(0.36, 0.18, 1.42), frame, 0, 0, 0);
  add(new THREE.BoxGeometry(0.44, 0.11, 1.18), hull, 0, 0.06, 0.02);
  add(new THREE.BoxGeometry(0.3, 0.08, 1.52), armor, 0, -0.1, -0.03);
  add(new THREE.ConeGeometry(0.25, 0.38, 4), hull, 0, 0.015, -0.8, new THREE.Euler(-Math.PI / 2, 0, Math.PI / 4));
  add(new THREE.BoxGeometry(0.32, 0.09, 0.3), frame, 0, 0.16, -0.56);
  add(new THREE.BoxGeometry(0.27, 0.065, 0.018), glass, 0, 0.17, -0.716);
  add(new THREE.BoxGeometry(0.28, 0.008, 0.023), cyan, 0, 0.13, -0.723);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.1, 0.12, 1.08), armor, side * 0.27, -0.02, 0.13);
    add(new THREE.BoxGeometry(0.025, 0.014, 1.16), cyan, side * 0.227, 0.07, 0.02);
    add(new THREE.BoxGeometry(0.1, 0.1, 0.7), frame, side * 0.38, -0.02, 0.24);
    for (const x of [0.29, 0.43]) {
      add(new THREE.CylinderGeometry(0.066, 0.082, 0.66, 24), hull, side * x, -0.025, 0.32, new THREE.Euler(Math.PI / 2, 0, 0));
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24), frame, side * x, -0.025, 0.67, new THREE.Euler(Math.PI / 2, 0, 0));
      add(new THREE.CylinderGeometry(0.044, 0.044, 0.012, 24), cyan, side * x, -0.025, 0.696, new THREE.Euler(Math.PI / 2, 0, 0));
    }
    for (let plate = 0; plate < 8; plate++) {
      add(new THREE.BoxGeometry(0.13, 0.015, 0.095), armor, side * 0.14, 0.122, -0.46 + plate * 0.13);
      add(new THREE.BoxGeometry(0.008, 0.02, 0.08), gold, side * 0.215, 0.09, -0.46 + plate * 0.13);
    }
    add(new THREE.BoxGeometry(0.016, 0.055, 0.44), glass, side * 0.228, 0.025, -0.05);
    add(new THREE.BoxGeometry(0.024, 0.035, 0.035), amber, side * 0.47, 0.035, 0.56);
  }
  add(new THREE.BoxGeometry(0.23, 0.09, 0.035), frame, 0, -0.01, 0.73);
  add(new THREE.BoxGeometry(0.2, 0.008, 0.04), amber, 0, -0.05, 0.75);
  add(new THREE.BoxGeometry(0.2, 0.11, 0.018), solar, 0, -0.015, 0.752);

  // Static material batches keep the detailed exterior to eight draw calls.
  let surface!: THREE.Mesh;
  for (const [material, geometries] of pieces) {
    const merged = mergeGeometries(geometries)!;
    geometries.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, material);
    group.add(mesh);
    if (material === hull) surface = mesh;
  }
  return { body, group, surface, layers: {}, spinning: [], timeUniforms: [] };
}

/** Statistical main-belt sample, not a catalogue or a realtime ephemeris.
 * Gaps are in semimajor axis; eccentric orbits overlap them in physical space.
 * No artificial swarm is placed around Ceres (which is rendered separately).
 */
export function createAsteroidBelt(unitsKm: number, auKm: number) {
  const group = new THREE.Group();
  let seed = 7391;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const count = 12000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const diameters = new Float32Array(count);
  const semimajorAxes = new Float64Array(count);
  const eccentricities = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let a: number;
    // Major Jupiter resonances: 3:1, 5:2, 7:3 and 2:1.
    do { a = 2.1 + random() * 1.2; } while (
      [[2.50, 0.025], [2.82, 0.018], [2.96, 0.014], [3.27, 0.025]]
        .some(([center, width]) => Math.abs(a - center) < width));
    const eccentricity = 0.03 + random() ** 1.5 * 0.25;
    semimajorAxes[i] = a;
    eccentricities[i] = eccentricity;
    const meanAnomaly = random() * Math.PI * 2;
    let eccentricAnomaly = meanAnomaly;
    // Kepler's equation: uniform mean anomaly gives correct dwell time.
    for (let step = 0; step < 6; step++) eccentricAnomaly -=
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    const anomaly = Math.atan2(Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly), Math.cos(eccentricAnomaly) - eccentricity);
    const radius = a * (1 - eccentricity * Math.cos(eccentricAnomaly)) * auKm / unitsKm;
    const inclination = Math.min(30, 6 * Math.sqrt(-2 * Math.log(1 - random())));
    const node = random() * 360;
    const perihelion = random() * 360;
    positions.set(orbitPosition(radius, node + perihelion + anomaly * 180 / Math.PI, inclination, node), i * 3);
    // Truncated power law: many small bodies, few large ones; no enlarged rocks.
    diameters[i] = Math.min(200, 2 / Math.sqrt(1 - random())) / unitsKm;
    // Dark carbonaceous material is more common toward the outer main belt.
    const carbonaceous = random() < (a - 2.1) / 1.2;
    const albedo = carbonaceous ? 0.035 + random() * 0.045 : 0.12 + random() * 0.16;
    colors.set([albedo, albedo * 0.96, albedo * 0.90], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.userData.orbits = { semimajorAxes, eccentricities };
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("diameter", new THREE.BufferAttribute(diameters, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { viewportHeight: { value: 1 }, au: { value: auKm / unitsKm } },
    vertexColors: true, transparent: true, depthWrite: false,
    vertexShader: `
      attribute float diameter;
      uniform float viewportHeight;
      uniform float au;
      varying vec3 reflected;
      varying float coverage;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float pixels = diameter * projectionMatrix[1][1] * viewportHeight / (2.0 * max(0.00001, -mvPosition.z));
        gl_PointSize = clamp(pixels, 1.0, 64.0);
        coverage = min(1.0, pixels * pixels);
        vec3 sunDirection = normalize(mat3(modelViewMatrix) * -position);
        float phaseAngle = acos(clamp(dot(sunDirection, normalize(-mvPosition.xyz)), -1.0, 1.0));
        float phase = (sin(phaseAngle) + (3.14159265 - phaseAngle) * cos(phaseAngle)) / 3.14159265;
        float solarFlux = au * au / dot(position, position);
        reflected = color * phase * solarFlux;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      varying vec3 reflected;
      varying float coverage;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        float edge = 1.0 - smoothstep(0.35, 0.5, length(gl_PointCoord - 0.5));
        if (coverage * edge < 0.0001) discard;
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(reflected, coverage * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  const viewport = new THREE.Vector2();
  points.onBeforeRender = renderer => {
    material.uniforms.viewportHeight.value = renderer.getDrawingBufferSize(viewport).y;
  };
  group.add(points);
  return group;
}
