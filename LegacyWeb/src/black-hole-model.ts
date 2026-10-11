import * as THREE from "three";
import type { PlanetModel } from "./planet-models";
import type { CelestialBody } from "./solar-system";

/**
 * Fixed 3D disk, linear HDR emission and observer-dependent Doppler contrast.
 * Disk images use analytic artistic approximations,
 * not GR geodesics. Units describe the apparent shadow, not a measured horizon.
 * The quad is a ray viewport; no static picture or whole-model spin is used.
 */
export function createBlackHoleModel(body: CelestialBody): PlanetModel {
  const group = new THREE.Group();
  const time = { value: 0 };
  const uniforms = {
    uTime: time,
    eye: { value: new THREE.Vector3() },
    right: { value: new THREE.Vector3() },
    up: { value: new THREE.Vector3() },
    forward: { value: new THREE.Vector3() },
  };
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform vec3 right, up;
      varying vec3 rayPoint;
      void main() {
        rayPoint = right * position.x + up * position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(rayPoint, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 eye, right, up, forward;
      varying vec3 rayPoint;

      float plasmaHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float plasmaNoise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(plasmaHash(cell), plasmaHash(cell + vec2(1.0, 0.0)), f.x),
                   mix(plasmaHash(cell + vec2(0.0, 1.0)), plasmaHash(cell + vec2(1.0)), f.x), f.y);
      }
      float turbulence(vec2 p) {
        return plasmaNoise(p) * 0.57
          + plasmaNoise(p * 2.07 + vec2(7.3, 11.8)) * 0.28
          + plasmaNoise(p * 4.31 + vec2(19.1, 3.7)) * 0.15;
      }
      float angleFootprint(float angle) {
        // atan wraps at +/- pi. Wrapped derivatives avoid a false dark seam.
        vec2 gradient = vec2(dFdx(angle), dFdy(angle));
        gradient -= 6.28318530718 * floor(gradient / 6.28318530718 + 0.5);
        return max(abs(gradient.x), abs(gradient.y));
      }
      float filament(float phase, float footprint) {
        return sin(phase) * exp(-pow(footprint * 0.32, 2.0));
      }
      float diskMask(float r) {
        return smoothstep(1.28, 1.44, r) * (1.0 - smoothstep(3.7, 4.4, r));
      }
      vec3 thermalColor(float heat) {
        // Linear-light thermal palette, not a spectral blackbody integration.
        vec3 red = mix(vec3(0.42, 0.012, 0.002), vec3(1.0, 0.16, 0.014), smoothstep(0.0, 0.38, heat));
        vec3 gold = mix(red, vec3(1.0, 0.57, 0.19), smoothstep(0.27, 0.66, heat));
        return mix(gold, vec3(1.0, 0.96, 0.85), smoothstep(0.65, 1.12, heat));
      }
      vec3 diskLight(vec3 source, vec3 outgoing) {
        float r = max(length(source.xz), 1.0);
        float angle = atan(source.z, source.x);
        float omega = 0.085 * pow(1.5 / r, 1.5);
        float flow = angle - uTime * omega;
        vec2 advected = vec2(cos(flow), sin(flow)) * r * 3.2;
        float eddies = turbulence(advected + vec2(uTime * 0.006, -uTime * 0.004));
        float warp = (eddies - 0.5) * 1.7 + sin(flow * 7.0 + r * 3.0) * 0.26;
        float radialPixel = fwidth(r), angularPixel = angleFootprint(flow);
        float warpPixel = fwidth(warp);
        float broad = filament(r * 24.0 + warp * 2.2 + flow * 3.0,
                               radialPixel * 24.0 + warpPixel * 2.2 + angularPixel * 3.0);
        float medium = filament(r * 63.0 + warp * 3.1 + flow * 11.0,
                                radialPixel * 63.0 + warpPixel * 3.1 + angularPixel * 11.0);
        float fine = filament(r * 151.0 + warp * 4.0 + flow * 19.0,
                              radialPixel * 151.0 + warpPixel * 4.0 + angularPixel * 19.0);
        float structure = clamp(0.45 + eddies * 0.42 + broad * 0.22
          + medium * 0.13 + fine * 0.05, 0.14, 1.08);
        float heat = pow(clamp((4.4 - r) / 3.05, 0.0, 1.0), 0.72);
        // Tangential velocity and the outgoing ray make the approaching side
        // swap correctly as the observer orbits the fixed disk. This is an
        // SR-inspired transfer factor, not a Kerr/GR velocity model.
        vec3 velocity = vec3(-source.z, 0.0, source.x) / r;
        float beta = clamp(0.36 * sqrt(1.45 / r), 0.0, 0.39);
        float doppler = sqrt(1.0 - beta * beta) / max(0.35, 1.0 - beta * dot(velocity, outgoing));
        float transfer = pow(doppler, 3.0);
        float luminosity = 0.075 + 2.45 * pow(heat, 2.2);
        return thermalColor(heat * doppler) * luminosity * structure * transfer;
      }

      void main() {
        vec3 ray = normalize(rayPoint - eye);
        float closest = max(0.0, -dot(eye, ray));
        vec3 impact = eye + closest * ray;
        float b = length(impact);
        float aa = max(fwidth(b), 0.001);
        float shadow = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, b);
        float outside = 1.0 - shadow;
        // Fade by the actual quad boundary too: close perspectives compress
        // its projected impact radius and must not expose a rectangular lens.
        float planeEdge = max(abs(dot(rayPoint, right)), abs(dot(rayPoint, up)));
        float planeMask = 1.0 - smoothstep(6.3, 6.98, planeEdge);
        float viewportMask = (1.0 - smoothstep(5.1, 6.2, b)) * planeMask;
        if (viewportMask < 0.001) discard;

        // GalaxySky bends the photograph and every star together. Only plasma,
        // the shadow and the photon ring contribute opacity in this viewport;
        // an opaque local star field would erase the underlying Milky Way.
        vec3 color = vec3(0.0);
        float alpha = shadow;

        vec3 normal = vec3(0.0, 1.0, 0.0);
        float inclination = abs(dot(normalize(eye), normal));
        vec3 projected = normal - forward * dot(normal, forward);
        vec3 imageUp = length(projected) > 0.001 ? normalize(projected) : up;
        vec3 imageRight = normalize(cross(imageUp, forward));
        float vertical = dot(impact, imageUp);
        float horizontal = dot(impact, imageRight);
        float lowerScale = mix(0.79, 1.0, inclination);
        float lensR = length(vec2(horizontal, vertical / (vertical < 0.0 ? lowerScale : 1.0)));
        float sourceR = 1.35 + (lensR - 1.065) * 4.5;
        float arch = mix(pow(abs(vertical) / max(lensR, 0.001), 0.55), 1.0, inclination);
        float lensMask = diskMask(sourceR) * smoothstep(1.015, 1.055, lensR)
          * arch * outside * mix(0.94, 0.23, inclination);
        // Both images map back onto the far half of the physical disk. Pole-on,
        // the secondary image smoothly opens into a concentric image.
        vec3 planarEye = vec3(eye.x, 0.0, eye.z);
        vec3 nearDirection = length(planarEye) > 0.001 ? normalize(planarEye) : vec3(0.0, 0.0, 1.0);
        vec3 diskRight = normalize(cross(normal, nearDirection));
        float sourceAngle = acos(clamp(horizontal / max(lensR, 0.001), -1.0, 1.0));
        if (vertical < 0.0) sourceAngle *= mix(1.0, -1.0, smoothstep(0.55, 0.98, inclination));
        vec3 source = sourceR * (diskRight * cos(sourceAngle) - nearDirection * sin(sourceAngle));
        vec3 lensLight = diskLight(source, normalize(eye - source));
        lensLight *= vertical < 0.0 ? 0.61 : 0.94;
        color += lensLight * lensMask;
        alpha += (1.0 - alpha) * lensMask;

        // Finite thickness preserves an exactly edge-on view. Accumulate thin
        // Gaussian plasma front-to-back instead of lighting a uniform annulus.
        const float halfHeight = 0.065;
        float radialA = max(dot(ray.xz, ray.xz), 0.000001);
        float radialB = dot(eye.xz, ray.xz);
        float radialC = dot(eye.xz, eye.xz) - 4.4 * 4.4;
        float discriminant = radialB * radialB - radialA * radialC;
        float root = sqrt(max(discriminant, 0.0));
        float nearT = max(0.0, (-radialB - root) / radialA);
        float farT = (-radialB + root) / radialA;
        float volumeVisible = step(0.0, discriminant);
        if (abs(ray.y) > 0.00001) {
          float bottomT = (-halfHeight - eye.y) / ray.y;
          float topT = (halfHeight - eye.y) / ray.y;
          nearT = max(nearT, min(bottomT, topT));
          farT = min(farT, max(bottomT, topT));
        } else {
          volumeVisible *= step(abs(eye.y), halfHeight);
        }
        float stepLength = max(0.0, farT - nearT) / 12.0;
        vec3 emission = vec3(0.0);
        float transmission = 1.0;
        for (int i = 0; i < 12; i++) {
          float t = nearT + (float(i) + 0.5) * stepLength;
          vec3 hit = eye + ray * t;
          float r = length(hit.xz);
          float thickness = 0.023 + 0.008 * clamp(r / 4.4, 0.0, 1.0);
          float density = diskMask(r) * exp(-pow(hit.y / thickness, 2.0)) * volumeVisible;
          // Actual foreground emission alone is allowed across the black core.
          density *= mix(outside, 1.0, step(t, closest));
          float opacity = 1.0 - exp(-density * stepLength * 16.0);
          emission += diskLight(hit, -ray) * opacity * transmission;
          transmission *= 1.0 - opacity;
        }

        // Energy-filtered photon ring. Its restrained halo never leaks into the
        // shadow. Foreground plasma can obscure the lensed background image.
        float ringWidth = max(0.007, aa * 0.58);
        float photon = exp(-pow((b - 1.018) / ringWidth, 2.0)) * 0.007 / ringWidth;
        float halo = exp(-pow((b - 1.025) / 0.045, 2.0)) * 0.045;
        vec3 ringLight = vec3(1.0, 0.90, 0.72) * (photon * 3.2 + halo) * outside;
        color = (color + ringLight) * transmission + emission;
        float ringOpacity = clamp(photon + halo, 0.0, 1.0) * outside;
        alpha += (1.0 - alpha) * ringOpacity;
        alpha = 1.0 - (1.0 - alpha) * transmission;
        if (alpha * viewportMask < 0.001) discard;

        #include <logdepthbuf_fragment>
        // Normal blending expects unpremultiplied foreground radiance. The
        // background stays visible through the thin outer plasma and empty sky.
        gl_FragColor = vec4(color / max(alpha, 0.001), alpha * viewportMask);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  surface.frustumCulled = false;
  const inverse = new THREE.Matrix4();
  const cameraWorld = new THREE.Vector3();
  surface.onBeforeRender = (_renderer, _scene, camera) => {
    inverse.copy(group.matrixWorld).invert();
    camera.getWorldPosition(cameraWorld);
    uniforms.eye.value.copy(cameraWorld).applyMatrix4(inverse);
    uniforms.right.value.setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(inverse);
    uniforms.up.value.setFromMatrixColumn(camera.matrixWorld, 1).transformDirection(inverse);
    uniforms.forward.value.copy(uniforms.eye.value).normalize();
  };
  group.add(surface);
  return { body, group, surface, layers: {}, spinning: [], timeUniforms: [time] };
}
