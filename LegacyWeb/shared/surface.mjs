import { getTerrainHeightField, terrainDefinitions } from "./terrain-fields.mjs";
import { getEchoTerrainHeightField, echoTerrainDefinitions } from "./echo-terrain.mjs";

// Gameplay profiles: density and inferred rocky relief are illustrative. Earth
// macrorelief uses the same shipped GEBCO elevation as its visible surface.
const profiles = {
  gargantua: { solid: false, gravity: 0, landingReason: "黑洞没有固体地表，无法着陆；请留在吸积盘外的安全航区" },
  "earth-station": { solid: false, gravity: 0 },
  ceres: { ground: "#82776a", gravity: 0.27 },
  sun: { solid: false, sky: "#ff9b42", gravity: 274 },
  "alpha-centauri-a": { solid: false, sky: "#fff1cf", gravity: 200 },
  "alpha-centauri-b": { solid: false, sky: "#ffcb92", gravity: 300 },
  "proxima-centauri": { solid: false, sky: "#ff805a", gravity: 1000 },
  betelgeuse: { solid: false, sky: "#ff9d63", gravity: 0.007 },
  "barnard-star": { solid: false, sky: "#ffc38f", gravity: 1298 },
  // The radii and rocky surfaces are concepts; these gravities use minimum
  // radial-velocity masses and illustrative radii, not measured surface values.
  "barnard-d": { ground: "#a88565", gravity: 5.41, gravityEstimated: true },
  "barnard-b": { ground: "#9c9283", gravity: 5.50, gravityEstimated: true },
  "barnard-c": { ground: "#777d82", gravity: 5.79, gravityEstimated: true },
  "barnard-e": { ground: "#b3afa0", gravity: 4.69, gravityEstimated: true },
  // Echo Rift is wholly fictional; gravity and atmosphere are gameplay values.
  "echo-pulsar": { solid: false, sky: "#a6e9ff", gravity: 0, landingReason: "脉冲星没有可着陆的固体地表" },
  veyl: { solid: false, sky: "#70bcca", gravity: 29, gravityEstimated: true, density: 2.5, scaleKm: 210, landingReason: "气态巨行星没有可降落的固体地表，请选择塔拉萨或烬岩" },
  "echo-thalassa": { sky: "#66c9d1", ground: "#648b7e", gravity: 8.3, gravityEstimated: true, density: .82, scaleKm: 9.2 },
  cinder: { ground: "#a87859", gravity: 6.6, gravityEstimated: true },
  ruin: { solid: false, ground: "#bd8a98", gravity: 0, landingReason: "残冕的岩壳已经碎裂，没有连续且稳定的地表，无法着陆" },
  shard: { solid: false, ground: "#8fa7b5", gravity: 0, landingReason: "裂片由漂浮残骸组成，没有连续且稳定的地表，无法着陆" },
  // Exoplanet gravities are gameplay estimates, not measured surface values.
  "proxima-b": { sky: "#af8976", ground: "#a2785c", gravity: 10, gravityEstimated: true, density: 0.6, scaleKm: 9 },
  "proxima-c": { sky: "#93bdce", ground: "#81999f", gravity: 12, gravityEstimated: true, density: 1, scaleKm: 40 },
  "proxima-d": { ground: "#aa8872", gravity: 5, gravityEstimated: true },
  mercury: { sky: "#000000", ground: "#84796b", gravity: 3.7 },
  venus: { sky: "#d9a45c", ground: "#a16c3b", gravity: 8.87, density: 8, scaleKm: 16 },
  earth: { sky: "#72b8ef", ground: "#657d49", gravity: 9.81, density: 1, scaleKm: 8.5 },
  mars: { sky: "#c89477", ground: "#ab5334", gravity: 3.71, density: 0.04, scaleKm: 11 },
  jupiter: { solid: false, sky: "#c7aa8d", gravity: 24.79, density: 3, scaleKm: 180 },
  saturn: { solid: false, sky: "#dfc899", gravity: 10.44, density: 2, scaleKm: 160 },
  uranus: { solid: false, sky: "#83cbd0", gravity: 8.69, density: 2, scaleKm: 100 },
  neptune: { solid: false, sky: "#547bbd", gravity: 11.15, density: 2, scaleKm: 100 },
  // Approximate mean surface gravity in m/s²; g = GM / R² with km converted to metres.
  // NASA Moon fact sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html
  // JPL satellite GM/radii: https://ssd.jpl.nasa.gov/sats/phys_par/
  // Small irregular moons are simplified spheres; their values are rounded gameplay inputs.
  moon: { gravity: 1.62 },
  io: { gravity: 1.796 },
  europa: { gravity: 1.315 },
  ganymede: { gravity: 1.428 },
  callisto: { gravity: 1.236 },
  mimas: { gravity: 0.064 },
  enceladus: { gravity: 0.113 },
  tethys: { gravity: 0.145 },
  dione: { gravity: 0.232 },
  rhea: { gravity: 0.264 },
  titan: { sky: "#cc9856", ground: "#a38355", gravity: 1.35, density: 1.5, scaleKm: 40 },
  hyperion: { gravity: 0.02 },
  iapetus: { gravity: 0.223 },
  miranda: { gravity: 0.079 },
  ariel: { gravity: 0.269 },
  umbriel: { gravity: 0.2 },
  titania: { gravity: 0.379 },
  oberon: { gravity: 0.347 },
  naiad: { gravity: 0.012 },
  thalassa: { gravity: 0.013 },
  despina: { gravity: 0.026 },
  galatea: { gravity: 0.018 },
  larissa: { gravity: 0.03 },
  proteus: { gravity: 0.07 },
  triton: { gravity: 0.779 },
  nereid: { gravity: 0.071 },
};
export function surfaceProfile(id) {
  return { solid: true, sky: "#000000", ground: "#aaa79b", gravity: 1.62, gravityEstimated: false, density: 0, scaleKm: 1, ...profiles[id] };
}
// Smooth 3D value noise avoids longitude seams and remains stable when tiles move.
function earthNoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = t => t * t * (3 - 2 * t);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  const hash = (a, b, c) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(
    mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), tx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), tx), ty),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), tx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), tx), ty), tz);
}
// A continuous function of the radial direction keeps collision and regenerated tiles identical.
export function legacyTerrainHeightKm(id, normal) {
  if (!surfaceProfile(id).solid) return 0;
  const [x, y, z] = normal;
  if (id === "earth") {
    // Kilometre-scale ranges, branching ridges and foothills; illustrative, not a DEM.
    const region = earthNoise(x * 38 + 7, y * 38 - 3, z * 38 + 11);
    const warp = earthNoise(x * 110, y * 110, z * 110) * 2;
    const ridge = 1 - Math.abs(earthNoise(x * 260 + warp, y * 260 - warp, z * 260 + 17) * 2 - 1);
    const shoulder = earthNoise(x * 620 + 31, y * 620, z * 620 - 9);
    const detail = earthNoise(x * 1800, y * 1800 + 5, z * 1800);
    const mountain = Math.max(0, Math.min(1, (region - 0.28) / 0.42));
    return 0.06 + mountain * (0.25 + 4.6 * ridge ** 3) + shoulder * 0.22 + detail * 0.045;
  }
  const seed = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) * 0.17;
  const broad = Math.sin(x * 1900 + seed) * Math.sin(y * 1700 - seed) * Math.cos(z * 2100);
  const fine = Math.sin(x * 7200 + y * 3600 + seed) * Math.cos(z * 6400 - y * 3200);
  return 0.065 + broad * 0.045 + fine * 0.009;
}
export const TERRAIN_VERSION = 2;
export const terrainHeightField = id => getEchoTerrainHeightField(id) ?? getTerrainHeightField(id);

/** Map a fixed world radial into the photographic frame used during flight. */
export function terrainMapUv(id, normal) {
  const definition = echoTerrainDefinitions[id] ?? terrainDefinitions[id];
  const tilt = definition?.tiltRad ?? 0;
  const yaw = -(definition?.yawRad ?? -0.4) + (definition?.mapOffset ?? 0) * Math.PI * 2;
  const length = Math.hypot(...normal) || 1;
  const [x, y, z] = normal.map(n => n / length);
  const tx = Math.cos(tilt) * x + Math.sin(tilt) * y;
  const ty = -Math.sin(tilt) * x + Math.cos(tilt) * y;
  const mx = Math.cos(yaw) * tx + Math.sin(yaw) * z;
  const mz = -Math.sin(yaw) * tx + Math.cos(yaw) * z;
  const u = Math.atan2(mz, -mx) / (Math.PI * 2);
  return [u - Math.floor(u), .5 + Math.asin(Math.max(-1, Math.min(1, ty))) / Math.PI];
}
/** Inverse mapping, useful for navigating/tests of a feature in a source mosaic. */
export function terrainMapNormal(id, uv) {
  const definition = echoTerrainDefinitions[id] ?? terrainDefinitions[id];
  const longitude = uv[0] * Math.PI * 2, latitude = (uv[1] - .5) * Math.PI;
  const x = -Math.cos(longitude) * Math.cos(latitude), y = Math.sin(latitude), z = Math.sin(longitude) * Math.cos(latitude);
  const yaw = (definition?.yawRad ?? -.4) - (definition?.mapOffset ?? 0) * Math.PI * 2;
  const tilt = definition?.tiltRad ?? 0;
  const tx = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const tz = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return [Math.cos(tilt) * tx - Math.sin(tilt) * y, Math.sin(tilt) * tx + Math.cos(tilt) * y, tz];
}

// Pixel centres and wrap/clamp exactly match an uncoloured, linear-filtered
// DataTexture with flipY=false. Neither quality nor distance changes this field.
export function sampleTerrainField(field, uv) {
  const x = (uv[0] - Math.floor(uv[0])) * field.width - .5;
  const y = Math.max(0, Math.min(field.height - 1, uv[1] * field.height - .5));
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = x - ix, ty = y - iy;
  const wrap = n => (n % field.width + field.width) % field.width;
  const north = Math.min(iy + 1, field.height - 1);
  const a = field.data[iy * field.width + wrap(ix)], b = field.data[iy * field.width + wrap(ix + 1)];
  const c = field.data[north * field.width + wrap(ix)], d = field.data[north * field.width + wrap(ix + 1)];
  return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) / 255;
}

export function terrainHeightKm(id, normal) {
  if (!surfaceProfile(id).solid) return 0;
  const field = terrainHeightField(id);
  if (!field) return legacyTerrainHeightKm(id, normal);
  const length = Math.hypot(...normal) || 1;
  const radial = normal.map(n => n / length);
  const macro = field.heightOffsetKm + sampleTerrainField(field, terrainMapUv(id, radial)) * field.heightScaleKm;
  // Preserve the continuous metre-scale game surface. Its zero-mean component
  // is shared with orbit shaders; it cannot erase or move the macrorelief.
  return macro + (field.fineEnabled ? legacyTerrainHeightKm(id, radial) - .065 : 0);
}

export function terrainMaxHeightKm(id) {
  if (!surfaceProfile(id).solid) return 0;
  const definition = echoTerrainDefinitions[id] ?? terrainDefinitions[id];
  return definition ? definition.heightOffsetKm + definition.heightScaleKm + (definition.fineEnabled ? .054 : 0) : .119;
}

/** GPU counterpart of terrainHeightKm; texture bytes/UV transforms are shared. */
export const canonicalTerrainSampling = /* glsl */ `
  uniform sampler2D canonicalHeightMap;
  uniform float canonicalHeightScaleKm, canonicalHeightOffsetKm, canonicalHeightReady;
  uniform float canonicalFineSeed, canonicalFineEnabled;
  uniform mat3 canonicalWorldToMap;
  vec2 canonicalTerrainUv(vec3 worldRadial) {
    vec3 p = normalize(canonicalWorldToMap * normalize(worldRadial));
    return vec2(fract(atan(p.z, -p.x) / 6.283185307179586),
      0.5 + asin(clamp(p.y, -1.0, 1.0)) / 3.141592653589793);
  }
  // Geometry always reads the complete field. Shading may suppress only the
  // subpixel fine waves; its crater/DEM macroheight never changes with distance.
  float canonicalTerrainHeightFilteredKm(vec3 worldRadial, float broadWeight, float fineWeight) {
    vec3 p = normalize(worldRadial);
    float macroHeight = canonicalHeightOffsetKm;
    if (canonicalHeightReady > 0.5)
      macroHeight += texture2D(canonicalHeightMap, canonicalTerrainUv(p)).r * canonicalHeightScaleKm;
    if (canonicalFineEnabled < 0.5 || max(broadWeight, fineWeight) <= 0.0) return macroHeight;
    float broad = 0.0, fine = 0.0;
    if (broadWeight > 0.0) broad = sin(p.x * 1900.0 + canonicalFineSeed)
      * sin(p.y * 1700.0 - canonicalFineSeed) * cos(p.z * 2100.0);
    if (fineWeight > 0.0) fine = sin(p.x * 7200.0 + p.y * 3600.0 + canonicalFineSeed)
      * cos(p.z * 6400.0 - p.y * 3200.0);
    return macroHeight + canonicalFineEnabled * (broad * 0.045 * broadWeight + fine * 0.009 * fineWeight);
  }
  float canonicalTerrainHeightKm(vec3 worldRadial) {
    return canonicalTerrainHeightFilteredKm(worldRadial, 1.0, 1.0);
  }
`;
export const LANDING_CLEARANCE_KM = 0.006;
