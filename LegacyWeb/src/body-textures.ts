import type { BodyId } from "./solar-system";

/** Equirectangular surface map for one body; sources and licences are listed in ASSETS.md. */
export interface SurfaceMap {
  file: string;
  width: number;
  /** Illustration rather than spacecraft or telescope imagery of this body. */
  concept?: boolean;
  /** Relief height in body radii used to shade map brightness as terrain; 0 for clouds, gas and stars. */
  relief: number;
  /** Procedural detail added below the map's texel size when a surface is magnified. */
  grain: number;
  /** Stretch grain along latitude for cloud bands. */
  streaks?: boolean;
  /** Linear colour multiplier, used for greyscale maps and concept maps shared by several bodies. */
  tint?: readonly [number, number, number];
  /** Longitude offset in turns, so shared concept maps differ between bodies. */
  offset?: number;
  /** Loaded with the sky and kept resident; other maps load when the body is approached or observed. */
  core?: boolean;
  /** Native 4K alternate for compact devices, smaller GPU limits or an unavailable 8K map. */
  compactFile?: string;
}

const rock = (file: string, width = 4096, relief = 0.006, grain = 0.11): SurfaceMap => ({ file, width, relief, grain });
const gas = (file: string, width = 4096): SurfaceMap => ({ file, width, relief: 0, grain: 0.035, streaks: true, core: true });
const greyIce = (file: string, width: number): SurfaceMap => ({ ...rock(file, width), tint: [1.02, 0.99, 0.95] });
const smallMoon = (offset: number, tint: readonly [number, number, number]): SurfaceMap =>
  ({ file: "concept-asteroid.jpg", width: 4096, relief: 0.012, grain: 0.13, concept: true, offset, tint });
// Stars use luminance only; tint normalises each map's mean brightness before the stellar colour.
const star = (file: string, gain: number): SurfaceMap =>
  ({ file, width: 4096, relief: 0, grain: 0.03, concept: true, tint: [gain, gain, gain] });

export const SURFACE_MAPS: Partial<Record<BodyId, SurfaceMap>> = {
  sun: { file: "sun-real.jpg", width: 4096, relief: 0, grain: 0.03, core: true },
  mercury: { ...rock("mercury-real.jpg"), core: true },
  venus: { file: "venus-real.jpg", width: 4096, relief: 0, grain: 0.04, streaks: true, core: true },
  mars: { ...rock("mars-real-8k.jpg", 8192, 0.005, 0.1), compactFile: "mars-real.jpg" },
  jupiter: gas("jupiter-real.jpg"),
  saturn: gas("saturn-real.jpg"),
  uranus: gas("uranus-real.jpg", 2048),
  neptune: gas("neptune-real.jpg"),
  moon: { ...rock("moon-real-8k.jpg", 8192), compactFile: "moon-real.jpg" },
  io: rock("io-real.jpg", 4096, 0.004, 0.1),
  europa: rock("europa-real.jpg", 4096, 0.003, 0.08),
  ganymede: rock("ganymede-real.jpg", 4096, 0.005),
  callisto: rock("callisto-real.jpg"),
  mimas: rock("mimas-real.jpg", 4096, 0.008),
  enceladus: rock("enceladus-real.jpg", 4096, 0.006, 0.09),
  tethys: rock("tethys-real.jpg"),
  dione: rock("dione-real.jpg"),
  rhea: rock("rhea-real.jpg"),
  titan: { ...rock("titan-real.jpg", 4096, 0.002, 0.05), tint: [1.12, 1, 0.82] },
  hyperion: rock("hyperion-real.jpg", 2048, 0.012, 0.13),
  iapetus: rock("iapetus-real.jpg"),
  miranda: greyIce("miranda-real.jpg", 4096),
  ariel: greyIce("ariel-real.jpg", 4096),
  umbriel: greyIce("umbriel-real.jpg", 2048),
  titania: greyIce("titania-real.jpg", 2048),
  oberon: greyIce("oberon-real.jpg", 2048),
  triton: rock("triton-real.jpg", 4096, 0.004, 0.09),
  naiad: smallMoon(0, [0.57, 0.64, 0.75]),
  thalassa: smallMoon(0.37, [0.73, 0.85, 0.94]),
  despina: smallMoon(0.61, [0.62, 0.71, 0.85]),
  galatea: smallMoon(0.83, [0.85, 0.89, 0.96]),
  larissa: smallMoon(0.17, [0.75, 0.78, 0.84]),
  proteus: smallMoon(0.5, [0.69, 0.72, 0.78]),
  nereid: { ...rock("concept-haumea.jpg", 4096, 0.01, 0.12), concept: true, tint: [1.15, 1.18, 1.18] },
  "alpha-centauri-a": star("star-g.jpg", 1.16),
  "alpha-centauri-b": star("star-k.jpg", 1.16),
  "proxima-centauri": star("star-m.jpg", 1.58),
  betelgeuse: { file: "betelgeuse-8k.jpg", compactFile: "betelgeuse-4k.jpg", width: 8192, relief: 0, grain: 0.045, concept: true },
  "proxima-b": { ...rock("concept-makemake.jpg", 4096, 0.004, 0.1), concept: true },
  "proxima-c": { file: "concept-venuslike.jpg", width: 4096, relief: 0, grain: 0.04, streaks: true, concept: true, tint: [0.8, 0.96, 1.1] },
  "proxima-d": { ...rock("concept-ceres.jpg"), concept: true },
  "barnard-star": { file: "barnard-star-8k.jpg", compactFile: "barnard-star-4k.jpg", width: 8192, relief: 0, grain: 0.04, concept: true },
  "barnard-d": { ...rock("barnard-d-8k.jpg", 8192, 0.006, 0.12), compactFile: "barnard-d-4k.jpg", concept: true },
  "barnard-b": { ...rock("barnard-b-8k.jpg", 8192, 0.005, 0.11), compactFile: "barnard-b-4k.jpg", concept: true },
  "barnard-c": { ...rock("barnard-c-8k.jpg", 8192, 0.004, 0.1), compactFile: "barnard-c-4k.jpg", concept: true },
  "barnard-e": { ...rock("barnard-e-8k.jpg", 8192, 0.007, 0.12), compactFile: "barnard-e-4k.jpg", concept: true },
};

export const surfaceMapLabel = (id: BodyId) => {
  if (id === "earth") return "16K / 8K / 4K 地表影像 · 程序细节";
  const map = SURFACE_MAPS[id];
  if (!map) return "程序化材质";
  return `${map.width >= 8192 ? "8K / 4K" : map.width === 4096 ? "4K" : "2K"} ${map.concept ? "高清概念图" : "实测影像"} · 独立程序细节`;
};
