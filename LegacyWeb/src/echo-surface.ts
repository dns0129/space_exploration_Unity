import * as THREE from "three";
import { terrainHeightField } from "../shared/surface.mjs";
import type { BodyId } from "./solar-system";

/** The same fixed height/water field drives orbit colour, local colour and collision. */
export function echoTerrainTexture(id: BodyId): THREE.DataTexture {
  const field = terrainHeightField(id)!;
  const pixels = new Uint8Array(field.width * field.height * 4);
  for (let i = 0; i < field.data.length; i++) {
    pixels[i * 4] = field.data[i];
    pixels[i * 4 + 1] = field.waterMask?.[i] ?? 0;
    pixels[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, field.width, field.height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export const echoSurfaceColor = /* glsl */ `
  float echoGrain(vec3 p) {
    return sin(p.x * 1.7 + sin(p.y * 2.1)) * sin(p.z * 1.9 + sin(p.x * 1.3)) * 0.5 + 0.5;
  }
  vec3 echoLandColor(vec3 p, float h, float water, float oceanMoon) {
    float grain = echoGrain(p * 230.0);
    float strata = 0.5 + 0.5 * sin(h * 125.0 + echoGrain(p * 42.0) * 7.0);
    if (oceanMoon > 0.5) {
      vec3 land = mix(vec3(0.17, 0.23, 0.21), vec3(0.43, 0.46, 0.36), smoothstep(0.03, 0.65, h));
      land = mix(vec3(0.44, 0.38, 0.25), land, smoothstep(0.012, 0.11, h));
      land = mix(land, vec3(0.69, 0.76, 0.74), smoothstep(0.60, 0.85, h));
      vec3 sea = mix(vec3(0.012, 0.045, 0.085), vec3(0.025, 0.23, 0.25), smoothstep(0.0, 0.025, h));
      return mix(land * (0.87 + grain * 0.19 + strata * 0.07), sea, smoothstep(0.32, 0.70, water));
    }
    vec3 basalt = mix(vec3(0.075, 0.065, 0.072), vec3(0.39, 0.22, 0.13), smoothstep(0.1, 0.65, h));
    basalt = mix(basalt, vec3(0.66, 0.50, 0.32), smoothstep(0.63, 0.89, h));
    return basalt * (0.82 + grain * 0.22 + strata * 0.13);
  }
`;
