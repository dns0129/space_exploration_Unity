import centauriData from "../shared/centauri.json" with { type: "json" };
import betelgeuseData from "../shared/betelgeuse.json" with { type: "json" };
import echoRiftData from "../shared/echo-rift.json" with { type: "json" };
import barnardData from "../shared/barnard.json" with { type: "json" };
import worldData from "../shared/world.json" with { type: "json" };
import moonData from "../shared/moons.json" with { type: "json" };
export type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "moon"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "mimas"
  | "enceladus"
  | "tethys"
  | "dione"
  | "rhea"
  | "titan"
  | "hyperion"
  | "iapetus"
  | "miranda"
  | "ariel"
  | "umbriel"
  | "titania"
  | "oberon"
  | "naiad"
  | "thalassa"
  | "despina"
  | "galatea"
  | "larissa"
  | "proteus"
  | "triton"
  | "nereid"
  | "alpha-centauri-a"
  | "alpha-centauri-b"
  | "proxima-centauri"
  | "proxima-b"
  | "proxima-c"
  | "proxima-d"
  | "betelgeuse"
  | "barnard-star"
  | "barnard-d"
  | "barnard-b"
  | "barnard-c"
  | "barnard-e"
  | "ceres"
  | "earth-station"
  | "echo-pulsar"
  | "veyl"
  | "echo-thalassa"
  | "cinder"
  | "ruin"
  | "shard"
  | "gargantua";
export type SystemId = "solar" | "alpha-centauri" | "proxima-centauri" | "betelgeuse" | "barnard" | "echo-rift" | "black-hole";
export type SystemGroupId = "solar" | "alpha-centauri" | "betelgeuse" | "barnard" | "echo-rift" | "black-hole";
export type Layer = "clouds" | "atmosphere" | "stars" | "rings";

export interface CelestialBody {
  id: BodyId;
  name: string;
  english: string;
  color: string;
  radiusKm: number;
  axialTiltDeg: number;
  flattening: number;
  distanceFromSunMillionKm: number;
  orbitalPeriodDays: number;
  rotationSpeed: number;
  tags: readonly string[];
  description: string;
  caption: string;
  layers: readonly Layer[];
  atmosphereColor?: string;
  atmosphereKm?: number;
  parentId?: BodyId;
  orbitRadiusKm?: number;
  surfaceStyle?: number;
  surfaceSeed?: number;
  systemId?: SystemId;
  kind?: "star" | "planet" | "station" | "black-hole";
  hostStarId?: BodyId;
  temperatureK?: number;
  spectralType?: string;
  /** Radial-velocity lower bound, m sin i; the true mass is not measured. */
  minimumMassEarth?: number;
  /** Chosen for the exploration model where no radius has been measured. */
  radiusConceptual?: boolean;
}

/** Single-body models use radius 1; real radii drive information and height readouts. */
export const PRIMARY_BODIES: readonly CelestialBody[] = [
  {
    id: "sun",
    name: "太阳",
    english: "SUN",
    color: "#f8bd67",
    radiusKm: 695700,
    axialTiltDeg: 7.25,
    flattening: 1,
    distanceFromSunMillionKm: 0,
    orbitalPeriodDays: 0,
    rotationSpeed: 0.015,
    tags: ["G 型恒星", "太阳系中心"],
    description:
      "光与热的源头。<br>翻涌的等离子体与明亮日冕，<br>照亮八颗行星的旅程。",
    caption: "SOL / OUR STAR",
    layers: ["atmosphere", "stars"],
  },
  {
    id: "mercury",
    name: "水星",
    english: "MERCURY",
    color: "#b4aaa1",
    radiusKm: 2439.7,
    axialTiltDeg: 0.034,
    flattening: 1,
    distanceFromSunMillionKm: 57.9,
    orbitalPeriodDays: 87.97,
    rotationSpeed: 0.012,
    tags: ["岩石行星", "陨石坑地表"],
    description:
      "紧邻太阳的岩石世界。<br>无数陨石坑镌刻着时间，<br>明暗交界处，山脊浮现。",
    caption: "MERCURY / SOL I",
    layers: ["stars"],
  },
  {
    id: "venus",
    name: "金星",
    english: "VENUS",
    color: "#e5c997",
    radiusKm: 6051.8,
    axialTiltDeg: 177.36,
    flattening: 1,
    distanceFromSunMillionKm: 108.2,
    orbitalPeriodDays: 224.7,
    rotationSpeed: 0.009,
    tags: ["岩石行星", "厚重大气"],
    description:
      "被金色云海包裹的世界。<br>浓密云层遮蔽炽热地表，<br>旋涡沿着天空缓慢流动。",
    caption: "VENUS / SOL II",
    layers: ["clouds", "atmosphere", "stars"],
    atmosphereColor: "#eec88e",
  },
  {
    id: "earth",
    name: "地球",
    english: "EARTH",
    color: "#75c8ef",
    radiusKm: 6371,
    axialTiltDeg: 23.44,
    flattening: 1,
    distanceFromSunMillionKm: 149.6,
    orbitalPeriodDays: 365.25,
    rotationSpeed: 0.025,
    tags: ["岩石行星", "宜居带"],
    description:
      "在浩瀚宇宙中，<br>一颗承载生命的蓝色星球。<br>你的星际旅程，从这里开始。",
    caption: "TERRA / SOL III",
    layers: ["clouds", "atmosphere", "stars"],
    atmosphereColor: "#539ced",
  },
  {
    id: "mars",
    name: "火星",
    english: "MARS",
    color: "#d59670",
    radiusKm: 3389.5,
    axialTiltDeg: 25.19,
    flattening: 0.994,
    distanceFromSunMillionKm: 227.9,
    orbitalPeriodDays: 686.98,
    rotationSpeed: 0.024,
    tags: ["岩石行星", "赤色世界"],
    description:
      "红色尘土覆盖的邻居。<br>暗色地形与白色极冠，<br>诉说着一颗行星的过去。",
    caption: "MARS / SOL IV",
    layers: ["atmosphere", "stars"],
    atmosphereColor: "#ca704e",
  },
  {
    id: "jupiter",
    name: "木星",
    english: "JUPITER",
    color: "#dbc1a5",
    radiusKm: 69911,
    axialTiltDeg: 3.13,
    flattening: 0.935,
    distanceFromSunMillionKm: 778.6,
    orbitalPeriodDays: 4332.59,
    rotationSpeed: 0.055,
    tags: ["气态巨行星", "大红斑"],
    description:
      "太阳系中最大的行星。<br>交错云带环绕辽阔天空，<br>一场红色风暴延续至今。",
    caption: "JUPITER / SOL V",
    layers: ["atmosphere", "stars"],
    atmosphereColor: "#bea998",
  },
  {
    id: "saturn",
    name: "土星",
    english: "SATURN",
    color: "#e6d6b1",
    radiusKm: 58232,
    axialTiltDeg: 26.73,
    flattening: 0.902,
    distanceFromSunMillionKm: 1433.5,
    orbitalPeriodDays: 10759.22,
    rotationSpeed: 0.05,
    tags: ["气态巨行星", "冰粒环系"],
    description:
      "以光环闻名的气态巨星。<br>细密环带与卡西尼缝隙，<br>在行星阴影中交织。",
    caption: "SATURN / SOL VI",
    layers: ["rings", "atmosphere", "stars"],
    atmosphereColor: "#d9cba8",
  },
  {
    id: "uranus",
    name: "天王星",
    english: "URANUS",
    color: "#afe0df",
    radiusKm: 25362,
    axialTiltDeg: 97.77,
    flattening: 0.977,
    distanceFromSunMillionKm: 2872.5,
    orbitalPeriodDays: 30688.5,
    rotationSpeed: 0.038,
    tags: ["冰巨行星", "横卧自转"],
    description:
      "柔和青蓝色的冰巨星。<br>极度倾斜的自转轴，<br>让它仿佛横卧着航行。",
    caption: "URANUS / SOL VII",
    layers: ["atmosphere", "stars"],
    atmosphereColor: "#99dedc",
  },
  {
    id: "neptune",
    name: "海王星",
    english: "NEPTUNE",
    color: "#7ca3e8",
    radiusKm: 24622,
    axialTiltDeg: 28.32,
    flattening: 0.983,
    distanceFromSunMillionKm: 4495.1,
    orbitalPeriodDays: 60182,
    rotationSpeed: 0.04,
    tags: ["冰巨行星", "遥远风暴"],
    description:
      "遥远轨道上的蓝色世界。<br>薄云掠过深蓝色大气，<br>隐约可见旋转的风暴。",
    caption: "NEPTUNE / SOL VIII",
    layers: ["clouds", "atmosphere", "stars"],
    atmosphereColor: "#4e91ee",
  },
];

export const MOONS: readonly CelestialBody[] = moonData.map((moon, index) => {
  const parent = PRIMARY_BODIES.find((body) => body.id === moon.parentId)!;
  return {
    ...moon, id: moon.id as BodyId, parentId: moon.parentId as BodyId,
    axialTiltDeg: moon.parentId === "uranus" ? 97.77 : 0,
    flattening: moon.id === "hyperion" ? 0.72 : ["naiad", "thalassa", "proteus"].includes(moon.id) ? 0.88 : 1,
    distanceFromSunMillionKm: parent.distanceFromSunMillionKm,
    rotationSpeed: 0.012, surfaceSeed: index * 7.31 + 1,
    tags: [parent.name + "卫星", moon.surfaceStyle === 1 ? "冰壳与裂缝" : moon.surfaceStyle === 2 ? "火山世界" : "冰岩世界"],
    caption: `${moon.english} / ${parent.english} SYSTEM`,
    layers: moon.id === "titan" ? ["atmosphere", "stars"] : ["stars"],
    atmosphereColor: moon.id === "titan" ? "#dfa350" : undefined,
  };
});
export const CENTAURI_BODIES: readonly CelestialBody[] = centauriData.map((body, index) => ({
  ...body, id: body.id as BodyId, systemId: body.systemId as SystemId,
  kind: body.kind as "star" | "planet", hostStarId: body.hostStarId as BodyId | undefined,
  axialTiltDeg: 0, flattening: 1, distanceFromSunMillionKm: 0,
  rotationSpeed: body.kind === "star" ? 0.018 : 0,
  surfaceSeed: index * 13.17 + 33,
  caption: body.english.replace("ALPHA CENTAURI", "ALPHA CEN").replace(" CENTAURI", ""),
  layers: body.kind === "star" || body.atmosphereKm ? ["atmosphere", "stars"] : ["stars"],
  atmosphereColor: body.color,
}));
export const BETELGEUSE_BODIES: readonly CelestialBody[] = betelgeuseData.map(body => ({
  ...body, id: body.id as BodyId, systemId: body.systemId as SystemId, kind: "star",
  axialTiltDeg: 0, flattening: 1, distanceFromSunMillionKm: 0,
  rotationSpeed: 0.002, surfaceSeed: 91.4, caption: "BETELGEUSE / RED SUPERGIANT",
  layers: ["atmosphere", "stars"], atmosphereColor: body.color,
}));
export const BARNARD_BODIES: readonly CelestialBody[] = barnardData.map(body => ({
  ...body, id: body.id as BodyId, systemId: "barnard", kind: body.kind as "star" | "planet",
  hostStarId: body.hostStarId as BodyId | undefined,
  // No measured obliquity or spin: retain the shared, static map/collision frame.
  axialTiltDeg: 0, flattening: 1, distanceFromSunMillionKm: 0,
  rotationSpeed: body.kind === "star" ? 0.003 : 0,
  caption: body.kind === "star" ? "BARNARD'S STAR / M3.5 V · RED DWARF"
    : `${body.english} / SHORT-PERIOD WORLD · CONCEPT SURFACE`,
  layers: body.kind === "star" ? ["atmosphere", "stars"] : ["stars"],
  atmosphereColor: body.kind === "star" ? body.color : undefined,
}));
export const ECHO_RIFT_BODIES: readonly CelestialBody[] = echoRiftData.map(body => ({
  ...body, id: body.id as BodyId, systemId: "echo-rift", kind: body.kind as "star" | "planet",
  hostStarId: body.hostStarId as BodyId | undefined, parentId: body.parentId as BodyId | undefined,
  // Fixed, shared surface frame keeps the ocean coastlines and collision terrain aligned.
  axialTiltDeg: 0, flattening: body.id === "veyl" ? 0.94 : 1,
  distanceFromSunMillionKm: 0, rotationSpeed: body.kind === "star" ? 0.14 : body.id === "veyl" ? 0.034 : 0,
  caption: `${body.english} / ECHO RIFT · FICTIONAL SYSTEM`,
  layers: body.kind === "star" || body.atmosphereKm ? ["atmosphere", "stars"] : ["stars"],
  atmosphereColor: body.atmosphereColor ?? body.color,
}));
export const EXPLORATION_BODIES: readonly CelestialBody[] = [
  {
    id: "ceres", name: "小行星带 · 谷神星", english: "ASTEROID BELT / CERES",
    kind: "planet", color: "#b5a18a", radiusKm: 473, axialTiltDeg: 4,
    flattening: 0.93, distanceFromSunMillionKm: 414.386, orbitalPeriodDays: 1682,
    rotationSpeed: 0.02, surfaceStyle: 0, surfaceSeed: 127, hostStarId: "sun",
    orbitRadiusKm: 414386101.839, tags: ["主小行星带", "谷神星航标"],
    description: "火星与木星之间的岩石航区。<br>以谷神星为导航入口，天体之间是广阔空旷的太空。<br>椭圆轨道统计示意，按真实尺寸与距离显示；非实测目录。",
    caption: "MAIN BELT / 2.1–3.3 AU · STATISTICAL ORBITS", layers: ["stars"],
  },
  {
    id: "earth-station", name: "远航星舰", english: "TERRA STARSHIP",
    kind: "station", color: "#8edcfa", radiusKm: 180, axialTiltDeg: 0,
    flattening: 1, distanceFromSunMillionKm: 149.6, orbitalPeriodDays: 0.095,
    rotationSpeed: 0, parentId: "earth", orbitRadiusKm: 8771,
    tags: ["2400 km 向阳轨道", "360 km 科幻星舰", "停泊与舱内探索"],
    description: "停驻在地球向阳面的远航星舰。<br>纵向装甲舰体、四台推进引擎、全景驾驶室、观测舱与穿梭机机库。<br>L 登舰后可在舰内走动，到驾驶台按 E 自由驾驶，按 X 离开驾驶座；跨度 360 km 为科幻游戏设定。",
    caption: "TERRA STARSHIP / FREE FLIGHT · ALTITUDE 2400 KM · FICTIONAL SCALE", layers: ["stars"],
  },
];
export const BLACK_HOLE_BODIES: readonly CelestialBody[] = [{
  id: "gargantua", systemId: "black-hole", kind: "black-hole", name: "暗渊黑洞", english: "GARGANTUA",
  color: "#ffc078", radiusKm: 30000, axialTiltDeg: 0, flattening: 1,
  distanceFromSunMillionKm: 0, orbitalPeriodDays: 0, rotationSpeed: 0,
  tags: ["黑洞 · 无固体地表", "引力透镜 · 艺术近似"], caption: "BLACK HOLE / ARTISTIC LENSING",
  description: "中央阴影、细亮光子环与暖金吸积盘。<br>背面光带经简化引力透镜形成上下拱弧。<br>阴影视觉半径 30,000 km，非事件视界实测值；系统距离为虚构。<br>三维盘面与视角相关的解析光带为艺术近似，未进行广义相对论光线追踪。<br>无固体地表；游戏安全屏障在阴影半径的 6 倍处，禁止着陆。",
  layers: ["stars"],
}];
export const SOLAR_SYSTEM: readonly CelestialBody[] = [...PRIMARY_BODIES, ...MOONS, ...CENTAURI_BODIES, ...BETELGEUSE_BODIES, ...EXPLORATION_BODIES, ...ECHO_RIFT_BODIES, ...BLACK_HOLE_BODIES, ...BARNARD_BODIES].map(body => ({
  ...body, atmosphereKm: worldData.bodies.find(config => config.id === body.id)?.atmosphereKm,
}));
export const STAR_SYSTEMS = worldData.systems;
export const getBodySystem = (body: CelestialBody) =>
  STAR_SYSTEMS.find(system => system.id === (body.systemId ?? "solar"))!;
export const getSystemGroup = (id: BodyId): SystemGroupId =>
  getBodySystem(getBody(id)).groupId as SystemGroupId;

export const getBody = (id: BodyId): CelestialBody =>
  SOLAR_SYSTEM.find((body) => body.id === id)!;
export const isBodyId = (value: string): value is BodyId =>
  SOLAR_SYSTEM.some((body) => body.id === value);
export const EARTH = getBody("earth");
