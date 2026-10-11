import type { CelestialBody } from "./solar-system";

/** Spatial frequency budget, not the resolution of the source photographs. */
export const PROCEDURAL_DETAIL_WIDTH = 32768;

export interface ProceduralBodyProfile {
  /** Independent, stable offsets in 3D noise space; unaffected by navigation order. */
  seed: readonly [number, number, number];
  grainSeed: number;
  /** Landform scale, crater density, ridge strength, ice fracture strength. */
  terrain: readonly [number, number, number, number];
  /** Latitude band frequency, turbulence, circulation speed, cloud scale. */
  weather: readonly [number, number, number, number];
  /** Anisotropy for unresolved rock, ice, cloud or plasma detail. */
  stretch: readonly [number, number, number];
  /** Transform value noise into sharper ridges without changing the photo palette. */
  ridgeMix: number;
  maxDetailWidth: number;
}

type Parameters = Pick<ProceduralBodyProfile, "terrain" | "weather" | "stretch" | "ridgeMix">;
type BodyIdentity = Pick<CelestialBody, "id" | "surfaceSeed" | "surfaceStyle" | "kind">;

const rock: Parameters = { terrain: [5, 24, 0.28, 0], weather: [22, 0.4, 0.003, 7], stretch: [1, 1, 1], ridgeMix: 0.26 };
const ice: Parameters = { terrain: [4.7, 20, 0.2, 0.7], weather: [26, 0.4, 0.002, 8], stretch: [1.6, 0.7, 1.3], ridgeMix: 0.72 };
const gas: Parameters = { terrain: [5, 0, 0, 0], weather: [30, 0.7, 0.004, 9], stretch: [0.32, 2.7, 0.32], ridgeMix: 0.08 };
const star: Parameters = { terrain: [5, 0, 0.35, 0], weather: [0, 1.4, 0.008, 20], stretch: [1, 1, 1], ridgeMix: 0.48 };

const presets: Partial<Record<CelestialBody["id"], Partial<Parameters>>> = {
  sun: { ...star },
  mercury: { terrain: [6.2, 28, 0.42, 0], ridgeMix: 0.42 },
  venus: { ...gas, weather: [38, 1.15, 0.002, 6.5], stretch: [0.45, 2.2, 0.45] },
  earth: { terrain: [5.4, 0, 0.3, 0], weather: [18, 0.8, 0.003, 11], ridgeMix: 0.32 },
  mars: { terrain: [5.8, 35, 0.48, 0], stretch: [1.3, 0.8, 1.3], ridgeMix: 0.46 },
  jupiter: { ...gas, weather: [30, 0.72, 0.005, 9] },
  saturn: { ...gas, weather: [32, 0.45, 0.003, 7], stretch: [0.24, 3.3, 0.24] },
  uranus: { ...gas, weather: [22, 0.16, 0.0015, 4.5], stretch: [0.5, 1.7, 0.5] },
  neptune: { ...gas, weather: [24, 1.1, 0.007, 12], stretch: [0.35, 3.1, 0.35] },
  moon: { terrain: [4.8, 27, 0.42, 0], ridgeMix: 0.4 },
  io: { terrain: [6.8, 12, 0.5, 0], stretch: [1.2, 0.9, 1.4], ridgeMix: 0.55 },
  europa: { ...ice, terrain: [4.3, 8, 0.16, 0.92], stretch: [1.9, 0.55, 1.6] },
  enceladus: { ...ice, terrain: [5.2, 13, 0.24, 0.9], stretch: [1.1, 0.6, 1.8] },
  titan: { ...gas, terrain: [4.2, 18, 0.08, 0], weather: [19, 0.25, 0.001, 5] },
  hyperion: { terrain: [7.5, 40, 0.75, 0], ridgeMix: 0.65 },
  iapetus: { terrain: [5.1, 28, 0.48, 0.12], ridgeMix: 0.46 },
  triton: { ...ice, terrain: [6.1, 11, 0.2, 0.68] },
  "alpha-centauri-a": { ...star, weather: [0, 1.2, 0.006, 19] },
  "alpha-centauri-b": { ...star, terrain: [6, 0, 0.4, 0], weather: [0, 1.6, 0.005, 23] },
  "proxima-centauri": { ...star, terrain: [7, 0, 0.5, 0], weather: [0, 2, 0.012, 27] },
  betelgeuse: { ...star, terrain: [3.8, 0, 0.62, 0], weather: [0, 2.2, 0.002, 8] },
  "proxima-b": { terrain: [5.9, 23, 0.58, 0], ridgeMix: 0.5 },
  "proxima-c": { ...gas, weather: [29, 1.45, 0.003, 11], stretch: [0.5, 2.4, 0.5] },
  "proxima-d": { terrain: [7.2, 31, 0.54, 0], ridgeMix: 0.46 },
  // Barnard's surface units are concepts, with distinct dry mineral/regolith
  // morphology; all keep the same filtered 32K spatial-frequency budget.
  "barnard-star": { ...star, terrain: [8.2, 0, 0.35, 0], weather: [0, 1.1, 0.001, 38], ridgeMix: 0.32 },
  "barnard-b": { terrain: [5.4, 29, 0.43, 0], stretch: [1.15, 0.9, 1.1], ridgeMix: 0.45 },
  "barnard-c": { terrain: [6.7, 37, 0.51, 0], stretch: [0.9, 1.2, 1], ridgeMix: 0.53 },
  "barnard-d": { terrain: [7.2, 23, 0.58, 0], stretch: [1.3, 0.85, 1.15], ridgeMix: 0.59 },
  "barnard-e": { terrain: [4.9, 41, 0.36, 0], stretch: [1, 1.05, 0.95], ridgeMix: 0.38 },
};

function hashIdentity(identity: string): number {
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  // Avalanche the final hash so the x / y / z salts do not produce correlated offsets.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** All bodies get their own seed and morphology, including moons sharing a concept map. */
export function proceduralBodyProfile(body: BodyIdentity): ProceduralBodyProfile {
  const identity = `${body.id}:${body.surfaceSeed ?? 0}`;
  const sample = (salt: string) => hashIdentity(`${identity}:${salt}`) / 4294967296;
  const base = body.kind === "star" ? star : body.surfaceStyle === 1 ? ice : rock;
  const preset = presets[body.id];
  const source = { ...base, ...preset };
  // Per-body variation also gives otherwise similar small moons independent landforms.
  const variation = 0.88 + sample("scale") * 0.24;
  const terrain: ProceduralBodyProfile["terrain"] = [
    source.terrain[0] * variation,
    source.terrain[1] * (0.9 + sample("craters") * 0.2),
    source.terrain[2], source.terrain[3],
  ];
  return {
    seed: [sample("x") * 251, sample("y") * 251, sample("z") * 251],
    grainSeed: sample("grain") * 1024,
    terrain,
    weather: [source.weather[0] * (0.94 + sample("bands") * 0.12), source.weather[1], source.weather[2], source.weather[3] * variation],
    stretch: source.stretch,
    ridgeMix: source.ridgeMix,
    maxDetailWidth: PROCEDURAL_DETAIL_WIDTH,
  };
}
