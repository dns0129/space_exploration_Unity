import * as THREE from "three";
import type { PlanetModel } from "./planet-models";

type ShaderSources = { vertex: string; noise: string; atmosphere: string };

/** Blue-white plasma, tilted magnetic jets and a faint equatorial dust veil. */
export function configurePulsarModel(model: PlanetModel,
  uniforms: Record<string, THREE.IUniform>, sources: ShaderSources): void {
  const common = `#include <logdepthbuf_pars_fragment>
    uniform float uTime; uniform vec3 planetCenter; uniform float bodyRadius;
    varying vec2 vUv; varying vec3 vLocalPosition, vWorldPosition, vNormal;
    ${sources.noise}`;
  const output = `#include <logdepthbuf_fragment>
    gl_FragColor = vec4(color, opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>`;
  (model.surface.material as THREE.ShaderMaterial).fragmentShader = `${common} void main() {
    vec3 p = normalize(vLocalPosition);
    vec3 drift = vec3(0.0, uTime * 0.012, 0.0);
    vec3 warp = vec3(fbm(p * 5.0 + drift + 17.0),
      fbm(p * 5.0 + drift + 43.0), fbm(p * 5.0 + drift + 71.0));
    float plasma = fbm(p * 3.6 + warp * 1.8);
    float phase = plasma * 36.0 + p.y * 4.0;
    float filament = abs(sin(phase));
    float filterWidth = min(fwidth(phase), 0.25);
    float lace = 1.0-smoothstep(0.06, 0.19 + filterWidth, filament);
    lace *= 0.5 + 0.5 * noise3(p * 19.0 + warp * 2.0);
    float cells = fbm(p * 15.0 + warp * 3.0);
    float facing = max(dot(normalize(vNormal), normalize(cameraPosition-vWorldPosition)), 0.0);
    float rim = 1.0-smoothstep(0.03, 0.42, facing);
    float pulse = 0.97 + 0.03 * sin(uTime * 7.3);
    vec3 color = mix(vec3(0.025, 0.045, 0.16), vec3(0.31, 0.27, 0.57), plasma);
    color *= 0.75 + cells * 0.7;
    color += vec3(0.70, 0.86, 1.32) * lace * 1.65;
    color += vec3(2.5, 3.0, 3.45) * rim * (0.8 + cells * 0.35);
    color *= pulse;
    float opacity = 1.0;
    ${output}
  }`;

  const magnetosphere = new THREE.Group();
  magnetosphere.rotation.set(0.24, 0, -0.42);
  const jets = new THREE.Group();
  jets.name = "pulsar-jets";
  // Baked geometry dimensions survive the flight renderer's spherical LOD pass.
  for (const sign of [-1, 1]) {
    const pole = new THREE.Group();
    if (sign < 0) pole.rotation.z = Math.PI;
    for (const shell of [
      { base: 0.025, tip: 0.055, opacity: 0.98, color: new THREE.Vector3(2.5, 3.2, 4.0) },
      { base: 0.055, tip: 0.11, opacity: 0.27, color: new THREE.Vector3(0.7, 1.25, 2.1) },
      { base: 0.13, tip: 0.23, opacity: 0.075, color: new THREE.Vector3(0.23, 0.52, 1.25) },
    ]) {
      const material = new THREE.ShaderMaterial({ vertexShader: sources.vertex,
        fragmentShader: `${common}
          uniform vec3 beamColor; uniform float beamOpacity;
          void main() {
            float along = vUv.y;
            float envelope = smoothstep(0.0, 0.07, along) * (1.0-smoothstep(0.68, 1.0, along));
            float facing = abs(dot(normalize(vNormal), normalize(cameraPosition-vWorldPosition)));
            float strand = 0.84 + 0.16 * sin(along * 67.0 - uTime * 3.0 + vUv.x * 12.0);
            float pulse = 0.90 + 0.10 * sin(uTime * 7.3 - along * 3.0);
            vec3 color = beamColor;
            float opacity = beamOpacity * envelope * pow(facing, 2.8) * strand * pulse;
            ${output}
          }`, uniforms: { ...uniforms, beamColor: { value: shell.color }, beamOpacity: { value: shell.opacity } },
        side: THREE.DoubleSide, forceSinglePass: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const geometry = new THREE.CylinderGeometry(shell.tip, shell.base, 3.5, 40, 96, true);
      const positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i), t = (y + 1.75) / 3.5;
        const ripple = 0.94 + 0.06 * Math.sin(t * 51);
        positions.setXYZ(i, positions.getX(i) * ripple + 0.009 * Math.sin(t * 22), y,
          positions.getZ(i) * ripple + 0.006 * Math.sin(t * 32));
      }
      geometry.computeVertexNormals();
      const beam = new THREE.Mesh(geometry, material);
      beam.position.y = 2.65;
      pole.add(beam);
    }
    jets.add(pole);
  }
  magnetosphere.add(jets);

  const nebula = new THREE.Group();
  nebula.name = "pulsar-nebula";
  const dust = new THREE.Mesh(new THREE.RingGeometry(0.88, 3.45, 192, 32),
    new THREE.ShaderMaterial({ vertexShader: sources.vertex,
      fragmentShader: `${common} void main() {
        vec2 p = vLocalPosition.xy;
        float r = length(p);
        float angle = atan(p.y, p.x);
        float cloud = fbm(vec3(p * 2.0, 24.0));
        float wisps = fbm(vec3(p * 7.0, 8.0 + uTime * 0.006));
        float spiral = pow(0.5 + 0.5 * sin(r * 22.0 + angle * 4.0 + cloud * 9.0), 5.0);
        float radial = smoothstep(0.88, 1.13, r) * (1.0-smoothstep(1.85, 3.45, r));
        float broken = smoothstep(0.20, 0.68, cloud);
        vec3 color = mix(vec3(0.24, 0.28, 0.34), vec3(0.86, 0.73, 0.52), cloud);
        float opacity = radial * broken * (0.12 + wisps * 0.29 + spiral * 0.15);
        ${output}
      }`, uniforms, side: THREE.DoubleSide, forceSinglePass: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.rotation.x = Math.PI / 2;
  nebula.add(dust);
  magnetosphere.add(nebula);

  const corona = new THREE.Mesh(new THREE.SphereGeometry(1.35, 80, 56),
    new THREE.ShaderMaterial({ vertexShader: sources.vertex,
      fragmentShader: `${common} void main() {
        vec3 ray = normalize(vWorldPosition-cameraPosition);
        float impact = length(cross(planetCenter-cameraPosition, ray)) / bodyRadius;
        vec3 p = normalize(vWorldPosition-planetCenter);
        float grain = noise3(p * 65.0 + vec3(0.0, uTime * 0.025, 9.0));
        float fringe = 0.88 + grain * 0.24;
        float edge = exp(-max(impact-1.0, 0.0) * 44.0);
        float veil = exp(-max(impact-1.0, 0.0) * 10.0);
        vec3 color = mix(vec3(0.22, 0.43, 1.0), vec3(2.0, 2.5, 3.0), edge);
        float opacity = (edge * 0.83 + veil * 0.11) * fringe * (1.0-smoothstep(1.15, 1.35, impact));
        ${output}
      }`, uniforms, side: THREE.BackSide, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
  corona.name = "pulsar-corona";
  magnetosphere.add(corona);
  model.group.add(magnetosphere);
  model.layers.atmosphere = magnetosphere;
  model.spinning.push({ object: magnetosphere, rate: 0.09 });
}
