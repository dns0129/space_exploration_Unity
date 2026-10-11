import * as THREE from "three";
import type { PlanetModel } from "./planet-models";
import type { CelestialBody } from "./solar-system";
import { echoSurfaceColor, echoTerrainTexture } from "./echo-surface";
import { terrainHeightField } from "../shared/surface.mjs";
import { configurePulsarModel } from "./pulsar-model";
import { configureShatteredModel } from "./shattered-model";

type Placement = { center: THREE.Vector3; radius: number };
type ShaderSources = { vertex: string; noise: string; atmosphere: string };

/** Original fictional bodies, kept in the existing kilometre-based renderer. */
export function createEchoModel(body: CelestialBody, sun: THREE.Vector3,
  placement: Placement, sources: ShaderSources): PlanetModel {
  const group = new THREE.Group();
  group.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDeg);
  const time = { value: 0 };
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: time, sunDirection: { value: sun }, planetCenter: { value: placement.center },
    bodyRadius: { value: placement.radius },
  };
  const common = `#include <logdepthbuf_pars_fragment>
    uniform float uTime; uniform vec3 sunDirection, planetCenter; uniform float bodyRadius;
    varying vec2 vUv; varying vec3 vLocalPosition, vWorldPosition, vNormal;
    ${sources.noise}`;
  const ending = `#include <logdepthbuf_fragment>
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>`;
  const material = new THREE.ShaderMaterial({ vertexShader: sources.vertex, uniforms,
    fragmentShader: `${common} void main() { vec3 color = vec3(0.5); ${ending} }` });
  const surface = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(new THREE.SphereGeometry(1, 160, 112), material);
  surface.rotation.y = -0.4;
  surface.scale.y = body.flattening;
  group.add(surface);
  const model: PlanetModel = { body, group, surface, layers: {},
    spinning: [{ object: surface, rate: body.rotationSpeed }], timeUniforms: [time] };
  if (body.id === "echo-pulsar") {
    configurePulsarModel(model, uniforms, sources);
  } else if (body.id === "veyl") {
    material.fragmentShader = `${common} void main() {
      vec3 p = normalize(vLocalPosition);
      float turbulence = fbm(p * vec3(8.0, 19.0, 8.0) + vec3(23.0, 1.0, 4.0));
      float latitude = p.y + (turbulence - 0.48) * 0.115;
      float bands = 0.5 + 0.5 * sin(latitude * 56.0 + fbm(p * 23.0) * 3.0);
      vec3 color = mix(vec3(0.024, 0.12, 0.17), vec3(0.30, 0.54, 0.53), smoothstep(0.10, 0.90, bands));
      color = mix(color, vec3(0.76, 0.58, 0.31), smoothstep(0.77, 0.94, sin(latitude*24.0 + turbulence*3.0) * 0.5 + 0.5) * 0.78);
      vec2 storm = vec2(fract(vUv.x - 0.67 + 0.5) - 0.5, vUv.y - 0.43) / vec2(0.085, 0.048);
      float d = length(storm);
      float spiral = sin(d * 19.0 - atan(storm.y, storm.x) * 3.0 + turbulence * 8.0);
      color = mix(color, mix(vec3(0.10, 0.27, 0.29), vec3(0.86, 0.74, 0.49), spiral * 0.5 + 0.5), (1.0-smoothstep(0.72, 1.24, d)) * 0.85);
      color *= 0.87 + noise3(p * 340.0) * 0.17;
      float day = max(dot(normalize(vNormal), sunDirection), 0.0);
      color *= 0.022 + day * 1.18;
      ${ending} }`;
  } else if (body.id === "echo-thalassa" || body.id === "cinder") {
    const texture = echoTerrainTexture(body.id);
    model.ownedTextures = [texture];
    uniforms.echoTerrain = { value: texture };
    uniforms.oceanMoon = { value: body.id === "echo-thalassa" ? 1 : 0 };
    uniforms.echoRelief = { value: terrainHeightField(body.id)!.heightScaleKm / body.radiusKm };
    // Orbit and the local globe displace from precisely the same fixed field.
    material.vertexShader = sources.vertex
      .replace("void main()", "uniform sampler2D echoTerrain; uniform float echoRelief; void main()")
      .replace("vec4 world = modelMatrix * vec4(position, 1.0);",
        "vec3 displaced = position * (1.0 + texture2D(echoTerrain, uv).r * echoRelief); vec4 world = modelMatrix * vec4(displaced, 1.0);");
    material.fragmentShader = `${common}
      uniform sampler2D echoTerrain; uniform float oceanMoon;
      ${echoSurfaceColor}
      void main() {
        vec3 p = normalize(vLocalPosition);
        vec2 field = texture2D(echoTerrain, vUv).rg;
        vec3 color = echoLandColor(p, field.r, field.g, oceanMoon);
        float day = max(dot(normalize(vNormal), sunDirection), 0.0);
        color *= 0.018 + day * 1.15;
        vec3 view = normalize(cameraPosition - vWorldPosition);
        float glint = pow(max(dot(reflect(-sunDirection, normalize(vNormal)), view), 0.0), 110.0);
        color += vec3(0.35, 0.55, 0.62) * glint * field.g * oceanMoon * day;
        ${ending} }`;
  } else {
    configureShatteredModel(model, uniforms, sources);
  }
  if (body.id === "veyl" || body.id === "echo-thalassa") {
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.025, 80, 56),
      new THREE.ShaderMaterial({ vertexShader: sources.vertex, fragmentShader: sources.atmosphere,
        uniforms: { ...uniforms, atmosphereColor: { value: new THREE.Color(body.atmosphereColor ?? "#70bcca") },
          atmosphereHeight: { value: (body.atmosphereKm ?? 100) / body.radiusKm }, strength: { value: 1.2 } },
        transparent: true, depthWrite: false }));
    atmosphere.scale.y = body.flattening;
    group.add(atmosphere); model.layers.atmosphere = atmosphere;
  }
  return model;
}
