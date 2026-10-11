import * as THREE from "three";
import { createStationModel } from "./orbital-structures";
import { atmosphereScattering, atmosphereStrength } from "./atmosphere";
import { surfaceProfile } from "../shared/surface.mjs";
import type { CelestialBody, Layer } from "./solar-system";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURFACE_MAPS } from "./body-textures";
import type { SurfaceMap } from "./body-textures";
import { PROCEDURAL_DETAIL_WIDTH, proceduralBodyProfile } from "./procedural-body";
import { SATURN_RING_INNER, SATURN_RING_OUTER, saturnRingOptics } from "./saturn-rings";
import { createBlackHoleModel } from "./black-hole-model";
import { createEchoModel } from "./echo-models";
import { BARNARD_LIGHT_COLOR } from "./stellar-light";

export interface PlanetModel {
  body: CelestialBody;
  group: THREE.Group;
  surface: THREE.Mesh;
  layers: Partial<Record<Layer, THREE.Object3D>>;
  spinning: { object: THREE.Object3D; rate: number }[];
  timeUniforms: THREE.IUniform<number>[];
  ringsEnabled?: THREE.IUniform<number>;
  /** Photographic or concept map shared by the surface (or Venus cloud deck) material. */
  surfaceMap?: SurfaceMap;
  mapUniforms?: SurfaceMapUniforms;
  ownedTextures?: THREE.Texture[];
}

export interface SurfaceMapUniforms {
  detailMap: THREE.IUniform<THREE.Texture | null>;
  mapSize: THREE.IUniform<THREE.Vector2>;
  mapReady: THREE.IUniform<number>;
  mapTint: THREE.IUniform<THREE.Vector3>;
  mapOffset: THREE.IUniform<number>;
  mapRelief: THREE.IUniform<number>;
  mapGrain: THREE.IUniform<number>;
  mapStreaks: THREE.IUniform<number>;
}

export const modelVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  void main() {
    vUv = uv;
    vLocalPosition = position;
    // Object axes in world space let fragments turn map-space slopes into lighting normals.
    vAxisX = normalize(mat3(modelMatrix)[0]);
    vAxisY = normalize(mat3(modelMatrix)[1]);
    vAxisZ = normalize(mat3(modelMatrix)[2]);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vec3 n = normalMatrix * normal;
    vNormal = normalize(vec3(dot(viewMatrix[0].xyz,n),dot(viewMatrix[1].xyz,n),dot(viewMatrix[2].xyz,n)));
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

export const noise = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0, amplitude = 0.5;
    for (int i=0; i<4; i++) {
      value += noise3(p) * amplitude;
      p = p * 2.03 + vec3(7.1,13.7,3.2);
      amplitude *= 0.5;
    }
    return value;
  }
  float crater(vec2 uv, float density, vec3 seed) {
    vec2 grid = floor(vec2(density,density*0.5)+0.5);
    vec2 cell = floor(uv*grid), f = fract(uv*grid);
    float result = 0.0;
    for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
      vec2 offset = vec2(float(x),float(y));
      vec2 wrapped = mod(cell+offset,grid);
      vec2 center = vec2(hash(vec3(wrapped,8.0)+seed),hash(vec3(wrapped,27.0)+seed));
      float radius = 0.12+hash(vec3(wrapped,3.0)+seed)*0.28;
      float d = length(f-offset-center)/radius;
      result += -0.22*(1.0-smoothstep(0.0,0.94,d))+0.1*exp(-pow((d-1.0)*12.0,2.0));
    }
    return result;
  }
`;

/** Shared map filtering for planets, moons, stars and Earth. */
export const mapSampling = /* glsl */ `
  float mapLuminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec4 bsplineWeights(float v) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
    return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
  }
  // Gradients taken across the longitude wrap keep the map seam at full resolution; true on seam pixels.
  bool seamGradients(vec2 uv, out vec2 gx, out vec2 gy) {
    gx = dFdx(uv); gy = dFdy(uv);
    vec2 wrapped = vec2(fract(uv.x + 0.5), uv.y);
    vec2 wx = dFdx(wrapped), wy = dFdy(wrapped);
    bool seam = abs(wx.x) < abs(gx.x) || abs(wy.x) < abs(gy.x);
    if (abs(wx.x) < abs(gx.x)) gx.x = wx.x;
    if (abs(wy.x) < abs(gy.x)) gy.x = wy.x;
    return seam;
  }
  // A cubic B-spline from four bilinear taps replaces the blocky texel grid of magnified maps.
  // Only seam pixels need the wrapped gradients, as an explicit mip level; elsewhere the implicit lookup is identical.
  vec4 sampleMap(sampler2D map, vec2 uv, vec2 size, vec2 gx, vec2 gy, bool seam) {
    float texels = max(length(gx * size), length(gy * size));
    vec4 linear = texture(map, uv);
    if (seam) linear = textureLod(map, uv, log2(max(texels, 1.0)));
    if (texels >= 1.0) return linear;
    vec2 coord = uv * size - 0.5;
    vec2 f = fract(coord);
    coord -= f;
    vec4 xw = bsplineWeights(f.x), yw = bsplineWeights(f.y);
    vec4 s = vec4(xw.xz + xw.yw, yw.xz + yw.yw);
    vec4 offset = (coord.xxyy + vec2(-0.5, 1.5).xyxy + vec4(xw.yw, yw.yw) / s) / size.xxyy;
    // Magnified maps always read mip 0.
    vec4 a = textureLod(map, offset.xz, 0.0), b = textureLod(map, offset.yz, 0.0);
    vec4 c = textureLod(map, offset.xw, 0.0), d = textureLod(map, offset.yw, 0.0);
    float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
    vec4 cubic = mix(mix(d, c, sx), mix(b, a, sx), sy);
    return mix(cubic, linear, smoothstep(0.5, 1.0, texels));
  }
  // The same B-spline at a fixed mip level, used to read block-averaged texels.
  vec4 sampleMapLod(sampler2D map, vec2 uv, vec2 size, float lod) {
    vec2 levelSize = size / exp2(lod);
    vec2 coord = uv * levelSize - 0.5;
    vec2 f = fract(coord);
    coord -= f;
    vec4 xw = bsplineWeights(f.x), yw = bsplineWeights(f.y);
    vec4 s = vec4(xw.xz + xw.yw, yw.xz + yw.yw);
    vec4 offset = (coord.xxyy + vec2(-0.5, 1.5).xyxy + vec4(xw.yw, yw.yw) / s) / levelSize.xxyy;
    vec4 a = textureLod(map, offset.xz, lod), b = textureLod(map, offset.yz, lod);
    vec4 c = textureLod(map, offset.xw, lod), d = textureLod(map, offset.yw, lod);
    float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
    return mix(mix(d, c, sx), mix(b, a, sx), sy);
  }
  // Value noise with its analytic gradient, so detail normals need no screen derivatives.
  vec4 noised(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash(i), b = hash(i + vec3(1, 0, 0)), c = hash(i + vec3(0, 1, 0)), d = hash(i + vec3(1, 1, 0));
    float e = hash(i + vec3(0, 0, 1)), g = hash(i + vec3(1, 0, 1)), h = hash(i + vec3(0, 1, 1)), k = hash(i + vec3(1, 1, 1));
    float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g;
    float k7 = -a + b + c - d + e - g - h + k;
    return vec4(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
      du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
  }
  // Four screen-filtered layers through the spatial frequency of a 32K equatorial map.
  // These are generated samples, not downloaded / upscaled 32K source imagery.
  // x = albedo variation, yzw = object-space slope. Shared by photographic Earth and other bodies.
  vec4 surfaceDetail(vec3 p, float texelFrequency, float footprint, float magnify, vec3 stretch, vec3 seed, float ridgeMix) {
    vec4 total = vec4(0.0);
    float frequency = max(texelFrequency, 4096.0 / 6.2831853), amplitude = 1.0;
    for (int i = 0; i < 4; i++) {
      if (frequency > ${(PROCEDURAL_DETAIL_WIDTH / (Math.PI * 2) * 1.00001).toFixed(8)}) break;
      // Respect the most stretched axis so cloud filaments and ice grain cannot alias.
      float maxStretch = max(stretch.x, max(stretch.y, stretch.z));
      float weight = clamp(1.5 - footprint * frequency * maxStretch * 2.0, 0.0, 1.0) * magnify;
      if (weight > 0.0) {
        vec4 n = noised(p * stretch * frequency + seed + vec3(float(i) * 17.31));
        float ridge = 1.0 - abs(n.x * 2.0 - 1.0);
        vec3 ridgeGradient = -2.0 * sign(n.x * 2.0 - 1.0) * n.yzw;
        // Symmetric albedo modulation preserves the measured map's mean colour.
        total += weight * amplitude * vec4(mix(n.x - 0.5, ridge - 0.625, ridgeMix), mix(n.yzw, ridgeGradient, ridgeMix) * stretch);
      }
      frequency *= 2.0;
      amplitude *= 0.62;
    }
    return total;
  }
  vec4 surfaceGrain(vec3 p, float texelFrequency, float footprint, float magnify, vec3 stretch, float seed) {
    return surfaceDetail(p, texelFrequency, footprint, magnify, stretch, vec3(seed), 0.0);
  }
`;

const planetFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D detailMap;
  uniform vec2 mapSize;
  uniform vec3 mapTint;
  uniform float mapReady, mapOffset, mapRelief, mapGrain, mapStreaks;
  uniform vec3 sunDirection;
  uniform vec3 planetAxis;
  uniform vec3 planetCenter;
  uniform float bodyRadius;
  uniform float solarAngularRadius;
  uniform float uTime;
  uniform float ringsEnabled;
  uniform vec3 moonColor;
  uniform float moonSeed, moonStyle;
  uniform vec3 stellarTint;
  uniform vec3 illuminantTint;
  uniform float stellarIllustration;
  uniform vec3 bodySeed, detailStretch;
  uniform vec4 bodyTerrain, bodyWeather;
  uniform float detailRidges;
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  ${noise}
  ${mapSampling}
  #ifdef BARNARD_RED_DWARF
    // An M3.5 photosphere remains a luminous copper/amber continuum. Sparse
    // cooler magnetic regions alter radiance; this is a concept, not imaging.
    vec3 barnardPhotosphere(float heat) {
      return mix(vec3(1.42,0.40,0.16),vec3(2.55,1.25,0.57),heat)
        * (0.84+0.22*heat);
    }
  #endif
  #if BODY_KIND == 4
    ${saturnRingOptics}
  #endif
  void main() {
    vec3 p = normalize(vLocalPosition);
    float height = 0.0;
    vec3 color = vec3(0.5);
    #ifdef SURFACE_MAP
      vec2 uv = vec2(vUv.x + mapOffset, vUv.y);
      vec2 gx, gy;
      bool seam = seamGradients(uv, gx, gy);
      float texels = max(length(gx * mapSize), length(gy * mapSize));
      float footprint = max(length(dFdx(p)), length(dFdy(p)));
      float magnify = 1.0 - smoothstep(0.6, 1.4, texels);
      float reliefLod = log2(max(texels, 1.0));
    #endif
    #if BODY_KIND == 7
      float terrain = fbm(p*bodyTerrain.x+bodySeed);
      vec3 plasma = p*bodyWeather.w+bodySeed+vec3(0.0,uTime*bodyWeather.z,0.0);
      float granules = fbm(plasma+(terrain-0.5)*bodyWeather.y);
      float fine = noise3(p*170.0+bodySeed+uTime*0.006);
      color = mix(vec3(1.5,0.25,0.007),vec3(3.0,1.6,0.22),smoothstep(0.24,0.70,granules))*(0.84+fine*0.23);
      if (stellarIllustration > 0.5) color = stellarTint * (1.2+granules*2.4) * (0.84+fine*0.23);
      float sunspots = smoothstep(0.69,0.78,fbm(p*8.0+bodySeed+vec3(17.0)));
      color *= 1.0-sunspots*0.85;
      #ifdef BARNARD_RED_DWARF
        float granuleFootprint = max(length(dFdx(p)),length(dFdy(p)));
        // The fallback shares the native map's small photospheric grain, with
        // screen filtering that prevents sparkling while the map is loading.
        float granuleDetail = (noise3(p*1150.0+bodySeed)-0.5)
          * clamp(1.5-granuleFootprint*2300.0,0.0,1.0);
        color = barnardPhotosphere(smoothstep(0.24,0.72,granules)+granuleDetail*0.12)
          * (1.0-sunspots*0.22);
      #endif
      #ifdef RED_SUPERGIANT
        // Much larger, slower convection than the fine granules of a main-sequence star.
        float convection = fbm(p*bodyTerrain.x+bodySeed+vec3(0.0,uTime*bodyWeather.z,0.0));
        color = stellarTint * (0.6+convection*2.2);
      #endif
      #ifdef SURFACE_MAP
        if (mapReady > 0.001) {
          vec3 photo = sampleMap(detailMap, uv, mapSize, gx, gy, seam).rgb;
          vec4 grain = magnify > 0.0 ? surfaceDetail(p, mapSize.x / 6.2832, footprint, magnify, detailStretch, bodySeed, detailRidges) : vec4(0.0);
          // Illustrated stars keep the map's granulation and spots in their own temperature colour.
          vec3 stellar = stellarIllustration > 0.5
            ? stellarTint * 1.5 * pow(max(mapLuminance(photo) * mapTint.x, 0.0), 3.0)
            : photo * 1.7;
          #ifdef RED_SUPERGIANT
            stellar = photo * 1.8 * (0.94+convection*0.16);
          #endif
          #ifdef BARNARD_RED_DWARF
            // The native spherical map is monochrome radiance. It has no
            // directional shading, so limb darkening is correct from any view.
            float heat = smoothstep(0.22,0.79,mapLuminance(photo));
            stellar = barnardPhotosphere(heat)*(0.985+terrain*0.03);
          #endif
          color = mix(color, stellar * (1.0 + grain.x * mapGrain * 2.0), mapReady);
        }
      #endif
      vec3 viewDirection = normalize(cameraPosition-vWorldPosition);
      #ifdef BARNARD_RED_DWARF
      color *= 0.42+0.58*pow(max(dot(normalize(vNormal),viewDirection),0.0),0.43);
      #else
      color *= 0.55+0.45*pow(max(dot(normalize(vNormal),viewDirection),0.0),0.3);
      #endif
      #include <logdepthbuf_fragment>
      gl_FragColor = vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    #else
    #ifdef SURFACE_MAP
    // Procedural surfaces only fill in until the map has loaded and faded in.
    if (mapReady < 0.999) {
    #endif
    float terrain = fbm(p*bodyTerrain.x+bodySeed);
    float detail = noise3(p*180.0+bodySeed);
    float ridges = 1.0-abs(terrain*2.0-1.0);
    height = mix(terrain,ridges,bodyTerrain.z)*0.03;
    #if BODY_KIND == 0
      height += crater(vUv,bodyTerrain.y,bodySeed)+crater(vUv,bodyTerrain.y*2.8,bodySeed+17.0)*0.55;
      color = mix(vec3(0.19,0.17,0.16),vec3(0.55,0.52,0.47),smoothstep(0.3,0.7,terrain));
      color *= 0.85+detail*0.3+height*0.25;
    #elif BODY_KIND == 1
      height += crater(vUv,bodyTerrain.y+24.0,bodySeed)*0.25;
      color = mix(vec3(0.21,0.105,0.035),vec3(0.65,0.35,0.12),terrain);
      color *= 0.86+detail*0.18;
    #elif BODY_KIND == 2
      height += crater(vUv,bodyTerrain.y,bodySeed)*0.18;
      float dark = smoothstep(0.36,0.59,fbm(p*vec3(6.0,3.0,7.0)+bodySeed));
      color = mix(vec3(0.60,0.22,0.09),vec3(0.23,0.095,0.048),dark)+vec3(0.2,0.12,0.06)*terrain;
      float cap = smoothstep(0.945,0.98,abs(p.y)+noise3(p*35.0+bodySeed)*0.02);
      color = mix(color,vec3(0.83,0.82,0.76),cap)*(0.9+detail*0.15);
    #elif BODY_KIND == 3
      float lat = p.y+fbm(p*vec3(5.0,bodyWeather.w,5.0)+bodySeed)*0.06;
      float bands = 0.5+0.5*sin(lat*bodyWeather.x+noise3(p*12.0+bodySeed)*bodyWeather.y);
      color = mix(vec3(0.87,0.78,0.63),vec3(0.46,0.26,0.14),smoothstep(0.2,0.85,bands));
      color += (fbm(p*vec3(28.0,70.0,28.0)+bodySeed)-0.5)*0.16;
      vec2 spot = vec2(mod(vUv.x-0.19+0.5,1.0)-0.5,vUv.y-0.39)/vec2(0.068,0.038);
      float oval = length(spot);
      float vortex = sin(oval*19.0+atan(spot.y,spot.x)*3.0+terrain*4.0);
      vec3 red = mix(vec3(0.62,0.20,0.075),vec3(0.83,0.43,0.20),vortex*0.5+0.5);
      color = mix(color,red,(1.0-smoothstep(0.82,1.16,oval))*0.88);
      height = detail*0.002;
    #elif BODY_KIND == 4
      float bands = 0.5+0.5*sin(p.y*bodyWeather.x+terrain*bodyWeather.y);
      color = mix(vec3(0.88,0.78,0.56),vec3(0.65,0.52,0.33),bands*0.45);
      color += (fbm(p*vec3(16.0,60.0,16.0)+bodySeed)-0.45)*0.065;
      height = detail*0.001;
    #elif BODY_KIND == 5
      color = mix(vec3(0.32,0.66,0.69),vec3(0.54,0.81,0.79),terrain*0.5+0.2);
      color += sin(p.y*bodyWeather.x+terrain*bodyWeather.y)*0.015;
      height = 0.0;
    #elif BODY_KIND == 6
      float bands = 0.5+0.5*sin(p.y*bodyWeather.x+terrain*bodyWeather.y);
      color = mix(vec3(0.055,0.20,0.52),vec3(0.12,0.38,0.77),bands*0.65+terrain*0.2);
      vec2 spot = vec2(mod(vUv.x-0.22+0.5,1.0)-0.5,vUv.y-0.44)/vec2(0.045,0.035);
      color *= 1.0-(1.0-smoothstep(0.6,1.2,length(spot)))*0.4;
      height = detail*0.001;
    #elif BODY_KIND == 9
      height += crater(vUv,bodyTerrain.y,bodySeed)*0.2;
      color = moonColor*(0.48+terrain*0.7+detail*0.08);
      float darkPlains = smoothstep(0.49,0.63,fbm(p*vec3(5.0,3.0,7.0)+bodySeed));
      color = mix(color,vec3(0.075,0.055,0.05),darkPlains*0.7);
    #elif BODY_KIND == 8
      float regions = fbm(p*bodyTerrain.x+bodySeed);
      float pits = crater(vUv,bodyTerrain.y,bodySeed)+crater(vUv,bodyTerrain.y*3.1,bodySeed+31.0)*0.4;
      height += pits*0.35;
      color = moonColor * (0.35+regions*0.85+pits*0.5+detail*0.12);
      if (moonStyle == 0.0) color = mix(color,color*0.45,smoothstep(0.58,0.68,regions));
      if (moonStyle == 1.0) {
        float cracks = (1.0-smoothstep(0.018,0.065,abs(sin(p.x*38.0+fbm(p*12.0+bodySeed)*10.0))))*bodyTerrain.w;
        height -= cracks*0.1;
        color = mix(moonColor*(0.7+regions*0.45),vec3(0.25,0.15,0.10),cracks*0.7);
      }
      if (moonStyle == 2.0) color = mix(moonColor*(0.6+regions),vec3(0.12,0.07,0.035),smoothstep(0.66,0.75,noise3(p*24.0+bodySeed)));
      if (moonStyle == 3.0) color = moonColor*(0.8+fbm(p*vec3(12.0,4.0,12.0)+bodySeed)*0.35);
      if (moonStyle == 4.0) color *= mix(0.18,1.3,smoothstep(-0.1,0.12,p.x));
    #endif
    #ifdef SURFACE_MAP
    }
    #endif
    vec3 geometric = normalize(vNormal);
    vec3 normal = geometric;
    vec3 dpdx = dFdx(vWorldPosition), dpdy = dFdy(vWorldPosition);
    vec3 r1 = cross(dpdy,normal), r2 = cross(normal,dpdx);
    float determinant = dot(dpdx,r1);
    vec3 gradient = sign(determinant)*(dFdx(height)*r1+dFdy(height)*r2);
    normal = normalize(max(abs(determinant),0.0000001)*normal-0.012*bodyRadius*gradient);
    #ifdef SURFACE_MAP
      if (mapReady > 0.001) {
        vec3 photo = sampleMap(detailMap, uv, mapSize, gx, gy, seam).rgb;
        // Grain only exists beyond the map's native resolution; skip it entirely otherwise.
        vec4 grain = magnify > 0.0 ? surfaceDetail(p, mapSize.x / 6.2832, footprint, magnify, detailStretch, bodySeed, detailRidges) : vec4(0.0);
        vec3 slope = grain.yzw * mapGrain * 2.5;
        if (mapRelief > 0.0) {
          // Map brightness read as relief, differenced in texture space: smooth per-pixel normals, no 2x2 blocks.
          float stepTexels = max(1.0, texels);
          vec2 du = vec2(stepTexels / mapSize.x, 0.0), dv = vec2(0.0, stepTexels / mapSize.y);
          float contrast = 1.0 / (mapLuminance(photo) + 0.04);
          float east = (mapLuminance(textureLod(detailMap, uv + du, reliefLod).rgb) - mapLuminance(textureLod(detailMap, uv - du, reliefLod).rgb)) * contrast;
          float north = (mapLuminance(textureLod(detailMap, uv + dv, reliefLod).rgb) - mapLuminance(textureLod(detailMap, uv - dv, reliefLod).rgb)) * contrast;
          float ring = length(p.xz);
          vec3 eastward = vec3(p.z, 0.0, -p.x) / max(ring, 0.0001);
          vec3 northward = cross(p, eastward);
          slope += mapRelief * (east * mapSize.x / (12.566 * max(ring, 0.15) * stepTexels) * eastward
            + north * mapSize.y / (6.2832 * stepTexels) * northward);
        }
        slope -= p * dot(slope, p);
        // Bound image-derived relief so dark photo features do not become deep grooves.
        slope *= inversesqrt(1.0 + dot(slope, slope) / 0.36);
        vec3 photoNormal = normalize(geometric - mat3(vAxisX, vAxisY, vAxisZ) * slope);
        color = mix(color, photo * mapTint * (1.0 + grain.x * mapGrain * 2.2), mapReady);
        normal = normalize(mix(normal, photoNormal, mapReady));
      }
    #endif
    // Detail normals never light terrain beyond the geometric terminator.
    float diffuse = max(dot(normal,sunDirection),0.0)*smoothstep(-0.12,0.04,dot(geometric,sunDirection));
    #if BODY_KIND == 4
      float planeAngle = dot(sunDirection,planetAxis);
      float safeAngle = (planeAngle<0.0 ? -1.0 : 1.0)*max(abs(planeAngle),0.001);
      vec3 relative = (vWorldPosition-planetCenter)/bodyRadius;
      float t = -dot(relative,planetAxis)/safeAngle;
      float r = length(relative+sunDirection*t);
      // Derivatives are evaluated before branching, including at the terminator.
      float ringFootprint = max(fwidth(r),solarAngularRadius*abs(t)/max(abs(planeAngle),0.015));
      if(t>0.0 && abs(planeAngle)>0.001) {
        diffuse *= mix(1.0,ringTransmittance(r,ringFootprint,abs(planeAngle)),ringsEnabled);
      }
    #endif
    #include <logdepthbuf_fragment>
    #ifdef BARNARD_ROCK
    // Host-spectrum tint is shared with ship and surface lighting. Dry regolith
    // has a restrained neutral night floor, with no invented lava emission.
    gl_FragColor = vec4(max(color*(vec3(0.0035)+illuminantTint*diffuse*1.05),vec3(0.0)),1.0);
    #else
    gl_FragColor = vec4(max(color*(0.009+diffuse*1.05),vec3(0.0)),1.0);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #endif
  }
`;

export const atmosphereFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDirection;
  uniform vec3 atmosphereColor;
  uniform vec3 planetCenter;
  uniform float bodyRadius;
  uniform float atmosphereHeight;
  uniform float strength;
  uniform float uTime;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vLocalPosition;
  ${atmosphereScattering}
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 ray = normalize(vWorldPosition-cameraPosition);
    #ifdef SOLAR_CORONA
      float impact = length(cross(cameraPosition-planetCenter,ray))/bodyRadius;
      #ifdef BARNARD_CORONA
      float envelope = exp(-max(impact-1.0,0.0)*46.0)*(1.0-smoothstep(1.035,1.09,impact));
      float streamers = 0.94+0.06*sin(normal.y*31.0+normal.x*17.0+uTime*0.025);
      vec3 color = atmosphereColor*1.25;
      float opacity = envelope*strength*streamers*0.42;
      #else
      float envelope = exp(-max(impact-1.0,0.0)*18.0)*(1.0-smoothstep(1.08,1.2,impact));
      float streamers = 0.85+0.15*sin(normal.y*38.0+normal.x*21.0+uTime*0.08);
      vec3 color = atmosphereColor*1.6;
      float opacity = envelope*strength*streamers*0.68;
      #endif
    #else
      vec3 origin = (cameraPosition-planetCenter)/bodyRadius;
      vec4 scattering = scatterAtmosphere(normalize(origin), max(0.0, length(origin)-1.0),
        ray, 1.0, atmosphereHeight, sunDirection, atmosphereColor, strength);
      vec3 color = scattering.rgb;
      float opacity = scattering.a;
    #endif
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(color,opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudsFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDirection;
  uniform float uTime;
  uniform vec3 bodySeed;
  uniform vec4 bodyWeather;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  ${noise}
  void main() {
    vec3 p = normalize(vLocalPosition);
    vec3 circulation = bodySeed+vec3(0.0,0.0,uTime*bodyWeather.z);
    float clouds = fbm(p*vec3(bodyWeather.w,bodyWeather.w*2.0,bodyWeather.w)+circulation);
    float diffuse = max(dot(normalize(vNormal),sunDirection),0.0);
    #ifdef VENUS_CLOUDS
      float swirl = fbm(p*bodyWeather.w+circulation+(clouds-0.5)*bodyWeather.y);
      vec3 color = mix(vec3(0.67,0.45,0.21),vec3(0.96,0.85,0.62),swirl*0.75+0.15);
      #include <logdepthbuf_fragment>
    gl_FragColor = vec4(color*(0.06+diffuse*1.15),0.995);
    #else
      float streaks = fbm(p*vec3(bodyWeather.w,bodyWeather.x*3.0,bodyWeather.w)+circulation);
      #include <logdepthbuf_fragment>
    gl_FragColor = vec4(vec3(0.72,0.83,0.92)*(0.035+diffuse*1.15),smoothstep(0.52,0.72,streaks)*0.45);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ringFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform vec3 sunDirection;
  uniform vec3 planetAxis;
  uniform vec3 planetCenter;
  uniform float bodyRadius;
  uniform float solarAngularRadius;
  uniform float planetFlattening;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;
  ${noise}
  ${saturnRingOptics}
  float particlePhase(float cosine, float asymmetry) {
    return (1.0-asymmetry*asymmetry)/pow(max(1.0+asymmetry*asymmetry
      -2.0*asymmetry*cosine,0.04),1.5);
  }
  void main() {
    float radius = length(vLocalPosition);
    float footprint = max(fwidth(radius),0.000001);
    float tau = ringOpticalDepth(radius,footprint);
    // Subtle non-axisymmetric clumps break perfect concentric lines. Unresolved
    // grains average out; kilometre-sized rocks would be misleading at this scale.
    vec3 grainPosition = vec3(vLocalPosition.xy*1100.0,radius*2100.0);
    float grainFootprint = max(length(dFdx(grainPosition)),length(dFdy(grainPosition)));
    float grain = (noise3(grainPosition)-0.5)*exp(-0.5*grainFootprint*grainFootprint);
    tau *= 1.0+grain*0.22;
    // Ice albedo and dust contamination are independent of optical depth.
    vec3 color = mix(vec3(0.40,0.34,0.27),vec3(0.72,0.69,0.61),smoothstep(1.56,1.62,radius));
    color = mix(color,vec3(0.62,0.60,0.54),smoothstep(2.01,2.12,radius));
    float iceVariation = 0.09*ringLine(radius,61.0,1.2,footprint)
      + 0.045*ringLine(radius,163.0,0.5,footprint)
      + 0.055*ringLine(radius,509.0,2.5,footprint)
      + 0.035*ringLine(radius,1481.0,0.3,footprint);
    vec3 clumpPosition = vec3(vLocalPosition.xy*180.0,radius*380.0);
    float clumpFootprint = max(length(dFdx(clumpPosition)),length(dFdy(clumpPosition)));
    float clumps = (noise3(clumpPosition)-0.5)*exp(-0.5*clumpFootprint*clumpFootprint);
    color *= 1.0+iceVariation+clumps*0.10+grain*0.12;
    // Evaluate closest approach in the oblate planet's unit-sphere space.
    // The finite solar disk and pixel footprint soften the far end of the shadow.
    vec3 relative = (vWorldPosition-planetCenter)/bodyRadius;
    vec3 q = relative + planetAxis * dot(relative,planetAxis) * (1.0/planetFlattening-1.0);
    vec3 ray = sunDirection + planetAxis * dot(sunDirection,planetAxis) * (1.0/planetFlattening-1.0);
    float along = max(0.0, -dot(q,ray)/dot(ray,ray));
    float clearance = length(q+ray*along);
    float penumbra = max(fwidth(clearance)*0.75, solarAngularRadius*along*length(ray));
    penumbra = max(penumbra, 0.00001);
    float visibility = smoothstep(1.0-penumbra,1.0+penumbra,clearance);
    vec3 viewDirection = normalize(cameraPosition-vWorldPosition);
    float lightSide = dot(sunDirection,planetAxis);
    float viewSide = dot(viewDirection,planetAxis);
    float mu0 = max(abs(lightSide),0.015);
    float mu = max(abs(viewSide),0.015);
    float opacity = 1.0-exp(-tau/mu);
    if(opacity<0.0001) discard;
    // Integrate single scattering through a thin particulate slab, separately
    // for reflected sunlight and light transmitted to the unlit side.
    float reflection = mu0/(mu0+mu)*(1.0-exp(-tau*(1.0/mu0+1.0/mu)));
    float inverseDifference = 1.0/mu-1.0/mu0;
    float transmission;
    if(abs(inverseDifference)<0.01) {
      float meanMu = (mu+mu0)*0.5;
      transmission = tau/meanMu*exp(-tau/meanMu);
    } else {
      transmission = (exp(-tau/mu0)-exp(-tau/mu))/(mu*inverseDifference);
    }
    float cosine = dot(-sunDirection,viewDirection);
    float phase = 0.54+0.30*particlePhase(cosine,-0.25)+0.16*particlePhase(cosine,0.65);
    float scattering = lightSide*viewSide>0.0 ? reflection : transmission;
    // Weak planetshine falls with radius and vanishes over Saturn's night side.
    float planetshine = 0.012*max(dot(normalize(relative),sunDirection),0.0)/(radius*radius);
    vec3 radiance = color*(visibility*scattering*phase*1.10
      + opacity*(0.002+planetshine));
    #include <logdepthbuf_fragment>
    // The slab integral already includes extinction. Premultiplied blending adds
    // this radiance once and attenuates the background by the remaining opacity.
    gl_FragColor = vec4(radiance,opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createMapUniforms(surfaceMap: SurfaceMap, map?: THREE.Texture): SurfaceMapUniforms {
  return {
    detailMap: { value: map ?? null },
    mapSize: { value: textureSize(map, surfaceMap) },
    mapReady: { value: map ? 1 : 0 },
    mapTint: { value: new THREE.Vector3(...(surfaceMap.tint ?? [1, 1, 1])) },
    mapOffset: { value: surfaceMap.offset ?? 0 },
    mapRelief: { value: surfaceMap.relief },
    mapGrain: { value: surfaceMap.grain },
    mapStreaks: { value: surfaceMap.streaks ? 1 : 0 },
  };
}
function textureSize(map: THREE.Texture | null | undefined, surfaceMap: SurfaceMap) {
  const image = map?.image as { width?: number; height?: number } | undefined;
  return new THREE.Vector2(image?.width || surfaceMap.width, image?.height || surfaceMap.width / 2);
}
/** Swap a model's map in place; ready fades from procedural (0) to the map (1). */
export function setSurfaceMap(model: PlanetModel, map: THREE.Texture | null, ready: number) {
  if (!model.mapUniforms || !model.surfaceMap) return;
  model.mapUniforms.detailMap.value = map;
  model.mapUniforms.mapSize.value.copy(textureSize(map, model.surfaceMap));
  model.mapUniforms.mapReady.value = map ? ready : 0;
}

export function createPlanetModel(
  body: CelestialBody,
  sunDirection: THREE.Vector3,
  placement = { center: new THREE.Vector3(), radius: 1 },
  map?: THREE.Texture,
): PlanetModel {
  if (body.kind === "black-hole") return createBlackHoleModel(body);
  if (body.kind === "station") return createStationModel(body);
  if (body.systemId === "echo-rift") return createEchoModel(body, sunDirection, placement,
    { vertex: modelVertex, noise, atmosphere: atmosphereFragment });
  const kinds = {
    mercury: 0,
    ceres: 8,
    venus: 1,
    mars: 2,
    jupiter: 3,
    saturn: 4,
    uranus: 5,
    neptune: 6,
    sun: 7,
  };
  if (body.id === "earth")
    throw new Error("Earth requires its photographic texture model.");
  const group = new THREE.Group();
  group.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDeg);
  const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(
    new THREE.Vector3(0, 0, 1),
    group.rotation.z,
  );
  const uTime = { value: 0 },
    ringsEnabled = { value: 1 };
  const surfaceMap = SURFACE_MAPS[body.id];
  const profile = proceduralBodyProfile(body);
  const proceduralUniforms = {
    solarAngularRadius: { value: 0.00465 / Math.max(body.distanceFromSunMillionKm / 149.5978707, 0.01) },
    bodySeed: { value: new THREE.Vector3(...profile.seed) },
    bodyTerrain: { value: new THREE.Vector4(...profile.terrain) },
    bodyWeather: { value: new THREE.Vector4(...profile.weather) },
    detailStretch: { value: new THREE.Vector3(...profile.stretch) },
    detailRidges: { value: profile.ridgeMix },
  };
  const mapUniforms = surfaceMap ? createMapUniforms(surfaceMap, map) : undefined;
  // Venus shows its imaged cloud deck; the procedural surface stays beneath it.
  const mapOnSurface = mapUniforms && body.id !== "venus";
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 128),
    new THREE.ShaderMaterial({
      vertexShader: modelVertex,
      fragmentShader: planetFragment,
      defines: {
        BODY_KIND: body.kind === "star" ? 7 : body.parentId ? 8 : body.systemId && body.systemId !== "solar" ? body.surfaceStyle === 6 ? 6 : 9 : kinds[body.id as keyof typeof kinds],
        ...(mapOnSurface ? { SURFACE_MAP: 1 } : {}),
        ...(body.id === "betelgeuse" ? { RED_SUPERGIANT: 1 } : {}),
        ...(body.id === "barnard-star" ? { BARNARD_RED_DWARF: 1 } : body.systemId === "barnard" ? { BARNARD_ROCK: 1 } : {}),
      },
      uniforms: {
        ...proceduralUniforms,
        ...(mapOnSurface ? mapUniforms : {}),
        sunDirection: { value: sunDirection },
        planetAxis: { value: axis },
        planetCenter: { value: placement.center },
        bodyRadius: { value: placement.radius },
        uTime,
        ringsEnabled,
        moonColor: { value: new THREE.Color(body.color) },
        moonSeed: { value: profile.grainSeed },
        moonStyle: { value: body.surfaceStyle ?? 0 },
        stellarTint: { value: new THREE.Color(body.color) },
        illuminantTint: { value: new THREE.Color(body.systemId === "barnard" ? BARNARD_LIGHT_COLOR : "#ffffff") },
        stellarIllustration: { value: body.kind === "star" ? 1 : 0 },
      },
    }),
  );
  surface.scale.y = body.flattening;
  surface.rotation.y = -0.4;
  group.add(surface);
  const model: PlanetModel = {
    body,
    group,
    surface,
    layers: {},
    spinning: [{ object: surface, rate: body.rotationSpeed }],
    timeUniforms: [uTime],
    ringsEnabled,
    surfaceMap,
    mapUniforms,
  };
  if (body.layers.includes("atmosphere")) {
    const solar = body.id === "sun" || body.kind === "star";
    // The shell slightly circumscribes the analytic atmosphere so coarse distant meshes never facet its edge.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry((solar ? body.id === "barnard-star" ? 1.10 : 1.23 : 1 + (body.atmosphereKm ?? 90) / body.radiusKm) * 1.02, 96, 64),
      new THREE.ShaderMaterial({
        vertexShader: modelVertex,
        fragmentShader: atmosphereFragment,
        defines: solar ? { SOLAR_CORONA: 1, ...(body.id === "barnard-star" ? { BARNARD_CORONA: 1 } : {}) } : {},
        uniforms: {
          sunDirection: { value: sunDirection },
          planetCenter: { value: placement.center },
          bodyRadius: { value: placement.radius },
          atmosphereColor: {
            value: new THREE.Color(solar ? body.id === "sun" ? "#ff8f2c" : body.color : surfaceProfile(body.id).sky),
          },
          atmosphereHeight: { value: (body.atmosphereKm ?? 90) / body.radiusKm },
          strength: { value: solar ? body.id === "barnard-star" ? 0.32 : 0.95 : atmosphereStrength(body.id) },
          uTime,
        },
        side: solar ? THREE.BackSide : THREE.FrontSide,
        transparent: true,
        depthWrite: false,
        blending: solar ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    halo.scale.y = body.flattening;
    const atmosphere = new THREE.Group();
    atmosphere.add(halo);
    group.add(atmosphere);
    model.layers.atmosphere = atmosphere;
  }
  if (body.id === "venus" || body.id === "neptune") {
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.007, 128, 96),
      new THREE.ShaderMaterial({
        vertexShader: modelVertex,
        fragmentShader: cloudsFragment,
        defines: body.id === "venus" ? { VENUS_CLOUDS: 1 } : {},
        uniforms: { ...proceduralUniforms, sunDirection: { value: sunDirection }, uTime },
        transparent: true,
        depthWrite: false,
      }),
    );
    if (mapUniforms && body.id === "venus") {
      clouds.material.fragmentShader = planetFragment;
      clouds.material.defines = { BODY_KIND: 1, SURFACE_MAP: 1 };
      Object.assign(clouds.material.uniforms, mapUniforms, {
        planetAxis: { value: axis },
        planetCenter: { value: placement.center },
        bodyRadius: { value: placement.radius },
        ringsEnabled,
        moonColor: { value: new THREE.Color(body.color) },
        moonSeed: { value: profile.grainSeed },
        moonStyle: { value: 0 },
        stellarTint: { value: new THREE.Color(body.color) },
        stellarIllustration: { value: 0 },
      });
    }
    clouds.scale.y = body.flattening;
    group.add(clouds);
    model.layers.clouds = clouds;
    model.spinning.push({ object: clouds, rate: body.rotationSpeed * 1.1 });
  }
  if (body.id === "saturn") {
    const rings = new THREE.Mesh(
      new THREE.RingGeometry(SATURN_RING_INNER, SATURN_RING_OUTER, 512),
      new THREE.ShaderMaterial({
        vertexShader: modelVertex,
        fragmentShader: ringFragment,
        uniforms: {
          sunDirection: { value: sunDirection },
          solarAngularRadius: proceduralUniforms.solarAngularRadius,
          planetFlattening: { value: body.flattening },
          planetAxis: { value: axis },
          planetCenter: { value: placement.center },
          bodyRadius: { value: placement.radius },
        },
        side: THREE.DoubleSide,
        forceSinglePass: true,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
      }),
    );
    rings.rotation.x = -Math.PI / 2;
    group.add(rings);
    model.layers.rings = rings;
  }
  if (body.id === "sun") {
    const flares = new THREE.Group();
    const flareGeometries: THREE.BufferGeometry[] = [];
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.5, 0.45, 0.04),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.399;
      const normal = new THREE.Vector3(
        Math.cos(angle),
        Math.sin(angle),
        Math.sin(i * 1.71) * 0.4,
      ).normalize();
      const tangent = new THREE.Vector3()
        .crossVectors(normal, new THREE.Vector3(0, 0, 1))
        .normalize();
      const a = normal.clone().addScaledVector(tangent, -0.055).normalize();
      const b = normal.clone().multiplyScalar(1.11 + Math.sin(i * 2.1) * 0.035);
      const c = normal.clone().addScaledVector(tangent, 0.055).normalize();
      flareGeometries.push(
        new THREE.TubeGeometry(
          new THREE.QuadraticBezierCurve3(a, b, c),
          32,
          0.0025,
          6,
          false,
        ),
      );
    }
    flares.add(new THREE.Mesh(mergeGeometries(flareGeometries)!, material));
    flareGeometries.forEach(geometry => geometry.dispose());
    model.layers.atmosphere!.add(flares);
    model.spinning.push({ object: flares, rate: body.rotationSpeed });
  }
  return model;
}
