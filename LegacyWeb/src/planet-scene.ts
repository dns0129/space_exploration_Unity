import * as THREE from "three";
import { createAsteroidBelt } from "./orbital-structures";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EARTH, getBody, STAR_SYSTEMS } from "./solar-system";
import type { BodyId, Layer, SystemId } from "./solar-system";
import { createPlanetModel, atmosphereFragment, mapSampling, noise, setSurfaceMap } from "./planet-models";
import { SURFACE_MAPS } from "./body-textures";
import type { PlanetModel } from "./planet-models";
import { bodySystem, systemConfig } from "../shared/world-navigation.mjs";
import { ShipDynamics } from "./ship-dynamics";
import { FlightControls } from "./flight-controls";
import { WalkingDynamics } from "./walking-dynamics";
import { initializeWalkingPhysics } from "./walking-physics";
import { SpatialScale } from "../shared/spatial-frame.mjs";
import { ExplorerView } from "./explorer-view";
import { createStationModel } from "./orbital-structures";
import { StationInterior } from "./station-interior";
import { STATION_SPAWN } from "../shared/station-layout.mjs";
import { validateFlightState } from "../shared/flight-state.mjs";
import { createShip, SHIP_LENGTH_KM } from "./ship-model";
import { createWarpEffect } from "./warp-effect";
import { FlightLight } from "./flight-light";
import { GalaxySky, selectGalaxyFile } from "./galaxy-sky";
import type { GalaxyTextureFile } from "./galaxy-sky";
import { SurfaceScene } from "./surface-scene";
import { BARNARD_LIGHT_COLOR } from "./stellar-light";
import { atmosphereStrength } from "./atmosphere";
import { surfaceProfile, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { projectFlightTarget } from "./flight-target";
import type { FlightTargetStats } from "./flight-target";
import type { FlightState, WorldConfig } from "../shared/flight-state.mjs";
import { RenderBudget } from "./render-budget";
import { EarthDetail, earthDetailSampling } from "./earth-detail";
import type { RenderQuality } from "./earth-detail";
import { FlightRenderPolicy } from "./render-mode";
import type { FlightRenderMode } from "./render-mode";
import { surfaceMapRotation } from "./surface-map-pose";

export type View = "overview" | "close" | "night";
export type SurfacePlacement = { kind: "ship" | "person"; normal: [number, number, number] };
export interface SceneStats {
  altitudeKm: number;
  fps: number;
}

export interface FlightStats {
  systemId: SystemId;
  renderMode: FlightRenderMode | "station";
  engine: ShipDynamics["engine"];
  cruiseSpeedKm: number;
  lowFlightSpeedMps: number;
  engineMode: ShipDynamics["engineMode"];
  orbitalEngineActive: boolean;
  orbitalBlockReason: string | null;
  environment: ShipDynamics["environment"];
  warpBlockReason: string | null;
  warpPhase: ShipDynamics["warpPhase"];
  warpProgress: number;
  speedKm: number;
  speedLimitKm: number;
  altitudeKm: number;
  nearest: BodyId;
  distanceKm: number;
  target: BodyId;
  heading: number;
  elapsed: number;
  boosting: boolean;
  collision: BodyId | null;
  landingPhase: ShipDynamics["landingPhase"];
  landingBlockReason: string | null;
  walking: null | { gravity: number; speedMps: number; grounded: boolean; distanceToShipM: number; bodyId: BodyId; camera: "first" | "third" };
  station: null | { zone: string };
}
export interface FlightTrackingStats extends FlightTargetStats {
  target: BodyId;
  deceleration: number;
  aimX: number;
  aimY: number;
  steering: boolean;
  width: number;
  height: number;
}

const surfaceVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  void main() {
    vUv = uv;
    vLocalPosition = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vAxisX = normalize(mat3(modelMatrix)[0]);
    vAxisY = normalize(mat3(modelMatrix)[1]);
    vAxisZ = normalize(mat3(modelMatrix)[2]);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const earthSurfaceVertex = surfaceVertex
  .replace("void main()", "uniform sampler2D terrainMap; uniform float terrainDetail; uniform float elevationStrength; void main()")
  .replace("vec4 world = modelMatrix * vec4(position, 1.0);", /* glsl */ `
    float elevation = max(textureLod(terrainMap, uv, 0.0).r - 40.0 / 255.0, 0.0) * (255.0 / 215.0);
    vec3 displaced = position * (1.0 + elevation * 0.00142 * terrainDetail * elevationStrength);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
  `);

const surfaceFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D terrainMap;
  uniform sampler2D cloudMap;
  uniform vec2 mapSize;
  uniform vec2 terrainSize;
  uniform vec2 cloudSize;
  uniform vec2 nightSize;
  uniform float cloudsEnabled;
  uniform float cloudOffset;
  uniform float flatClouds;
  uniform float terrainDetail;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  ${noise}
  ${mapSampling}
  ${earthDetailSampling}
  float elevation(float value) { return max(value - 40.0 / 255.0, 0.0) * (255.0 / 215.0); }
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 p = normalize(vLocalPosition);
    vec2 gx, gy;
    bool seam = seamGradients(vUv, gx, gy);
    float texels = max(length(gx * mapSize), length(gy * mapSize));
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float magnify = 1.0 - smoothstep(0.6, 1.4, texels);
    vec3 terrainNormal = normal;
    float terrain = sampleMap(terrainMap, vUv, terrainSize, gx, gy, seam).r;
    float water = 1.0 - smoothstep(0.015, 40.0 / 255.0, terrain), landGrain = 0.0;
    float ring = length(p.xz);
    vec3 eastward = vec3(p.z, 0.0, -p.x) / max(ring, 0.0001);
    vec3 northward = cross(p, eastward);
    if(terrainDetail>0.5) {
      // Relief differenced in texture space keeps mountains smooth at any zoom, without texel facets.
      float stepTexels = max(1.0, max(length(gx * terrainSize), length(gy * terrainSize)));
      vec2 du = vec2(stepTexels / terrainSize.x, 0.0), dv = vec2(0.0, stepTexels / terrainSize.y);
      float reliefLod = log2(stepTexels);
      float east = elevation(textureLod(terrainMap, vUv + du, reliefLod).r) - elevation(textureLod(terrainMap, vUv - du, reliefLod).r);
      float north = elevation(textureLod(terrainMap, vUv + dv, reliefLod).r) - elevation(textureLod(terrainMap, vUv - dv, reliefLod).r);
      vec3 slope = 0.00142 * (east * terrainSize.x / (12.566 * max(ring, 0.15) * stepTexels) * eastward
        + north * terrainSize.y / (6.2832 * stepTexels) * northward);
      vec4 grain = surfaceGrain(p, 2600.0, footprint, magnify, vec3(1.0), 3.7);
      float land = 1.0 - water;
      slope += grain.yzw * 0.035 * land;
      landGrain = grain.x * land;
      slope -= p * dot(slope, p);
      terrainNormal = normalize(normal - mat3(vAxisX, vAxisY, vAxisZ) * slope);
    }
    float daylight = dot(normal, sunDirection);
    float diffuse = max(dot(terrainNormal, sunDirection), 0.0) * smoothstep(-0.12, 0.04, daylight);
    // The deep-blue day map stays the colour layer at every distance; land grain only adds texture.
    vec3 day = earthDay(vUv, gx, gy, seam);
    // Open ocean holds faint 8x8 JPEG blocks; when magnified, read it from the block-averaged mip.
    float smoothOcean = water * (1.0 - smoothstep(0.25, 0.6, texels));
    if(smoothOcean > 0.0) day = mix(day, sampleMapLod(dayMap, vUv, mapSize, 3.0).rgb, smoothOcean);
    day *= 1.0 + landGrain * 0.12;
    // Satellite mosaics have nearly black open water; retain its natural deep-blue scattering.
    day += vec3(0.002, 0.012, 0.035) * water;
    float cityLight = daylight<0.12 ? sampleMap(nightMap, vUv, nightSize, gx, gy, seam).r : 0.0;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 halfwayDirection = normalize(sunDirection + viewDirection);
    float specular = pow(max(dot(terrainNormal, halfwayDirection), 0.0), 72.0);
    float nightWeight = 1.0 - smoothstep(-0.15, 0.12, daylight);
    vec3 localSun = transpose(mat3(vAxisX, vAxisY, vAxisZ)) * sunDirection;
    // Intersect the light ray with the spherical 11 km cloud shell. The old
    // tangent-plane shift stretched shadows into a smeared decal near dusk.
    float localDay = dot(p, localSun);
    float shellRadius = 1.0 + 11.0 / 6371.0;
    float cloudDistance = -localDay + sqrt(localDay*localDay + shellRadius*shellRadius - 1.0);
    vec3 shadowPoint = normalize(p + localSun * cloudDistance);
    vec2 shadowUv = vec2(fract(atan(shadowPoint.z, -shadowPoint.x)/6.28318530718) + cloudOffset,
      1.0-acos(clamp(shadowPoint.y,-1.0,1.0))/3.14159265359);
    vec2 cloudUv = vec2(vUv.x + cloudOffset, vUv.y);
    float cloudCover = sampleMap(cloudMap, shadowUv, cloudSize, gx, gy, seam).r * cloudsEnabled;
    vec3 color = day * (0.015 + diffuse * 1.08 * (1.0-cloudCover*0.26));
    // Isolate the warm city lights from the blue-tinted night-map terrain.
    color += vec3(1.0, 0.65, 0.32) * pow(cityLight, 1.15) * nightWeight * 2.4 * (1.0-cloudCover*0.6);
    float fresnel = 0.02 + 0.98 * pow(1.0-max(dot(terrainNormal,viewDirection),0.0),5.0);
    color += vec3(0.75, 0.87, 1.0) * specular * water * smoothstep(0.0, 0.15, daylight) * (0.12+fresnel*0.35);
    float visibleCloud = sampleMap(cloudMap, cloudUv, cloudSize, gx, gy, seam).r * cloudsEnabled;
    color = mix(color,vec3(0.92,0.96,1.0)*(0.035+max(daylight,0.0)*1.1),visibleCloud*flatClouds*0.82);
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Separate cloud shell, shaded exactly like the merged distant clouds so Earth's colours never shift. */
const earthCloudFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D cloudMap;
  uniform vec2 mapSize;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  ${noise}
  ${mapSampling}
  void main() {
    vec3 p = normalize(vLocalPosition);
    vec2 gx, gy;
    bool seam = seamGradients(vUv, gx, gy);
    float texels = max(length(gx * mapSize), length(gy * mapSize));
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float magnify = 1.0 - smoothstep(0.6, 1.4, texels);
    vec4 cloud = sampleMap(cloudMap, vUv, mapSize, gx, gy, seam);
    float cover = cloud.r;
    if(magnify > 0.0) {
      // Sub-texel wisps sharpen partly covered texels instead of showing soft magnified blobs.
      vec4 grain = surfaceGrain(p, mapSize.x / 6.2832, footprint, magnify, vec3(1.0, 1.6, 1.0), 9.1);
      cover = clamp(cover + grain.x * 2.0 * cover * (1.0 - cover), 0.0, 1.0);
    }
    float daylight = max(dot(normalize(vNormal), sunDirection), 0.0);
    #include <logdepthbuf_fragment>
    float silver = pow(max(dot(normalize(cameraPosition-vWorldPosition), sunDirection),0.0),12.0) * (1.0-cover) * 0.2;
    gl_FragColor = vec4(vec3(0.92,0.96,1.0) * (0.035 + daylight * 1.1 + silver), cover * 0.82);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Owns rendering and GPU resources; UI consumes its public controls and metrics. */
export class SolarScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly spaceScene = new THREE.Scene();
  private readonly surfaceWorldScene = new THREE.Scene();
  private readonly surfaceCelestialScene = new THREE.Scene();
  private readonly renderPolicy = new FlightRenderPolicy();
  private readonly spaceWorkWaiters = new Set<() => void>();
  private readonly pendingSurfaceMaps = new Set<string>();
  private spaceUpdates = 0;
  private flightFrameDirty = true;
  private worldRenderCount = 0;
  private readonly drawnCameraPosition = new THREE.Vector3();
  private readonly drawnCameraQuaternion = new THREE.Quaternion();
  private drawnCameraFov = 0;
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  private readonly controls: OrbitControls;
  private readonly surfacePicker = new THREE.Raycaster();
  private photoCapture?: { resolve: (blob: Blob) => void; reject: (error: Error) => void };
  private readonly planet = new THREE.Group();
  private readonly galaxySky: GalaxySky;
  private readonly surfaceGalaxySky: GalaxySky;
  private readonly galaxyFile: GalaxyTextureFile;
  private currentModel?: PlanetModel;
  private readonly flightRoot = new THREE.Group();
  private asteroidBelt?: THREE.Group;
  private readonly flightSun = new THREE.PointLight(0xfff3e5, 2.5, 0, 0);
  private readonly observeSun = new THREE.DirectionalLight(0xfff3e5, 2.5);
  private readonly ship = createShip();
  private readonly shipScene = new THREE.Scene();
  private readonly shipCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 200);
  private readonly localRenderCamera = new THREE.PerspectiveCamera();
  private readonly shipSun = new THREE.DirectionalLight(0xfff3e5, 2.5);
  private readonly shipAmbient = new THREE.HemisphereLight(0xc1e6ee, 0x233643, 0.85);
  private readonly shipRim = new THREE.DirectionalLight(0x77bfff, 0.45);
  private shipScale = SHIP_LENGTH_KM / (6371 * this.ship.hullLength);
  private renderedShipScale = this.shipScale;
  private readonly warpEffect = createWarpEffect();
  private readonly flightLight = new FlightLight();
  private readonly surfaceScene = new SurfaceScene();
  private surfaceMapBody: BodyId | null = null;
  private galaxy?: THREE.Texture;
  private readonly backgrounds = new Map<SystemId, THREE.Texture>();
  private backgroundSystem: SystemId = "solar";
  private starsEnabled = true;
  private spacePromise?: Promise<void>;
  private readonly planetMaps = new Map<BodyId, THREE.Texture>();
  /** Moon, star and exoplanet maps load on approach and are released when unused, keyed by file. */
  private readonly lazyMaps = new Map<string, { texture?: THREE.Texture; loading?: Promise<void>; failedAt?: number; used: number }>();
  private readonly mapFades = new Set<PlanetModel>();
  private mapCheck = 0;
  private stillSeconds = 0;
  private readonly lastCameraPosition = new THREE.Vector3();
  private readonly lastCameraQuaternion = new THREE.Quaternion();
  private readonly compactTextures = window.matchMedia("(pointer: coarse)").matches
    || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  private flightModels: PlanetModel[] = [];
  private readonly flightModelById = new Map<BodyId, PlanetModel>();
  private readonly distantSphere = new THREE.SphereGeometry(1, 32, 24);
  private readonly mediumSphere = new THREE.SphereGeometry(1, 64, 48);
  private readonly tinySphere = new THREE.SphereGeometry(1, 16, 12);
  private readonly largeSphere = new THREE.SphereGeometry(1, 128, 80);
  private readonly renderBudget = new RenderBudget();
  private quality: RenderQuality = this.compactTextures ? "high" : "ultra";
  private minimumRenderRatio = 0.5;
  /** Sharp oblique detail on GPUs; software rasterizers keep the cheaper 4x filtering. */
  private surfaceAnisotropy = 4;
  private readonly flightGeometries = new Map<THREE.Mesh, THREE.BufferGeometry>();
  private readonly flightSpheres = new Map<PlanetModel, THREE.Mesh[]>();
  private dynamics?: ShipDynamics;
  private walker?: WalkingDynamics;
  private stationInterior?: StationInterior;
  private starshipHull?: THREE.Group;
  private readonly stationSpaceRotation = new THREE.Quaternion();
  private readonly stationSpaceOrigin = new THREE.Vector3();
  private readonly stationLocalOrigin = new THREE.Vector3().fromArray(STATION_SPAWN);
  private readonly explorerView = new ExplorerView();
  private explorerCamera: "first" | "third" = "third";
  private flightControls?: FlightControls;
  private flying = false;
  private flightPaused = false;
  private flightMetrics = 0;
  private flightHandler?: (stats: FlightStats) => void;
  private flightTargetHandler?: (stats: FlightTrackingStats) => void;
  private flightWidth = 1;
  private flightHeight = 1;
  private readonly flightRelative = new THREE.Vector3();
  private readonly flightForward = new THREE.Vector3();
  private flightBoost = 0;
  private readonly bankRotation = new THREE.Quaternion();
  private readonly flightAxis = new THREE.Vector3(0, 0, 1);
  private readonly models = new Map<BodyId, PlanetModel>();
  private readonly sunDirection = new THREE.Vector3(-3, 1.8, 4).normalize();
  private readonly textures = new Set<THREE.Texture>();
  private earthMaps?: THREE.Texture[];
  private earthPromise?: Promise<THREE.Texture[]>;
  private readonly earthDetails = new Map<PlanetModel, EarthDetail>();
  private earthHighMaps?: THREE.Texture[];
  private earthUpgrade?: Promise<void>;
  private earthUpgraded = false;
  private earthUpgradeAt = 0;
  private selectionVersion = 0;
  private readonly resizeObserver: ResizeObserver;
  private targetPosition: THREE.Vector3 | null = null;
  private paused = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  private speed = 1;
  private lastTime = 0;
  private metricsStart = 0;
  private frames = 0;
  private frame = 0;
  private destroyed = false;
  private hidden = document.hidden;
  private readonly visibilityHandler = () => {
    this.hidden = document.hidden;
    if (this.hidden && this.photoCapture) {
      this.photoCapture.reject(new Error("摄影已中止，请回到游戏画面后重试"));
      this.photoCapture = undefined;
    }
    this.flightFrameDirty = true;
    this.lastTime = 0;
    this.metricsStart = 0;
    this.frames = 0;
  };

  constructor(
    private readonly container: HTMLElement,
    private readonly onStats: (stats: SceneStats) => void,
    private readonly onError: (message: string) => void,
  ) {
    // MSAA smooths planet limbs and atmosphere edges; software rasterizers skip it to stay responsive.
    this.renderer = new THREE.WebGLRenderer({
      logarithmicDepthBuffer: true,
      antialias: !SolarScene.softwareRendering(),
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const gl = this.renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const graphicsRenderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unavailable";
    const software = /swiftshader|llvmpipe|software/i.test(graphicsRenderer);
    this.renderer.domElement.dataset.graphicsRenderer = graphicsRenderer;
    if (software) { this.minimumRenderRatio = 0.125; this.quality = "high"; }
    else this.surfaceAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.renderer.domElement.dataset.softwareRenderer = String(software);
    this.galaxySky = new GalaxySky(this.compactTextures || software);
    this.surfaceGalaxySky = new GalaxySky(true);
    this.galaxyFile = selectGalaxyFile(this.renderer.capabilities.maxTextureSize, this.compactTextures, software);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.shipSun.castShadow = true;
    this.shipSun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.shipSun.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 7, far: 13 });
    this.shipSun.shadow.bias = -0.00015;
    this.shipSun.shadow.normalBias = 0.003;
    this.ship.group.traverse(object => {
      if (object instanceof THREE.Mesh && !object.material.transparent) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "交互式 3D 天体：拖动旋转视角，滚轮或双指缩放",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.dataset.renderMode = "observation";
    this.spaceScene.name = "space-world";
    this.surfaceWorldScene.name = "planet-environment";
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.camera.position.set(0, 0.3, 3.9);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = 7;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.65;
    this.controls.addEventListener("start", () => {
      this.targetPosition = null;
    });
    this.spaceScene.add(this.planet);
    this.spaceScene.add(this.galaxySky.mesh);
    this.surfaceWorldScene.add(this.surfaceScene.group, this.surfaceScene.sky, this.explorerView.group);
    this.surfaceCelestialScene.add(this.surfaceGalaxySky.mesh, new THREE.AmbientLight(0x9dbde8, 0.09));
    this.observeSun.position.set(-3, 1.8, 4);
    this.flightRoot.visible = false;
    this.flightSun.visible = false;
    this.shipScene.add(
      this.ship.group,
      this.shipSun,
      this.shipAmbient,
      this.shipRim,
    );
    this.spaceScene.add(
      this.observeSun,
      this.flightSun,
      this.flightRoot,
      this.warpEffect.mesh,
      this.flightLight.mesh,
      new THREE.AmbientLight(0x9dbde8, 0.09),
    );
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.resize();
  }

  async selectBody(
    id: BodyId,
    onProgress: (percent: number) => void,
  ): Promise<boolean> {
    this.leaveFlight();
    const version = ++this.selectionVersion;
    await this.loadSpaceTextures();
    const maps =
      id === "earth" ? await this.loadEarthTextures(onProgress) : undefined;
    if (id !== "earth" && this.isLazyMap(id)) onProgress(40);
    const lazyMap = id !== "earth" ? await this.loadSurfaceMap(id) : null;
    if (this.destroyed || version !== this.selectionVersion) return false;
    let model = this.models.get(id);
    if (!model) {
      model =
        id === "earth"
          ? this.createEarthModel(maps!)
          : createPlanetModel(getBody(id), this.sunDirection, undefined, this.planetMaps.get(id) ?? lazyMap ?? undefined);
      this.models.set(id, model);
    } else if (lazyMap && model.mapUniforms?.detailMap.value !== lazyMap) setSurfaceMap(model, lazyMap, 1);
    this.mapFades.delete(model);
    this.planet.clear();
    this.planet.add(model.group);
    this.currentModel = model;
    this.publishSurfaceResolution(model);
    this.useSystemBackground(getBody(id).systemId ?? "solar");
    this.controls.minDistance = id === "gargantua" ? 6 : 1.25;
    this.controls.maxDistance = id === "gargantua" ? 50 : id === "echo-pulsar" ? 20 : id === "saturn" ? 12 : 7;
    this.targetPosition = null;
    this.controls.reset();
    this.camera.position.copy(this.viewPosition("overview"));
    this.controls.update();
    this.renderer.domElement.setAttribute(
      "aria-label",
      `交互式 3D ${model.body.name}：拖动旋转视角，滚轮或双指缩放`,
    );
    this.renderer.compile(this.spaceScene, this.camera);
    this.renderer.render(this.spaceScene, this.camera);
    onProgress(100);
    if (!this.frame) this.animate(0);
    return true;
  }

  private publishSurfaceResolution(model: PlanetModel) {
    const texture = model.mapUniforms?.detailMap.value;
    if (texture) {
      this.renderer.domElement.dataset.surfaceMap = texture.name;
      this.renderer.domElement.dataset.surfaceResolution = `${texture.image.width}x${texture.image.height}`;
    } else {
      delete this.renderer.domElement.dataset.surfaceMap;
      delete this.renderer.domElement.dataset.surfaceResolution;
    }
  }

  private loadSpaceTextures(): Promise<void> {
    if (this.galaxy) return Promise.resolve();
    if (this.spacePromise) return this.spacePromise;
    const ids = (Object.keys(SURFACE_MAPS) as BodyId[]).filter(id => SURFACE_MAPS[id]!.core);
    const skyFiles = [this.galaxyFile];
    const files = [...skyFiles, ...ids.map((id) => SURFACE_MAPS[id]!.file)];
    const batch: THREE.Texture[] = [];
    let failed = false;
    this.spacePromise = Promise.all(files.map(async (file, index) => {
      const texture = await this.loadTexture(file, index >= skyFiles.length);
      if (this.destroyed || failed) { texture.dispose(); throw new Error("场景已关闭或贴图加载失败"); }
      batch.push(texture);
      return texture;
    })).then((maps) => {
      maps.forEach((map) => this.textures.add(map));
      for (const system of STAR_SYSTEMS) {
        const texture = maps[0];
        this.backgrounds.set(system.id as SystemId, texture);
      }
      this.galaxy = this.backgrounds.get("solar");
      this.useSystemBackground("solar");
      // Both render modes reuse the resident panorama; entering a planet never requests or rebuilds it.
      this.surfaceGalaxySky.setTexture(this.galaxy ?? null);
      ids.forEach((id, i) => this.planetMaps.set(id, maps[i + skyFiles.length]));
    }).catch((error) => {
      failed = true;
      batch.forEach((texture) => texture.dispose());
      throw error;
    }).finally(() => { this.spacePromise = undefined; });
    return this.spacePromise;
  }

  private static softwareRendering() {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const name = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return /swiftshader|llvmpipe|software/i.test(name);
    } catch {
      return false;
    }
  }

  /** Decoded before upload so large maps don't stall a frame; surface maps wrap in longitude. */
  private async loadTexture(file: string, surface: boolean) {
    const surfaceMap = surface ? Object.values(SURFACE_MAPS).find(map => map?.file === file) : undefined;
    if (surfaceMap?.compactFile && (this.compactTextures || this.renderer.capabilities.maxTextureSize < surfaceMap.width)) {
      file = surfaceMap.compactFile;
    }
    const loader = new THREE.TextureLoader();
    let texture: THREE.Texture;
    try {
      texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${file}`);
    } catch (error) {
      if (!surfaceMap?.compactFile || file === surfaceMap.compactFile || this.destroyed) throw error;
      // Optional native 8K imagery can fail without replacing the complete 4K surface with noise.
      await this.waitForSpaceWork(file);
      if (this.destroyed) throw error;
      file = surfaceMap.compactFile;
      texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${file}`);
    }
    await this.waitForSpaceWork(file);
    if (this.destroyed) { texture.dispose(); throw new Error("场景已关闭"); }
    const image = texture.image as HTMLImageElement;
    await image.decode?.().catch(() => undefined);
    await this.waitForSpaceWork(file);
    if (this.destroyed) { texture.dispose(); throw new Error("场景已关闭"); }
    const maximumWidth = Math.min(this.renderer.capabilities.maxTextureSize,
      surface && this.compactTextures && !surfaceMap?.compactFile ? 2048 : Infinity);
    if (image.width > maximumWidth) {
      // Respect GPU limits; ordinary compact surfaces keep their existing low-memory 2K copies.
      const canvas = document.createElement("canvas");
      canvas.width = maximumWidth;
      canvas.height = Math.max(1, Math.round(maximumWidth * image.height / image.width));
      const context = canvas.getContext("2d")!;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.image = canvas;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = file;
    texture.anisotropy = surface ? this.surfaceAnisotropy : Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    if (surface) texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  /** Only the current globe's original base image may finish loading locally. */
  private async waitForSpaceWork(file?: string) {
    while (!this.destroyed && this.flying && !this.inStation && this.renderPolicy.mode === "surface") {
      const map = SURFACE_MAPS[this.dynamics!.environment.body.id];
      if (file && (file === map?.file || file === map?.compactFile)) return;
      await new Promise<void>(resolve => this.spaceWorkWaiters.add(resolve));
    }
  }

  private resumeSpaceWork() {
    this.spaceWorkWaiters.forEach(resolve => resolve());
    this.spaceWorkWaiters.clear();
  }

  private isLazyMap(id: BodyId) {
    const surfaceMap = SURFACE_MAPS[id];
    return !!surfaceMap && !surfaceMap.core;
  }

  /** Marks a body's map as in use and starts loading it if it isn't resident. */
  private touchSurfaceMap(id: BodyId) {
    if (this.flying && this.renderPolicy.mode === "surface" && id !== this.dynamics!.environment.body.id) return;
    const surfaceMap = SURFACE_MAPS[id];
    if (!surfaceMap || surfaceMap.core) return;
    const now = performance.now();
    const file = surfaceMap.file;
    let entry = this.lazyMaps.get(file);
    if (!entry) this.lazyMaps.set(file, entry = { used: now });
    entry.used = now;
    if (entry.texture || entry.loading || (entry.failedAt && now - entry.failedAt < 20000)) return;
    const loading = entry;
    loading.loading = this.loadTexture(file, true).then((texture) => {
      if (this.destroyed || this.lazyMaps.get(file) !== loading) { texture.dispose(); return; }
      loading.texture = texture;
      this.textures.add(texture);
      this.pendingSurfaceMaps.add(file);
      this.flightFrameDirty = true;
      if (!this.flying || this.renderPolicy.mode === "space") this.applyPendingSurfaceMaps();
    }).catch((error) => {
      loading.failedAt = performance.now();
      console.warn(`Surface map ${file} unavailable; keeping the procedural surface.`, error);
    }).finally(() => { loading.loading = undefined; });
  }

  private applyPendingSurfaceMaps() {
    for (const file of this.pendingSurfaceMaps) {
      const texture = this.lazyMaps.get(file)?.texture;
      if (!texture) continue;
      this.renderer.initTexture(texture);
      this.renderBudget.hold(0.75);
      for (const model of this.allModels())
        if (model.surfaceMap?.file === file && model.mapUniforms?.detailMap.value !== texture) {
          const immediate = !this.flying && model === this.currentModel;
          setSurfaceMap(model, texture, immediate ? 1 : 0);
          if (immediate) this.publishSurfaceResolution(model);
          if (!immediate) this.mapFades.add(model);
        }
    }
    this.pendingSurfaceMaps.clear();
    this.releaseSurfaceMaps();
  }

  private async loadSurfaceMap(id: BodyId): Promise<THREE.Texture | null> {
    if (!this.isLazyMap(id)) return null;
    this.touchSurfaceMap(id);
    const entry = this.lazyMaps.get(SURFACE_MAPS[id]!.file);
    await entry?.loading;
    return entry?.texture ?? null;
  }

  private allModels() {
    return [...this.flightModels, ...this.models.values()];
  }

  /** Keeps GPU memory bounded: the least recently seen maps return to their procedural fallback. */
  private releaseSurfaceMaps() {
    const limit = this.compactTextures ? 3 : 6;
    const now = performance.now();
    const resident = [...this.lazyMaps].filter(([, entry]) => entry.texture).sort((a, b) => a[1].used - b[1].used);
    for (const [file, entry] of resident) {
      if (resident.filter(([, item]) => item.texture).length <= limit || now - entry.used < 8000) break;
      for (const model of this.allModels())
        if (model.surfaceMap?.file === file) {
          setSurfaceMap(model, null, 0);
          this.mapFades.delete(model);
          if (!this.flying && model === this.currentModel) this.publishSurfaceResolution(model);
        }
      this.textures.delete(entry.texture!);
      entry.texture!.dispose();
      entry.texture = undefined;
      this.lazyMaps.delete(file);
    }
  }

  private updateSurfaceMaps(delta: number, time: number) {
    if (this.pendingSurfaceMaps.size) this.applyPendingSurfaceMaps();
    for (const model of this.mapFades) {
      const ready = model.mapUniforms!.mapReady;
      if (ready.value < 1) this.flightFrameDirty = true;
      ready.value = Math.min(1, ready.value + delta / 0.7);
      if (ready.value >= 1) this.mapFades.delete(model);
    }
    if (!this.flying && this.currentModel) this.touchSurfaceMap(this.currentModel.body.id);
    if (time - this.mapCheck > 3000) {
      this.mapCheck = time;
      this.releaseSurfaceMaps();
    }
  }

  private useSystemBackground(id: SystemId) {
    const system = STAR_SYSTEMS.find(item => item.id === id)!;
    const texture = this.backgrounds.get(id) ?? null;
    const sky = this.flying && this.renderPolicy.mode === "surface" ? this.surfaceGalaxySky : this.galaxySky;
    if (sky.mesh.material.uniforms.skyMap.value !== texture) {
      sky.setTexture(texture);
    }
    const variant = id === "black-hole" ? "black-hole" : id === "echo-rift" ? "echo-rift" : "milky-way";
    sky.setView(system.backgroundRotation, system.backgroundIntensity,
      this.flying ? this.surfaceScene.spaceVisibility : 1, this.starsEnabled,
      variant);
    // The sky bends its own sampling rays around the same world-space shadow
    // that the disk renderer uses, in both observation and ship-relative flight.
    const blackHole = id === "black-hole"
      ? this.flying ? this.flightModelById.get("gargantua") : this.currentModel
      : undefined;
    sky.setBlackHoleLens(blackHole?.body.kind === "black-hole" && blackHole.group.visible
      ? blackHole.group : null);
    this.renderer.domElement.dataset.backgroundVariant = variant;
    this.backgroundSystem = id;
    if (this.renderer.domElement.dataset.system !== id) this.renderer.domElement.dataset.system = id;
    if (this.renderer.domElement.dataset.background !== this.galaxyFile) {
      this.renderer.domElement.dataset.background = this.galaxyFile;
      this.renderer.domElement.dataset.backgroundResolution = this.galaxyFile.includes("8k") ? "8192x4096" : "4096x2048";
      this.renderer.domElement.dataset.backgroundSampling = "direct-equirectangular";
    }
  }

  private loadEarthTextures(
    onProgress: (percent: number) => void,
  ): Promise<THREE.Texture[]> {
    if (this.earthMaps) return Promise.resolve(this.earthMaps);
    if (this.earthPromise) return this.earthPromise;
    const files = ["earth-day.jpg", "earth-night.jpg", "earth-terrain-4k.png", "earth-clouds-4k.jpg"];
    let loaded = 0;
    const batch: THREE.Texture[] = [];
    let failed = false;
    this.earthPromise = Promise.all(
      files.map(async (file) => {
        const texture = await this.loadEarthMap(file, file !== "earth-day.jpg");
        if (this.destroyed || failed) {
          this.releaseEarthMap(texture);
          throw new Error("场景已关闭");
        }
        this.textures.add(texture);
        batch.push(texture);
        onProgress(Math.round((++loaded / files.length) * 100));
        return texture;
      }),
    )
      .then((maps) => {
        maps[0].colorSpace = THREE.SRGBColorSpace;
        this.earthMaps = maps;
        return maps;
      })
      .catch((error) => {
        failed = true;
        batch.forEach((texture) => {
          this.textures.delete(texture);
          texture.dispose();
        });
        throw error;
      })
      .finally(() => {
        this.earthPromise = undefined;
      });
    return this.earthPromise;
  }

  private releaseEarthMap(texture: THREE.Texture) {
    this.textures.delete(texture);
    texture.dispose();
  }

  private async loadEarthMap(file: string, monochrome = false): Promise<THREE.Texture> {
    let texture = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/${file}`);
    await this.waitForSpaceWork(file);
    if (this.destroyed) { texture.dispose(); throw new Error("场景已关闭"); }
    const image = texture.image as HTMLImageElement;
    await image.decode?.().catch(() => undefined);
    await this.waitForSpaceWork(file);
    if (this.destroyed) { texture.dispose(); throw new Error("场景已关闭"); }
    if (monochrome) {
      // One-byte density/elevation/radiance maps use one quarter of RGBA texture memory.
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, image.width, image.height).data;
      const data = new Uint8Array(image.width * image.height);
      // Typed-array uploads are bottom-up, unlike the source image's north-to-south rows.
      for (let y = 0; y < image.height; y++) {
        const source = (image.height - 1 - y) * image.width * 4;
        for (let x = 0; x < image.width; x++) data[y * image.width + x] = rgba[source + x * 4];
      }
      texture.dispose();
      canvas.width = canvas.height = 1;
      texture = new THREE.DataTexture(data, image.width, image.height, THREE.RedFormat);
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
    } else texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = this.surfaceAnisotropy;
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private updateEarthDetail(delta: number, time: number) {
    const model = this.flying ? this.flightModels.find(model => model.body.id === "earth") : this.models.get("earth");
    const active = !!model && (this.flying ? model.group.visible && this.dynamics?.systemId === "solar" : this.currentModel === model);
    const capable = !this.compactTextures && this.renderer.capabilities.maxTextureSize >= 8192
      && (this.renderer.domElement.dataset.softwareRenderer !== "true" || this.quality === "ultra");
    for (const [earth, detail] of this.earthDetails) {
      const blend = detail.uniforms.detailBlend.value as THREE.Vector4;
      const previousBlend = blend.clone();
      const current = earth === model && active;
      detail.update(current ? earth.surface : undefined, this.camera,
        current && capable && this.earthUpgraded && this.quality === "ultra", delta, time);
      // A paused view still redraws resident detail as it arrives and fades in.
      if (!blend.equals(previousBlend)) this.flightFrameDirty = true;
    }
    if (!active || !capable || this.quality === "standard" || this.earthUpgraded || this.earthUpgrade || time < this.earthUpgradeAt) return;
    const batch: THREE.Texture[] = [];
    this.earthUpgrade = (async () => {
      // Stagger decoding and uploads; one large map at a time avoids a burst of frame stalls.
      for (const file of ["earth-day-8k.jpg", "earth-night-8k.jpg", "earth-terrain-8k.png", "earth-clouds-8k.jpg"]) {
        await this.waitForSpaceWork(file);
        if (this.destroyed) throw new Error("场景已关闭");
        const texture = await this.loadEarthMap(file, file !== "earth-day-8k.jpg");
        batch.push(texture);
        await this.waitForSpaceWork(file);
        if (this.destroyed) throw new Error("场景已关闭");
        this.renderBudget.hold(1.5);
        this.renderer.initTexture(texture);
      }
      if (this.destroyed) throw new Error("场景已关闭");
      this.earthHighMaps = batch;
      for (const earth of this.earthDetails.keys()) this.applyEarthMaps(earth, batch);
      this.earthUpgraded = true;
      this.renderer.domElement.dataset.earthMaps = "8k";
    })().catch(() => {
      batch.forEach(texture => this.releaseEarthMap(texture));
      this.earthUpgradeAt = performance.now() + 30_000;
    }).finally(() => { this.earthUpgrade = undefined; });
  }

  private applyEarthMaps(model: PlanetModel, maps: THREE.Texture[]) {
    this.flightFrameDirty = true;
    const uniforms = (model.surface.material as THREE.ShaderMaterial).uniforms;
    for (const [i, name, size] of [[0, "dayMap", "mapSize"], [1, "nightMap", "nightSize"],
      [2, "terrainMap", "terrainSize"], [3, "cloudMap", "cloudSize"]] as const) {
      uniforms[name].value = maps[i];
      uniforms[size].value.set(maps[i].image.width, maps[i].image.height);
    }
    const cloudUniforms = ((model.layers.clouds as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
    cloudUniforms.cloudMap.value = maps[3];
    cloudUniforms.mapSize.value.set(maps[3].image.width, maps[3].image.height);
  }

  private createEarthModel(
    maps: THREE.Texture[],
    sunDirection = this.sunDirection,
  ): PlanetModel {
    maps = this.earthHighMaps ?? maps;
    maps[0].colorSpace = THREE.SRGBColorSpace;
    const group = new THREE.Group();
    group.rotation.z = THREE.MathUtils.degToRad(EARTH.axialTiltDeg);
    const compactMesh = this.compactTextures || this.renderer.domElement.dataset.softwareRenderer === "true";
    const geometry = new THREE.SphereGeometry(1, compactMesh ? 256 : 512, compactMesh ? 128 : 256);
    const detail = new EarthDetail(maps[0], file => this.loadEarthMap(file),
      texture => this.releaseEarthMap(texture), texture => {
        this.renderBudget.hold(1.5);
        this.renderer.initTexture(texture);
        this.flightFrameDirty = true;
      }, this.renderer.domElement);
    const surface = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: earthSurfaceVertex,
        fragmentShader: surfaceFragment,
        uniforms: {
          dayMap: { value: maps[0] },
          nightMap: { value: maps[1] },
          terrainMap: { value: maps[2] },
          cloudMap: { value: maps[3] },
          ...detail.uniforms,
          terrainSize: { value: new THREE.Vector2(maps[2].image.width, maps[2].image.height) },
          nightSize: { value: new THREE.Vector2(maps[1].image.width, maps[1].image.height) },
          cloudSize: { value: new THREE.Vector2(maps[3].image.width, maps[3].image.height) },
          mapSize: { value: new THREE.Vector2(maps[0].image.width, maps[0].image.height) },
          cloudsEnabled: { value: 1 },
          cloudOffset: { value: 0 },
          flatClouds: { value: 0 },
          terrainDetail: { value: 1 },
          elevationStrength: { value: 1 },
          sunDirection: { value: sunDirection },
        },
      }),
    );
    surface.rotation.y = -1.8;
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.0018, 256, 128),
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: earthCloudFragment,
        uniforms: {
          cloudMap: { value: maps[3] },
          mapSize: { value: new THREE.Vector2(maps[3].image.width, maps[3].image.height) },
          sunDirection: { value: sunDirection },
        },
        transparent: true,
        depthWrite: false,
      }),
    );
    clouds.rotation.y = surface.rotation.y;
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1 + EARTH.atmosphereKm! / EARTH.radiusKm, 128, 96),
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: atmosphereFragment,
        uniforms: { sunDirection: { value: sunDirection },
          planetCenter: { value: group.position }, bodyRadius: { value: 1 },
          atmosphereColor: { value: new THREE.Color(surfaceProfile("earth").sky) },
          atmosphereHeight: { value: EARTH.atmosphereKm! / EARTH.radiusKm }, strength: { value: atmosphereStrength("earth") }, uTime: { value: 0 } },
        side: THREE.FrontSide,
        blending: THREE.NormalBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    group.add(surface, clouds, atmosphere);
    this.renderer.domElement.dataset.earthMaps = this.earthHighMaps ? "8k" : "4k";
    this.renderer.domElement.dataset.earthMesh = `${geometry.parameters.widthSegments}x${geometry.parameters.heightSegments}`;
    const model: PlanetModel = {
      body: EARTH,
      group,
      surface,
      layers: { clouds, atmosphere },
      spinning: [
        { object: surface, rate: 0.025 },
        { object: clouds, rate: 0.029 },
      ],
      timeUniforms: [],
    };
    this.earthDetails.set(model, detail);
    return model;
  }

  private updateCloudShadow(model: PlanetModel) {
    if (model.body.id !== "earth") return;
    const uniforms = (model.surface.material as THREE.ShaderMaterial).uniforms;
    const clouds = model.layers.clouds!;
    const turns = (model.surface.rotation.y-clouds.rotation.y)/(Math.PI*2);
    uniforms.cloudOffset.value = turns - Math.floor(turns);
    uniforms.cloudsEnabled.value = Number(clouds.visible || uniforms.flatClouds.value>0);
  }
  private readonly resize = () => {
    if (this.destroyed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.flightWidth = width;
    this.flightHeight = height;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.stationInterior?.resize(width, height);
    this.configureRenderBudget();
  };

  private configureRenderBudget() {
    this.renderBudget.configure(this.quality, window.devicePixelRatio, this.flightWidth, this.flightHeight, this.minimumRenderRatio);
    this.applyRenderBudget();
  }
  private applyRenderBudget() {
    this.renderer.setPixelRatio(this.renderBudget.ratio);
    this.flightFrameDirty = true;
    this.renderer.domElement.dataset.renderScale = this.renderBudget.ratio.toFixed(2);
  }

  /** Chase smoothing can approach its final pose indefinitely; subpixel changes need no new paused frame. */
  private flightCameraQuiet() {
    const positionTolerance = Math.max(1e-14, this.camera.position.lengthSq() * 1e-8);
    return this.camera.position.distanceToSquared(this.drawnCameraPosition) <= positionTolerance
      && 1 - Math.abs(this.camera.quaternion.dot(this.drawnCameraQuaternion)) <= 1e-9
      && Math.abs(this.camera.fov - this.drawnCameraFov) <= 0.001;
  }

  private recordFlightRender() {
    this.flightFrameDirty = false;
    this.drawnCameraPosition.copy(this.camera.position);
    this.drawnCameraQuaternion.copy(this.camera.quaternion);
    this.drawnCameraFov = this.camera.fov;
    this.renderer.domElement.dataset.worldRenderCount = String(++this.worldRenderCount);
  }

  private renderFlightWorld() {
    if (this.bridgeView) {
      // Draw the actual orbital world, then let the local hull and glazing
      // occlude it. Celestial resources stay owned by the outer space scene.
      const autoClear = this.renderer.autoClear;
      try {
        this.renderer.render(this.spaceScene, this.camera);
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.stationInterior!.scene, this.stationInterior!.camera);
      } finally {
        this.renderer.autoClear = autoClear;
      }
      return;
    }
    if (this.renderPolicy.mode === "space") {
      this.renderer.render(this.spaceScene, this.camera);
      return;
    }
    // Keep astronomical distances in universe units, then let metre-scale
    // terrain and the atmospheric overlay occlude the distant sky.
    this.renderer.render(this.surfaceCelestialScene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.surfaceWorldScene, this.localRenderCamera);
    this.renderer.autoClear = true;
  }

  setPhotoMode(active: boolean) {
    this.explorerView.setPhotoMode(active);
    this.resize();
    this.flightFrameDirty = true;
  }

  /** Read the freshly rendered frame before WebGL releases its drawing buffer. */
  capturePhoto(): Promise<Blob> {
    if (this.destroyed || (!this.currentModel && !this.flying))
      return Promise.reject(new Error("场景尚未就绪，请稍后拍照"));
    if (this.hidden || this.renderer.getContext().isContextLost())
      return Promise.reject(new Error("请回到可用的游戏画面后拍照"));
    if (this.photoCapture) return Promise.reject(new Error("正在生成照片，请稍后再试"));
    this.flightFrameDirty = true;
    return new Promise((resolve, reject) => {
      this.photoCapture = { resolve, reject };
      if (!this.frame) this.animate(0);
    });
  }

  private finishPhotoCapture() {
    const capture = this.photoCapture;
    if (!capture) return;
    this.photoCapture = undefined;
    try {
      this.renderer.domElement.toBlob(blob => {
        if (blob) capture.resolve(blob);
        else capture.reject(new Error("照片生成失败，请重试"));
      }, "image/png");
    } catch {
      capture.reject(new Error("照片生成失败，请重试"));
    }
  }

  private readonly animate = (time: number) => {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(this.animate);
    if (this.hidden) return;
    const delta = this.lastTime
      ? Math.min((time - this.lastTime) / 1000, 0.25)
      : 0;
    this.lastTime = time;
    // Adapt resolution only while the picture moves; a paused, still view is restored to full sharpness.
    const moved = !this.camera.position.equals(this.lastCameraPosition) || !this.camera.quaternion.equals(this.lastCameraQuaternion);
    this.lastCameraPosition.copy(this.camera.position);
    this.lastCameraQuaternion.copy(this.camera.quaternion);
    const animating = this.flying ? !this.flightPaused : !this.paused || moved || !!this.targetPosition;
    this.stillSeconds = animating ? 0 : this.stillSeconds + delta;
    if (animating ? this.renderBudget.sample(delta) : this.stillSeconds > 0.4 && this.renderBudget.rest()) this.applyRenderBudget();
    if (this.flying) {
      this.animateFlight(delta, time);
      if (this.inStation || this.renderPolicy.mode === "space") {
        this.updateSurfaceMaps(delta, time);
        this.updateEarthDetail(delta, time);
      }
      const reuseFrame = this.flightPaused && (this.bridgeView || this.renderPolicy.mode === "surface")
        && this.stillSeconds > 0.4 && !this.flightFrameDirty && this.flightCameraQuiet();
      this.renderer.domElement.dataset.surfaceFrameIdle = String(reuseFrame);
      // RAF, controls, tracking and HUD continue above; retain the last canvas frame instead of repeating GPU work.
      if (reuseFrame) return;
      this.renderFlightWorld();
      this.recordFlightRender();
      if (this.ship.group.visible || this.starshipHull?.visible) {
        // The hull pass uses the same physical scale as the world camera.
        const camera = this.shipCamera;
        if (camera.aspect !== this.camera.aspect || camera.fov !== this.camera.fov) {
          camera.aspect = this.camera.aspect;
          camera.fov = this.camera.fov;
          camera.updateProjectionMatrix();
        }
        camera.position.copy(this.camera.position).multiplyScalar(1 / this.renderedShipScale);
        camera.quaternion.copy(this.camera.quaternion);
        this.shipSun.position.copy(this.flightSun.position).normalize().multiplyScalar(10);
        this.shipSun.intensity = 2.8 * this.flightLight.illumination;
        // Sky bounce only grows near an atmosphere; vacuum keeps directional contrast.
        const atmosphereBounce = this.surfaceScene.usesAtmosphere(this.dynamics!) ? 1 : 0;
        this.shipRim.position.copy(this.shipSun.position).multiplyScalar(-1);
        this.shipRim.intensity = (0.06 + atmosphereBounce * 0.18) * this.flightLight.illumination;
        this.shipAmbient.intensity = 0.055 + this.flightLight.illumination * (0.17 + atmosphereBounce * 0.35);
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.shipScene, camera);
        this.renderer.autoClear = true;
      }
      this.finishPhotoCapture();
      return;
    }
    this.updateSurfaceMaps(delta, time);
    if (!this.paused && this.currentModel) {
      for (const { object, rate } of this.currentModel.spinning)
        object.rotation.y += delta * rate * this.speed;
      this.updateCloudShadow(this.currentModel);
      for (const uniform of this.currentModel.timeUniforms)
        uniform.value += delta * this.speed;
    }
    if (this.targetPosition) {
      // Interpolate around the globe, keeping radius outside the surface even for opposite views.
      const step = 1 - Math.exp(-delta * 5);
      const direction = this.camera.position.clone().normalize();
      const targetDirection = this.targetPosition.clone().normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        direction,
        targetDirection,
      );
      const partialRotation = new THREE.Quaternion().slerp(rotation, step);
      const radius = THREE.MathUtils.lerp(
        this.camera.position.length(),
        this.targetPosition.length(),
        step,
      );
      this.camera.position.copy(
        direction.applyQuaternion(partialRotation).multiplyScalar(radius),
      );
      if (this.camera.position.distanceTo(this.targetPosition) < 0.005)
        this.targetPosition = null;
    }
    this.controls.update();
    this.updateEarthDetail(delta, time);
    this.renderer.render(this.spaceScene, this.camera);
    this.finishPhotoCapture();
    this.frames++;
    if (!this.metricsStart) this.metricsStart = time;
    if (time - this.metricsStart > 750) {
      this.onStats({
        altitudeKm:
          (this.camera.position.length() - 1) *
          (this.currentModel?.body.radiusKm ?? EARTH.radiusKm),
        fps: Math.round((this.frames * 1000) / (time - this.metricsStart)),
      });
      this.metricsStart = time;
      this.frames = 0;
    }
  };

  async enterFlight(
    id: BodyId,
    config: WorldConfig,
    onProgress: (percent: number) => void,
    placement?: SurfacePlacement,
  ): Promise<boolean> {
    const version = ++this.selectionVersion;
    await initializeWalkingPhysics();
    if (this.destroyed || version !== this.selectionVersion) return false;
    const dynamics = new ShipDynamics(config);
    const walker = new WalkingDynamics(config);
    if (placement) {
      if (placement.kind !== "ship" && placement.kind !== "person")
        throw new Error("放置类型无效，请重新选择");
      const error = dynamics.placeOnSurface(id, placement.normal);
      if (error) throw new Error(error);
    } else dynamics.jump(id);
    await this.loadSpaceTextures();
    await this.loadEarthTextures(onProgress);
    if (placement) await this.loadSurfaceMap(id);
    if (this.destroyed || version !== this.selectionVersion) return false;
    if (!this.asteroidBelt) {
      this.asteroidBelt = createAsteroidBelt(config.unitsKm, config.auKm);
      this.flightRoot.add(this.asteroidBelt);
    }
    // Allocate WASM objects only after asynchronous loading has been accepted.
    // Cancelled selections and failed texture loads never own a physics world.
    try {
      if (placement?.kind === "person") {
        const walkingError = walker.disembark(dynamics);
        if (walkingError) throw new Error(walkingError);
      }
    } catch (error) {
      walker.reset();
      throw error;
    }
    this.walker?.reset();
    this.stationInterior?.leave();
    this.dynamics = dynamics;
    this.walker = walker;
    if (placement && id === "venus") {
      // Direct placement uses the initial photographic frame even after a previous flight's cloud drift.
      this.flightModelById.get(id)?.layers.clouds?.quaternion.identity();
    }
    this.explorerCamera = "third";
    this.shipScale = dynamics.scale.kilometresToUniverseDistance(SHIP_LENGTH_KM) / this.ship.hullLength;
    this.renderer.domElement.dataset.shipLengthKm = String(SHIP_LENGTH_KM);
    this.flightBoost = 0;
    this.flightMetrics = 0;
    this.flightPaused = false;
    this.flying = true;
    this.flightFrameDirty = true;
    this.renderPolicy.reset();
    this.planet.visible = false;
    this.flightRoot.visible = true;
    this.observeSun.visible = false;
    this.flightSun.visible = true;
    this.controls.enabled = false;
    this.targetPosition = null;
    this.camera.fov = 58;
    this.camera.near = walker.active ? dynamics.scale.metresToUniverseDistance(0.03) : 1e-8;
    this.camera.far = 2e6;
    this.camera.updateProjectionMatrix();
    this.starsEnabled = true;
    this.useSystemBackground(this.dynamics!.systemId);
    this.flightControls?.dispose();
    this.flightControls = new FlightControls(this.renderer.domElement);
    this.flightControls.setWalking(walker.active);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "自由驾驶飞船：W/S 推力，方向键或触屏拖动转向，空格刹车",
    );
    this.updateFlightCamera(1);
    const scene = this.renderPolicy.mode === "surface" ? this.surfaceWorldScene : this.spaceScene;
    const renderCamera = this.renderPolicy.mode === "surface" ? this.localRenderCamera : this.camera;
    this.renderer.compile(scene, renderCamera);
    this.renderFlightWorld();
    this.recordFlightRender();
    onProgress(100);
    if (!this.frame) this.animate(0);
    return true;
  }
  /** Bodies acquire GPU meshes only after growing large enough to be visible in the space renderer. */
  private createFlightModel(body: WorldConfig["bodies"][number]): PlanetModel {
    const config = this.dynamics!.config;
    const center = new THREE.Vector3().fromArray(body.position);
    const hostId = body.hostStarId ?? systemConfig(config, bodySystem(body)).primaryStar;
    const host = config.bodies.find(candidate => candidate.id === hostId)!;
    const light = body.kind === "star" ? this.sunDirection
      : new THREE.Vector3().fromArray(host.position).sub(center).normalize();
    const model =
      body.id === "earth"
        ? this.createEarthModel(this.earthMaps!, light)
        : createPlanetModel(getBody(body.id), light, {
            center,
            radius: body.radius,
          }, this.planetMaps.get(body.id) ?? this.lazyMaps.get(SURFACE_MAPS[body.id]?.file ?? "")?.texture);
    const solarAngularRadius = Math.asin(Math.min(1, host.radius / center.distanceTo(new THREE.Vector3().fromArray(host.position))));
    const spheres: THREE.Mesh[] = [];
    model.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial
        && object.material.uniforms.solarAngularRadius) object.material.uniforms.solarAngularRadius.value = solarAngularRadius;
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.SphereGeometry) {
        const radius = object.geometry.parameters.radius;
        object.geometry.scale(1/radius,1/radius,1/radius);
        object.scale.multiplyScalar(radius);
        this.flightGeometries.set(object,object.geometry);
        spheres.push(object);
      }
      if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial && object.material.uniforms.planetCenter)
        object.material.uniforms.planetCenter.value = model.group.position;
    });
    model.group.position.copy(center);
    model.group.scale.setScalar(body.radius);
    // Collision uses the mean-radius sphere. Match rocky flight surfaces to it.
    if (body.id !== "sun" && !["jupiter", "saturn", "uranus", "neptune", "veyl"].includes(body.id)) {
      model.surface.scale.y = 1;
      model.layers.atmosphere?.traverse(object => { if (object instanceof THREE.Mesh) object.scale.y = object.scale.x; });
    }
    this.flightSpheres.set(model,spheres);
    this.flightRoot.add(model.group);
    this.flightModels.push(model);
    this.flightModelById.set(body.id, model);
    this.renderer.domElement.dataset.spaceModels = String(this.flightModels.length);
    return model;
  }

  leaveFlight() {
    ++this.selectionVersion;
    if (!this.flying) return;
    this.flying = false;
    this.walker?.reset();
    this.stationInterior?.leave();
    this.explorerView.group.visible = false;
    this.flightFrameDirty = true;
    this.renderPolicy.reset();
    this.resumeSpaceWork();
    this.renderer.domElement.dataset.renderMode = "observation";
    this.renderer.domElement.dataset.spaceWorkActive = "true";
    this.renderer.domElement.dataset.surfaceFrameIdle = "false";
    this.flightControls?.dispose();
    this.flightControls = undefined;
    this.planet.visible = true;
    this.flightRoot.visible = false;
    this.observeSun.visible = true;
    this.surfaceScene.group.visible = false;
    this.surfaceScene.sky.visible = false;
    this.flightSun.visible = false;
    this.controls.enabled = true;
    this.warpEffect.mesh.visible = false;
    this.flightLight.mesh.visible = false;
    this.useSystemBackground(this.currentModel?.body.systemId ?? "solar");
    this.camera.near = 0.01;
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 40;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
  }
  setFlightHandler(handler: (stats: FlightStats) => void) {
    this.flightHandler = handler;
  }
  setFlightTargetHandler(handler: NonNullable<SolarScene["flightTargetHandler"]>) {
    this.flightTargetHandler = handler;
  }
  setFlightPaused(paused: boolean) {
    if (this.flightPaused !== paused) this.flightFrameDirty = true;
    this.flightPaused = paused;
    this.flightControls?.clear();
  }
  flightState(): FlightState | null {
    const state = this.dynamics?.snapshot();
    if (!state) return null;
    const stationVisit = this.stationInterior?.snapshot();
    if (stationVisit) return { ...state, stationVisit };
    const walking = this.walker?.snapshot();
    return walking ? { ...state, walking: { ...walking, camera: this.explorerCamera } } : state;
  }
  restoreFlight(state: unknown) {
    const restored = this.dynamics?.restore(state) ?? false;
    if (restored) {
      const saved = validateFlightState(state)!;
      this.stationInterior?.leave();
      if (saved.stationVisit) {
        this.getStationInterior().enter(saved.stationVisit);
        if (!saved.stationVisit.vessel) this.dynamics!.orientation.copy(this.stationSpaceRotation);
      }
      else this.resumeSpaceWork();
      this.walker?.restore(saved.walking, this.dynamics!);
      this.explorerCamera = saved.stationVisit?.camera ?? saved.walking?.camera ?? "third";
      this.flightControls?.setWalking(this.walking);
      this.flightControls?.clear();
      this.camera.near = this.walking ? this.dynamics!.scale.metresToUniverseDistance(0.03) : 1e-8;
      this.camera.updateProjectionMatrix();
      this.flightFrameDirty = true;
      this.updateFlightCamera(1);
    }
    return restored;
  }
  get aboardStarship() { return this.stationInterior?.active ?? false; }
  get pilotingStarship() { return this.aboardStarship && !!this.stationInterior?.piloting; }
  get inStation() { return this.aboardStarship && !this.pilotingStarship; }
  private get bridgeView() { return this.aboardStarship && (this.inStation || (this.dynamics?.camera === "cockpit" && !this.dynamics?.warping)); }
  get helmAvailable() { return this.inStation && this.stationInterior!.grounded && this.stationInterior!.distanceToHelmM <= 3; }
  get walking() { return this.inStation || (this.walker?.active ?? false); }
  get walkingCamera() { return this.explorerCamera; }
  setWalkingCamera(view: "first" | "third") {
    this.explorerCamera = view;
    if (this.inStation) this.stationInterior!.setCamera(view);
    this.flightFrameDirty = true;
    if (this.walking) this.updateFlightCamera(1);
  }
  walkFlight(): string | null {
    if (!this.dynamics || !this.walker) return "飞船尚未就绪";
    if (this.aboardStarship) {
      if (this.flightPaused) return "请先继续航行或探索";
      if (this.dynamics.warping) return "请等待跃迁结束，再离开驾驶座";
      if (this.pilotingStarship) {
        this.stationInterior!.releaseHelm();
        this.dynamics.angularVelocity.set(0, 0, 0);
      } else {
        if (!this.helmAvailable) return "请沿引导线走到驾驶室前窗的驾驶台，落地后在 3 米内按 E 接管星舰";
        this.stationInterior!.takeHelm();
        this.dynamics.camera = "cockpit";
      }
      this.flightControls?.setWalking(this.walking);
      this.flightControls?.clear();
      this.flightFrameDirty = true;
      this.updateFlightCamera(1);
      return null;
    }
    const error = this.walking ? this.walker.board(this.dynamics) : this.walker.disembark(this.dynamics);
    if (!error) {
      this.flightControls?.setWalking(this.walking);
      this.flightControls?.clear();
      this.flightFrameDirty = true;
      this.flightMetrics = 0;
      this.camera.near = this.walking ? this.dynamics.scale.metresToUniverseDistance(0.03) : 1e-8;
      this.camera.updateProjectionMatrix();
      this.updateFlightCamera(1);
    }
    return error;
  }
  setDestination(id: BodyId) {
    if (this.walking) return;
    if (this.dynamics && !this.dynamics.warping) this.dynamics.target = id;
    // Prefetch so the destination is already high resolution on arrival.
    this.touchSurfaceMap(id);
  }
  alignFlight() {
    if (this.walking) return;
    if (this.dynamics?.landingPhase !== "manual") return;
    this.flightFrameDirty = true;
    this.dynamics?.align();
    if (this.flying && this.dynamics) this.updateFlightCamera(1);
    this.flightControls?.clear();
  }
  jumpFlight(): string | null {
    if (!this.dynamics) return "飞船尚未就绪";
    if (this.walking) return "请先返回飞船，再启动跃迁";
    const error = this.dynamics.startWarp();
    if (!error) this.flightFrameDirty = true;
    this.flightControls?.clear();
    return error;
  }
  cancelWarp() {
    if (this.dynamics?.warping) this.flightFrameDirty = true;
    this.dynamics?.cancelWarp();
  }
  setFlightCruiseSpeed(kmps: number): string | null {
    if (this.walking) return "请先返回飞船，再设置航速";
    return this.dynamics?.setCruiseSpeed(kmps) ?? (this.dynamics ? null : "飞船尚未就绪");
  }
  setLowFlightSpeed(mps: number): string | null {
    if (this.walking) return "请先返回飞船，再设置航速";
    return this.dynamics?.setLowFlightSpeed(mps) ?? (this.dynamics ? null : "飞船尚未就绪");
  }
  landFlight(): string | null {
    if (this.inStation) return this.walkFlight();
    if (this.walking) return "请先返回飞船，再起飞";
    if (!this.dynamics) return "飞船尚未就绪";
    if (!this.aboardStarship && this.dynamics.target === "earth-station" && this.dynamics.landingPhase === "manual") return this.dockStation();
    this.flightControls?.clear();
    if (this.dynamics.landingPhase !== "manual" && this.dynamics.landingPhase !== "landed") {
      this.flightFrameDirty = true;
      this.dynamics.cancelLanding(); return null;
    }
    const error = this.dynamics.landingPhase === "landed" ? this.dynamics.takeOff() : this.dynamics.startLanding();
    if (!error) this.flightFrameDirty = true;
    return error;
  }
  private getStationInterior() {
    if (!this.stationInterior) this.stationInterior = new StationInterior();
    // Restoring a station checkpoint can follow a planetary surface visit.
    this.renderPolicy.reset();
    const config = this.dynamics!.config;
    this.stationSpaceOrigin.fromArray(config.bodies.find(body => body.id === "earth-station")!.position);
    // The observation glazing faces local +X. Preserve the world's planetary
    // axes and light by rotating only the observer, never the celestial models.
    const right = new THREE.Vector3().fromArray(config.bodies.find(body => body.id === "earth")!.position)
      .sub(this.stationSpaceOrigin).normalize();
    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(right).normalize();
    const back = new THREE.Vector3().crossVectors(right, up).normalize();
    this.stationSpaceRotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
    this.stationInterior.resize(this.flightWidth, this.flightHeight);
    return this.stationInterior;
  }
  get stationDockBlockReason(): string | null {
    const ship = this.dynamics;
    if (!ship) return "飞船尚未就绪";
    if (ship.systemId !== "solar") return "请先跃迁至地球空间站";
    if (ship.warpPhase !== "ready") return "请等待跃迁结束与引擎冷却，再停泊";
    if (ship.landingPhase !== "manual" || this.walking) return "请先返回飞船并离开地表";
    const station = ship.config.bodies.find(body => body.id === "earth-station")!;
    if (ship.position.distanceTo(new THREE.Vector3(...station.position)) > station.radius + 1800 / ship.config.unitsKm)
      return "请靠近空间站至 1800 km 内，或先按 J 跃迁至空间站";
    return null;
  }
  private dockStation(): string | null {
    const reason = this.stationDockBlockReason;
    if (reason) return reason;
    const ship = this.dynamics!;
    const station = ship.config.bodies.find(body => body.id === "earth-station")!;
    const center = new THREE.Vector3(...station.position);
    // The orbital hull is a fictional megastructure; its airlock opens a metre-scale interior.
    // Keep the parked ship outside the orbital collision sphere until the pilot returns.
    ship.position.copy(center).add(new THREE.Vector3(0, 0, station.radius + 200 / ship.config.unitsKm));
    ship.velocity.set(0, 0, 0);
    ship.angularVelocity.set(0, 0, 0);
    ship.bank = 0;
    ship.collision = null;
    ship.orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(center, ship.position, new THREE.Vector3(0, 1, 0)));
    this.getStationInterior().enter();
    ship.orientation.copy(this.stationSpaceRotation);
    this.explorerCamera = "first";
    this.flightControls?.setWalking(true);
    this.flightControls?.clear();
    this.flightFrameDirty = true;
    this.flightMetrics = 0;
    this.updateFlightCamera(1);
    return null;
  }
  setFlightCamera(view: "cockpit" | "chase") {
    if (this.walking) return;
    if (this.dynamics) {
      this.flightFrameDirty = true;
      this.dynamics.camera = view;
      this.updateFlightCamera(1);
    }
  }
  setFlightAssist(assist: boolean) {
    if (this.dynamics && !this.walking) this.dynamics.assist = assist;
  }
  private updateSpaceWorld(surface = false) {
    const ship = this.dynamics!;
    const environment = ship.environment;
    // This ray renderer owns just one geometry/material. Release it when its
    // system leaves the active flight; a later return creates fresh resources.
    for (const model of [...this.flightModels]) {
      if (model.body.kind !== "black-hole" || model.body.systemId === ship.systemId) continue;
      model.group.removeFromParent();
      model.surface.geometry.dispose();
      const materials = Array.isArray(model.surface.material) ? model.surface.material : [model.surface.material];
      materials.forEach(material => material.dispose());
      this.flightSpheres.delete(model);
      this.flightModelById.delete(model.body.id);
      this.flightModels.splice(this.flightModels.indexOf(model), 1);
    }
    this.renderer.domElement.dataset.blackHoleResources = String(this.flightModels.some(model => model.body.kind === "black-hole"));
    if (!surface) this.renderer.domElement.dataset.spaceUpdates = String(++this.spaceUpdates);
    const pixelsPerRadian = this.flightHeight * this.renderer.getPixelRatio()
      / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    if (!surface && this.asteroidBelt) {
      this.asteroidBelt.visible = ship.systemId === "solar";
      this.asteroidBelt.position.copy(ship.position).negate();
      this.container.dataset.asteroidBelt = String(this.asteroidBelt.visible);
    }
    // CPU positions remain in double precision. GPU objects are relative to the ship.
    for (const model of this.flightModels) model.group.visible = false;
    const stars = ship.activeBodies.filter(body => body.kind === "star" || body.kind === "black-hole");
    const localStar = stars.reduce((closest, body) =>
      this.flightRelative.fromArray(body.position).distanceToSquared(ship.position)
        < this.flightForward.fromArray(closest.position).distanceToSquared(ship.position) ? body : closest);
    const celestialBodies: string[] = [];
    for (const body of ship.activeBodies) {
      // The local deck replaces the surrounding megastructure while inside it.
      if (this.aboardStarship && body.id === "earth-station") continue;
      if (surface && (body.id === environment.body.id || body.id === localStar.id)) continue;
      this.flightRelative.fromArray(body.position).sub(ship.position);
      const observerDistance = this.inStation
        ? this.flightRelative.distanceTo(this.camera.position) : this.flightRelative.length();
      const angularRadius = body.radius / Math.max(observerDistance, 1e-9);
      const pixelRadius = angularRadius * pixelsPerRadian;
      if (pixelRadius <= 0.65) continue;
      const model = this.flightModelById.get(body.id) ?? this.createFlightModel(body);
      const parent = surface ? this.surfaceCelestialScene : this.flightRoot;
      if (model.group.parent !== parent) parent.add(model.group);
      model.group.position.copy(this.flightRelative);
      model.group.visible = true;
      if (surface || this.inStation) celestialBodies.push(body.id);
      // Maps stream in as bodies grow beyond a few pixels; far ones keep the procedural fallback.
      if (!surface && pixelRadius > 4) this.touchSurfaceMap(model.body.id);
      const lod = pixelRadius < 8 ? this.tinySphere : pixelRadius < 100 ? this.distantSphere : pixelRadius < 280 ? this.mediumSphere : pixelRadius < 700 ? this.largeSphere : undefined;
      for (const sphere of this.flightSpheres.get(model)!) sphere.geometry = lod ?? this.flightGeometries.get(sphere)!;
      // The local curved tile adds detail above the coarse globe; clouds stay overhead.
      // Planetary atmospheres belong to surface views and station windows;
      // stellar coronae and magnetospheres remain visible during space flight.
      if (model.layers.atmosphere) model.layers.atmosphere.visible = pixelRadius > 12
        && (surface || this.inStation || model.body.kind === "star")
        && (model.body.id !== environment.body.id || !this.surfaceScene.usesAtmosphere(ship));
      if (model.layers.clouds) model.layers.clouds.visible = pixelRadius > 12;
      if (body.id === "earth") {
        const uniforms = (model.surface.material as THREE.ShaderMaterial).uniforms;
        uniforms.flatClouds.value = Number(pixelRadius < 280);
        uniforms.terrainDetail.value = Number(pixelRadius >= 280);
        // Let the collision-matched local terrain take over before the camera reaches it.
        uniforms.elevationStrength.value = environment.body.id === "earth"
          ? THREE.MathUtils.smoothstep(environment.groundAltitudeKm, 50, 80) : 1;
        model.layers.clouds!.visible = pixelRadius >= 280;
        this.updateCloudShadow(model);
      }
    }
    this.renderer.domElement.dataset.surfaceCelestialBodies = JSON.stringify(celestialBodies);
    if (this.inStation) this.renderer.domElement.dataset.stationCelestialBodies = JSON.stringify(celestialBodies);
  }

  /** Take resident asset references without streaming global terrain detail. */
  private snapshotSurfaceMaps(bodyId: BodyId) {
    const model = this.flightModelById.get(bodyId);
    const axialTilt = getBody(bodyId).axialTiltDeg;
    const map = SURFACE_MAPS[bodyId];
    const pose = { group: model?.group.quaternion, surface: model?.surface.quaternion,
      clouds: model?.layers.clouds?.quaternion };
    const rotation = surfaceMapRotation(bodyId, axialTilt, pose, map?.offset);
    const cloudRotation = bodyId === "earth" ? surfaceMapRotation(bodyId, axialTilt,
      { group: pose.group, surface: pose.clouds }) : rotation;
    const earth = this.earthHighMaps ?? this.earthMaps;
    const texture = bodyId === "earth" ? earth?.[0]
      : this.planetMaps.get(bodyId) ?? this.lazyMaps.get(SURFACE_MAPS[bodyId]?.file ?? "")?.texture;
    this.surfaceScene.setHorizonMap(bodyId, texture ?? null, rotation,
      bodyId === "earth" ? earth?.[3] ?? null : null, cloudRotation,
      new THREE.Vector3(...(map?.tint ?? [1, 1, 1])));
    this.surfaceMapBody = bodyId;
  }

  private updateFlightCamera(blend: number) {
    const ship = this.dynamics!;
    if (this.bridgeView) {
      const interior = this.stationInterior!;
      this.stationSpaceOrigin.copy(ship.position);
      this.stationSpaceRotation.copy(ship.orientation);
      interior.updateCamera();
      const localOffset = interior.camera.position.clone().sub(this.stationLocalOrigin)
        .applyQuaternion(this.stationSpaceRotation).multiplyScalar(ship.scale.metresToUniverseDistance(1));
      this.camera.position.copy(this.stationSpaceOrigin).sub(ship.position).add(localOffset);
      this.camera.quaternion.copy(this.stationSpaceRotation).multiply(interior.camera.quaternion);
      if (this.camera.fov !== interior.camera.fov || this.camera.aspect !== interior.camera.aspect
        || this.camera.near !== 1e-8) {
        this.camera.fov = interior.camera.fov;
        this.camera.aspect = interior.camera.aspect;
        this.camera.near = 1e-8;
        this.camera.far = 2e6;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
      if (this.surfaceScene.sky.parent !== this.spaceScene || this.flightSun.parent !== this.spaceScene)
        this.spaceScene.add(this.surfaceScene.sky, this.flightLight.mesh, this.flightSun);
      this.updateSpaceWorld();
      const sun = ship.activeBodies.filter(body => body.kind === "star" || body.kind === "black-hole")
        .reduce((a, b) => ship.position.distanceToSquared(new THREE.Vector3(...a.position))
          < ship.position.distanceToSquared(new THREE.Vector3(...b.position)) ? a : b);
      this.flightSun.position.fromArray(sun.position).sub(ship.position);
      this.flightSun.color.set(getBody(sun.id).color);
      this.flightSun.intensity = sun.kind === "black-hole" ? 0 : 2.5;
      this.surfaceScene.updateSky(ship, this.camera, this.flightSun);
      this.flightLight.update(ship, this.camera, this.flightSun);
      this.useSystemBackground(ship.systemId);
      this.resumeSpaceWork();
      this.ship.group.visible = false;
      if (this.starshipHull) this.starshipHull.visible = false;
      this.warpEffect.mesh.visible = false;
      this.renderer.domElement.dataset.renderMode = "station";
      this.renderer.domElement.dataset.spaceWorkActive = "true";
      this.renderer.domElement.dataset.exploration = this.pilotingStarship ? "starship" : "station";
      this.renderer.domElement.dataset.physicsEngine = this.pilotingStarship ? "flight" : "station-collision";
      this.renderer.domElement.dataset.stationZone = interior.zone;
      this.renderer.domElement.dataset.stationPositionM = JSON.stringify(interior.positionM.toArray());
      this.renderer.domElement.dataset.stationCamera = interior.cameraView;
      this.renderer.domElement.setAttribute("aria-label", this.pilotingStarship ? "星舰驾驶：WASD 推力与平移，R/F 升降，Q/E 翻滚，方向键转向，空格刹车，X 离开驾驶座" : "星舰舱内探索：WASD 行走，Shift 奔跑，空格跳跃，驾驶台附近按 E 接管");
      return;
    }
    delete this.renderer.domElement.dataset.stationZone;
    delete this.renderer.domElement.dataset.stationPositionM;
    delete this.renderer.domElement.dataset.stationCamera;
    delete this.renderer.domElement.dataset.stationCelestialBodies;
    const environment = ship.environment;
    const previousMode = this.renderPolicy.mode;
    const mode = this.renderPolicy.update({ bodyId: environment.body.id,
      atmosphereKm: environment.body.atmosphereKm, altitudeKm: environment.altitudeKm,
      groundAltitudeKm: environment.groundAltitudeKm, solid: environment.profile.solid, warping: ship.warping });
    if (mode !== previousMode) this.flightFrameDirty = true;
    if (mode !== previousMode || this.surfaceScene.sky.parent !== (mode === "surface" ? this.surfaceWorldScene : this.spaceScene)) {
      const scene = mode === "surface" ? this.surfaceWorldScene : this.spaceScene;
      scene.add(this.surfaceScene.sky, this.flightLight.mesh);
      (mode === "surface" ? this.surfaceCelestialScene : this.spaceScene).add(this.flightSun);
      if (mode === "space") this.resumeSpaceWork();
    }
    this.renderer.domElement.dataset.renderMode = mode;
    this.renderer.domElement.dataset.spaceWorkActive = String(mode === "space");
    if (mode === "surface") {
      if (previousMode !== "surface" || this.surfaceMapBody !== environment.body.id) this.resumeSpaceWork();
      this.touchSurfaceMap(environment.body.id);
      this.snapshotSurfaceMaps(environment.body.id);
    }
    if (mode === "space") this.updateSpaceWorld();
    else this.updateSpaceWorld(true);
    const stars = ship.activeBodies.filter(body => body.kind === "star" || body.kind === "black-hole");
    const light = stars.reduce((closest, body) =>
      this.flightRelative.fromArray(body.position).distanceToSquared(ship.position)
        < this.flightForward.fromArray(closest.position).distanceToSquared(ship.position) ? body : closest);
    this.flightSun.position.fromArray(light.position).sub(ship.position);
    this.flightSun.color.set(light.id === "barnard-star" ? BARNARD_LIGHT_COLOR : getBody(light.id).color);
    this.flightSun.intensity = light.kind === "black-hole" ? 0 : 2.5;
    this.shipSun.color.copy(this.flightSun.color);
    this.useSystemBackground(ship.systemId);
    // Use the same 24 m surface lander as walking, growing smoothly back to flight scale on ascent.
    const surfaceHull = environment.profile.solid
      ? 1 - THREE.MathUtils.smoothstep(environment.groundAltitudeKm, 0, 2) : 0;
    const landerScale = ship.scale.metresToUniverseDistance(24) / this.ship.hullLength;
    const scale = this.renderedShipScale = THREE.MathUtils.lerp(this.shipScale, landerScale, surfaceHull);
    const surfaceView = environment.profile.solid ? 1-THREE.MathUtils.smoothstep(environment.groundAltitudeKm,20,50) : 0;
    this.ship.group.position.set(0, this.ship.landingFootOffset * surfaceView
      - ship.scale.kilometresToUniverseDistance(LANDING_CLEARANCE_KM) / scale * surfaceHull, 0).applyQuaternion(ship.orientation);
    this.ship.group.scale.setScalar(1);
    const attitude = ship.orientation.clone().multiply(this.bankRotation.setFromAxisAngle(this.flightAxis, ship.bank));
    this.ship.group.quaternion.copy(attitude);
    this.ship.group.visible = !this.aboardStarship && ship.camera === "chase" && !ship.warping && !this.walking;
    if (this.aboardStarship) {
      if (!this.starshipHull) {
        this.starshipHull = createStationModel(getBody("earth-station")).group;
        this.shipScene.add(this.starshipHull);
      }
      this.starshipHull.visible = ship.camera === "chase" && !ship.warping;
      this.starshipHull.quaternion.copy(ship.orientation);
      this.starshipHull.scale.setScalar(4);
    } else if (this.starshipHull) this.starshipHull.visible = false;
    const cameraScale = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.shipScale, 0.000015, surfaceView), scale, surfaceHull);
    const chaseY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.2, 0.19, surfaceView), this.ship.hullLength * 0.35, surfaceHull);
    const chaseZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(9 + this.flightBoost * 0.6, 0.72, surfaceView),
      this.ship.hullLength * 1.4 * Math.max(1, 1 / this.camera.aspect), surfaceHull);
    if (!this.walking) {
      const offset = new THREE.Vector3(0,ship.camera === "chase" ? chaseY : 0,ship.camera === "chase" ? chaseZ : 0).multiplyScalar(cameraScale).applyQuaternion(ship.orientation);
      if (ship.camera === "chase") {
        this.camera.position.lerp(offset, blend);
        // Keep the chase camera in the pilot's altitude band, including a steep descent.
        // A several-hundred-km hull framing offset must not move the sky back into space.
        if (environment.body.atmosphereKm && environment.altitudeKm < environment.body.atmosphereKm * 4) {
          const relative = ship.position.clone().sub(new THREE.Vector3().fromArray(environment.body.position));
          const near = 1 - THREE.MathUtils.smoothstep(environment.altitudeKm, environment.body.atmosphereKm, environment.body.atmosphereKm * 4);
          const maxOffsetKm = THREE.MathUtils.lerp(1200, Math.max(0.02, environment.altitudeKm * 0.15), near);
          const limit = maxOffsetKm / ship.config.unitsKm;
          const radialOffset = this.camera.position.dot(environment.outward);
          if (Math.abs(radialOffset) > limit) {
            const distance = this.camera.position.length();
            const tangent = this.camera.position.clone().addScaledVector(environment.outward, -radialOffset);
            if (tangent.lengthSq() < 1e-12) tangent.set(1, 0, 0).applyQuaternion(attitude).projectOnPlane(environment.outward);
            const radial = THREE.MathUtils.clamp(radialOffset, -limit, limit);
            this.camera.position.copy(tangent.normalize().multiplyScalar(Math.sqrt(Math.max(0, distance * distance - radial * radial))))
              .addScaledVector(environment.outward, radial);
          }
          const cameraRadial = relative.clone().add(this.camera.position);
          const minRadius = environment.body.radius + Math.max(environment.groundHeightKm + 0.002, environment.altitudeKm - maxOffsetKm) / ship.config.unitsKm;
          const maxRadius = environment.body.radius + (environment.altitudeKm + maxOffsetKm) / ship.config.unitsKm;
          cameraRadial.clampLength(minRadius, Math.max(minRadius, maxRadius));
          this.camera.position.copy(cameraRadial.sub(relative));
        }
        this.camera.up.set(0, 1, 0).applyQuaternion(attitude);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.orientation);
        const nearAtmosphere = environment.body.atmosphereKm
          ? 1 - THREE.MathUtils.smoothstep(environment.altitudeKm, environment.body.atmosphereKm, environment.body.atmosphereKm * 4) : 0;
        this.camera.up.lerp(environment.outward, nearAtmosphere * Math.pow(forward.dot(environment.outward), 2)).normalize();
        const lookAhead = 5 * cameraScale * (1 - nearAtmosphere * Math.abs(forward.dot(environment.outward)) * 0.92);
        const lookTarget = forward.multiplyScalar(lookAhead);
        const hullTarget = this.ship.group.position.clone().multiplyScalar(scale)
          .addScaledVector(environment.outward, this.ship.hullLength * 0.1 * scale);
        this.camera.lookAt(lookTarget.lerp(hullTarget, surfaceHull));
      } else {
        this.camera.position.copy(offset);
        this.camera.quaternion.slerp(attitude, blend);
      }
    }
    const strength = ship.warpPhase === "transit" ? Math.sin(ship.warpProgress * Math.PI) * 0.65 + 0.35 : ship.warpPhase === "charging" ? ship.warpProgress * 0.15 : ship.warpPhase === "arrival" ? (1 - ship.warpProgress) ** 2 * 0.35 : 0;
    this.warpEffect.mesh.visible = strength > 0;
    this.warpEffect.material.uniforms.strength.value = strength;
    this.warpEffect.material.uniforms.time.value = ship.elapsed;
    this.warpEffect.material.uniforms.aspect.value = this.camera.aspect;
    const fov = this.walking ? 65 : 58 + strength * 25 + this.flightBoost * 9;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const scaleUnits = new SpatialScale(ship.config.unitsKm);
    if (this.walking) {
      this.localRenderCamera.aspect = this.camera.aspect;
      this.explorerView.update(this.walker!, ship, this.localRenderCamera, this.explorerCamera,
        blend >= 1 ? 0 : -Math.log(Math.max(1e-9, 1 - blend)) / 9, this.flightPaused, blend >= 1);
      // Navigation/optics retain the inexpensive ship-relative universe camera.
      this.camera.position.copy(this.localRenderCamera.position).sub(this.walker!.localShipPositionM)
        .multiplyScalar(1 / scaleUnits.metresPerUnit);
      this.camera.quaternion.copy(this.localRenderCamera.quaternion);
      this.camera.up.copy(this.localRenderCamera.up);
      this.camera.fov = this.localRenderCamera.fov;
    } else {
      this.explorerView.group.visible = false;
      this.localRenderCamera.copy(this.camera, false);
      this.localRenderCamera.position.copy(ship.localPositionM)
        .addScaledVector(this.camera.position, scaleUnits.metresPerUnit);
      this.localRenderCamera.near = Math.max(0.03, this.camera.near * scaleUnits.metresPerUnit);
    }
    this.localRenderCamera.far = Math.max(1e7, environment.body.radius * scaleUnits.metresPerUnit * 4);
    this.localRenderCamera.updateProjectionMatrix();
    const localFrame = this.walking ? this.walker!.localFrame : ship.localFrame;
    this.renderer.domElement.dataset.localOrigin = JSON.stringify(localFrame!.originUniverse);
    this.renderer.domElement.dataset.localPositionM = JSON.stringify((this.walking ? this.walker!.localPositionM : ship.localPositionM).toArray());
    this.renderer.domElement.dataset.physicsEngine = this.walking ? "rapier" : "flight";
    this.renderer.domElement.dataset.exploration = this.pilotingStarship ? "starship" : this.walking ? "walking" : "ship";
    this.renderer.domElement.setAttribute("aria-label", this.walking
      ? "地表探索：WASD 行走，Shift 奔跑，空格跳跃，方向键或拖动看向，E 返回飞船"
      : "自由驾驶飞船：W/S 推力，方向键或触屏拖动转向，空格刹车");
    if (mode === "surface") this.surfaceScene.update(ship, this.localRenderCamera, this.flightSun, this.walking ? this.walker : undefined);
    else this.surfaceScene.updateSky(ship, this.camera, this.flightSun);
    this.flightLight.update(ship, this.camera, this.flightSun);
    this.useSystemBackground(ship.systemId);
    this.ship.gear.visible = ship.landingPhase !== "manual" || (environment.profile.solid && environment.groundAltitudeKm < 1);
  }
  private animateFlight(delta: number, time: number) {
    const ship = this.dynamics!;
    const input = this.flightControls!.read();
    if (!this.flightPaused) {
      if (this.inStation) {
        this.stationInterior!.step(delta, input);
        ship.step(delta, { ...input, throttle: 0, strafe: 0, lift: 0, yaw: 0, pitch: 0,
          roll: 0, boost: false, brake: false, mouseX: 0, mouseY: 0 });
      } else if (this.walking) {
        this.walker!.step(delta, input);
        // The parked ship advances its clock and cooldown with no pilot input.
        ship.step(delta, { ...input, throttle: 0, strafe: 0, lift: 0, yaw: 0, pitch: 0,
          roll: 0, boost: false, brake: false, mouseX: 0, mouseY: 0 });
      } else ship.step(delta, input);
    }
    if (!this.flightPaused) this.flightBoost = THREE.MathUtils.lerp(this.flightBoost,
      !this.walking && input.boost && ship.velocity.length() > 0 && !ship.warping ? 1 : 0, 1 - Math.exp(-delta * 4));
    const exhaust = this.flightPaused || ship.warping ? 0.1 : input.boost && input.throttle > 0 ? 2.4 : input.throttle > 0 ? 1 : 0.22;
    this.ship.exhaust.scale.z = THREE.MathUtils.lerp(this.ship.exhaust.scale.z, exhaust, 1 - Math.exp(-delta * 10));
    this.updateFlightCamera(1 - Math.exp(-delta * 9));
    if (!this.flightPaused && !this.paused && (this.inStation || this.renderPolicy.mode === "space"))
      for (const model of this.flightModels) {
        if (!model.group.visible) continue;
        // Keep surface features fixed in the collision frame while flying; clouds still drift.
        for (const { object, rate } of model.spinning)
          if (object !== model.surface) object.rotation.y += rate * delta;
        this.updateCloudShadow(model);
        for (const uniform of model.timeUniforms) uniform.value += delta;
      }
    const target = ship.config.bodies.find((b) => b.id === ship.target)!;
    this.flightRelative.copy(ship.targetRelative);
    const markerRelative = this.inStation ? new THREE.Vector3(0, 0.3, -36) : this.walking ? ship.environment.outward.clone()
      .multiplyScalar(ship.scale.metresToUniverseDistance(-6)) : this.flightRelative;
    const tracking = projectFlightTarget(markerRelative, this.inStation ? this.stationInterior!.camera : this.camera);
    const aim = this.flightControls!.aim;
    this.flightTargetHandler?.({ ...tracking, target: ship.target, deceleration: ship.deceleration,
      aimX: aim.x, aimY: aim.y, steering: aim.active && !this.flightPaused,
      width: this.flightWidth, height: this.flightHeight });
    if (time - this.flightMetrics < 150) return;
    this.flightMetrics = time;
    const environment = ship.environment;
    const forward = this.flightForward.set(0, 0, -1).applyQuaternion(
      this.inStation ? this.stationInterior!.camera.quaternion : this.camera.quaternion,
    );
    this.flightHandler?.({
      systemId: ship.systemId,
      renderMode: this.inStation ? "station" : this.renderPolicy.mode,
      engine: ship.engine,
      cruiseSpeedKm: ship.cruiseSpeedKm,
      lowFlightSpeedMps: ship.lowFlightSpeedMps,
      engineMode: ship.engineMode,
      orbitalEngineActive: ship.orbitalEngineActive,
      orbitalBlockReason: ship.orbitalBlockReason,
      environment,
      warpBlockReason: ship.warpBlockReason,
      warpPhase: ship.warpPhase,
      warpProgress: ship.warpProgress,
      speedKm: ship.warping ? ship.warpSpeedKm : ship.velocity.length() * ship.config.unitsKm,
      speedLimitKm: ship.speedLimit * ship.config.unitsKm,
      altitudeKm: environment.altitudeKm,
      nearest: environment.body.id,
      distanceKm:
        Math.max(0, this.flightRelative.length() - target.radius) *
        ship.config.unitsKm,
      target: ship.target,
      heading:
        (THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)) + 360) %
        360,
      elapsed: ship.elapsed,
      boosting: input.boost,
      collision: ship.collision,
      landingPhase: ship.landingPhase,
      landingBlockReason: ship.target === "earth-station" ? this.aboardStarship ? "正在驾驶星舰，可选择其他目的地" : this.stationDockBlockReason : ship.landingBlockReason,
      station: this.inStation ? { zone: this.stationInterior!.zone } : null,
      walking: this.inStation ? { gravity: 9.81, speedMps: this.stationInterior!.speedMps,
        grounded: this.stationInterior!.grounded, distanceToShipM: this.stationInterior!.distanceToHelmM,
        bodyId: "earth-station", camera: this.explorerCamera } : this.walking ? { gravity: this.walker!.gravity, speedMps: this.walker!.speedMps,
        grounded: this.walker!.grounded, distanceToShipM: this.walker!.distanceToShipM,
        bodyId: this.walker!.bodyId!, camera: this.explorerCamera } : null,
    });
  }

  private viewPosition(view: View): THREE.Vector3 {
    if (this.currentModel?.body.kind === "station") return {
      overview: new THREE.Vector3(0, 2.4, 4.8).multiplyScalar(Math.max(1, 1 / this.camera.aspect)),
      close: new THREE.Vector3(0.6, 1.05, 2.4).multiplyScalar(Math.max(1, 0.8 / this.camera.aspect)),
      night: new THREE.Vector3(3.6, 1.5, -3.6).multiplyScalar(Math.max(1, 1 / this.camera.aspect)),
    }[view];
    if (this.currentModel?.body.kind === "black-hole")
      return {
        overview: new THREE.Vector3(0, 0.85, 10.5).multiplyScalar(Math.max(1, 1.3 / this.camera.aspect)),
        close: new THREE.Vector3(0, 0.5, 7),
        night: new THREE.Vector3(7, 5, -7).multiplyScalar(Math.max(1, 1.3 / this.camera.aspect)),
      }[view];
    if (this.currentModel?.body.id === "echo-pulsar" && view === "overview")
      return new THREE.Vector3(0, 0.35, 9.4).multiplyScalar(Math.max(1, 0.70 / this.camera.aspect));
    if (this.currentModel?.body.id === "saturn") {
      return {
        // Narrow displays need more distance to show the full ring system.
        overview: new THREE.Vector3(0, 2.6, 5.2).multiplyScalar(
          Math.max(1, 1.07 / Math.max(this.camera.aspect, 0.55)),
        ),
        close: new THREE.Vector3(0, 1.3, 2.6),
        // View the unlit ring face instead of lining up exactly with its plane.
        night: new THREE.Vector3(4, -1.8, -4),
      }[view];
    }
    if (this.currentModel?.body.id === "mars" && view === "overview")
      return new THREE.Vector3(0, 1.2, 3.72);
    const vectors: Record<View, THREE.Vector3> = {
      overview: new THREE.Vector3(0, 0.3, 3.9),
      close: new THREE.Vector3(0, 0.14, 1.85),
      night: new THREE.Vector3(3.6, 0.45, -1.2),
    };
    return vectors[view];
  }

  setView(view: View) {
    this.targetPosition = this.viewPosition(view);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }
  setSpeed(speed: number) {
    this.speed = speed;
  }
  setLayer(layer: Layer, visible: boolean) {
    const object =
      layer === "stars" ? this.galaxySky.mesh : this.currentModel?.layers[layer];
    if (object) object.visible = visible;
    if (layer === "clouds" && this.currentModel) this.updateCloudShadow(this.currentModel);
    if (layer === "stars") {
      this.starsEnabled = visible;
      this.useSystemBackground(this.backgroundSystem);
    }
    if (layer === "rings" && this.currentModel?.ringsEnabled)
      this.currentModel.ringsEnabled.value = Number(visible);
  }
  setQuality(quality: RenderQuality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.galaxySky.setDetailed(quality !== "standard" && !this.compactTextures
      && this.renderer.domElement.dataset.softwareRenderer !== "true");
    this.configureRenderBudget();
  }
  getQuality(): RenderQuality { return this.quality; }
  /** Preserve the selected visible map feature as observation surfaces rotate. */
  pickSurface(clientX: number, clientY: number): [number, number, number] | null {
    const model = this.currentModel;
    if (this.flying || !model || !surfaceProfile(model.body.id).solid
      || !model.surface.visible || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || clientX < bounds.left || clientX > bounds.right
      || clientY < bounds.top || clientY > bounds.bottom) return null;
    const point = new THREE.Vector2((clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (clientY - bounds.top) / bounds.height * 2);
    this.camera.updateMatrixWorld();
    model.group.updateWorldMatrix(true, true);
    this.surfacePicker.setFromCamera(point, this.camera);
    // Venus's visible photography is on its cloud shell; use that shell's UV frame when enabled.
    const source = model.body.id === "venus" && model.layers.clouds?.visible
      ? model.layers.clouds : model.surface;
    const hit = this.surfacePicker.intersectObject(source, false)[0];
    if (!hit?.uv) return null;
    const offset = model.mapUniforms?.mapOffset.value ?? 0;
    const longitude = (hit.uv.x + offset) * Math.PI * 2;
    const latitude = (hit.uv.y - 0.5) * Math.PI;
    const local = new THREE.Vector3(-Math.cos(longitude) * Math.cos(latitude),
      Math.sin(latitude), Math.sin(longitude) * Math.cos(latitude));
    // With Venus's cloud deck hidden, its bare surface uses the normal rocky-surface yaw.
    const pose = model.body.id === "venus" && source === model.surface
      ? { clouds: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4) } : {};
    return local.applyMatrix3(surfaceMapRotation(model.body.id, model.body.axialTiltDeg, pose, offset).invert())
      .normalize().toArray();
  }
  zoom(factor: number) {
    this.targetPosition = null;
    const distance = THREE.MathUtils.clamp(
      this.camera.position.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.camera.position.setLength(distance);
  }
  rotate(horizontal: number, vertical: number) {
    this.targetPosition = null;
    this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), horizontal);
    const right = new THREE.Vector3()
      .crossVectors(this.camera.up, this.camera.position)
      .normalize();
    this.camera.position.applyAxisAngle(right, vertical);
  }

  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.photoCapture?.reject(new Error("图形上下文已中断，照片未能生成"));
    this.photoCapture = undefined;
    this.onError(
      "图形上下文已中断，请重新加载场景。也可以关闭其他占用显卡的页面后重试。",
    );
  };

  dispose() {
    this.destroyed = true;
    this.walker?.reset();
    this.stationInterior?.dispose();
    this.photoCapture?.reject(new Error("场景已关闭，照片未能生成"));
    this.photoCapture = undefined;
    this.resumeSpaceWork();
    this.galaxySky.dispose();
    this.surfaceGalaxySky.dispose();
    this.surfaceScene.dispose();
    this.shipSun.shadow.dispose();
    this.earthDetails.forEach(detail => detail.dispose());
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.contextLost,
    );
    this.flightControls?.dispose();
    this.controls.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    geometries.add(this.distantSphere);
    geometries.add(this.mediumSphere);
    geometries.add(this.tinySphere);
    geometries.add(this.largeSphere);
    this.flightGeometries.forEach((geometry) => geometries.add(geometry));
    const materials = new Set<THREE.Material>();
    const instances = new Set<THREE.InstancedMesh>();
    const collect = (object: THREE.Object3D) => {
      if (object instanceof THREE.InstancedMesh) instances.add(object);
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        objectMaterials.forEach((material) => materials.add(material));
      }
    };
    this.spaceScene.traverse(collect);
    this.surfaceCelestialScene.traverse(collect);
    this.surfaceWorldScene.traverse(collect);
    this.shipScene.traverse(collect);
    this.surfaceWorldScene.traverse(collect);
    this.models.forEach((model) => model.group.traverse(collect));
    for (const model of [...this.models.values(), ...this.flightModels])
      model.ownedTextures?.forEach(texture => texture.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    instances.forEach(mesh => mesh.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
