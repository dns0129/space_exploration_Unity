import * as THREE from "three";

export type GalaxyTextureFile = "milky-way-8k.jpg" | "milky-way-4k.jpg";
export type GalaxySkyVariant = "milky-way" | "echo-rift" | "black-hole";

/** Native source pixels, never a 4K image enlarged into an 8K/16K texture. */
export function selectGalaxyFile(maxTextureSize: number, compact = false, software = false): GalaxyTextureFile {
  return maxTextureSize >= 8192 && !compact && !software ? "milky-way-8k.jpg" : "milky-way-4k.jpg";
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    // A sky direction has no world position. Ignore both camera translation
    // and the parent's metre conversion used by the walking render pass.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = vec4(clip.xy, clip.w * 0.999, clip.w);
  }
`;

const skyFragment = /* glsl */ `
  uniform sampler2D skyMap;
  uniform mat3 skyRotation;
  uniform float intensity;
  uniform float visibility;
  uniform float detail;
  uniform float hasMap;
  uniform float riftVariant;
  uniform float blackHoleVariant;
  uniform vec3 lensDirection;
  uniform float lensRadiusOverDistance;
  uniform float lensEnabled;
  varying vec3 vDirection;

  // Bend the celestial direction before any panorama rotation. The same
  // source direction then supplies both photographed dust and individual stars.
  // This is a finite, radial lens approximation, not a GR geodesic integrator.
  vec3 lensedDirection(vec3 ray) {
    if (lensEnabled < 0.5 || lensRadiusOverDistance <= 0.0) return ray;
    float facing = dot(ray, lensDirection);
    if (facing <= 0.0) return ray;
    vec3 tangent = ray - lensDirection * facing;
    float sine = length(tangent);
    if (sine < 0.000001) return ray;
    float impact = sine / lensRadiusOverDistance;
    float envelope = 1.0 - smoothstep(3.0, 9.0, impact);
    if (envelope <= 0.0) return ray;
    float weakBend = 0.77 / max(impact, 1.0);
    float nearCritical = 0.09 * log(1.0 + 1.25 / max(impact - 1.0, 0.025));
    nearCritical *= 1.0 - smoothstep(1.15, 2.8, impact);
    float sourceAngle = atan(sine, facing) - (weakBend + nearCritical) * envelope;
    return normalize(lensDirection * cos(sourceAngle) + tangent / sine * sin(sourceAngle));
  }

  float starHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float riftHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  // This field lives on a direction sphere, so its dust has neither an
  // equirectangular longitude seam nor a moving/screen-space noise pattern.
  float riftNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(riftHash(cell), riftHash(cell + vec3(1.0, 0.0, 0.0)), f.x),
          mix(riftHash(cell + vec3(0.0, 1.0, 0.0)), riftHash(cell + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(riftHash(cell + vec3(0.0, 0.0, 1.0)), riftHash(cell + vec3(1.0, 0.0, 1.0)), f.x),
          mix(riftHash(cell + vec3(0.0, 1.0, 1.0)), riftHash(cell + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }

  vec3 riftDirection(vec3 direction) {
    // A non-rigid angular remapping changes the photographed lanes' shapes,
    // spacing and branches rather than merely rotating the same panorama.
    vec3 bend = sin(direction.yzx * vec3(4.7, 3.9, 4.3)
                  + direction.zxy * vec3(2.1, -2.7, 2.3)
                  + vec3(1.7, 4.2, 0.6));
    bend += sin(direction.zxy * 9.1 + vec3(2.4, 0.9, 4.6)) * 0.22;
    bend -= direction * dot(direction, bend);
    return normalize(direction + bend * 0.14);
  }

  vec3 riftClouds(vec3 direction, vec3 panoramaDirection, vec3 photograph) {
    vec3 p = direction * 5.6 + vec3(6.4, 2.7, 11.3);
    float cloud = riftNoise(p) * 0.64;
    cloud += riftNoise(p.zxy * 2.13 + vec3(3.2, 9.4, 1.7)) * 0.26;
    if (detail > 0.5) cloud += riftNoise(p.yzx * 4.37 + vec3(17.8, 0.3, 5.1)) * 0.10;
    else cloud += 0.05;
    // Broad emission stays near the old photographic galactic plane. An
    // offset crossing lane and irregular dark knots give this view its own
    // silhouette while leaving most of the sky black and the stars tiny.
    float plane = exp(-abs(panoramaDirection.y) * 10.0);
    float crossing = exp(-abs(direction.y + direction.x * 0.22
                            + sin(direction.z * 4.3) * 0.075) * 17.0);
    float envelope = max(plane, crossing * 0.48);
    float wisps = smoothstep(0.39, 0.71, cloud) * envelope;
    float knots = smoothstep(0.57, 0.76, cloud) * envelope;
    float hue = smoothstep(-0.55, 0.65, direction.x + direction.z * 0.35);
    vec3 emission = mix(vec3(0.009, 0.004, 0.019), vec3(0.003, 0.015, 0.021), hue);
    vec3 radiance = photograph * mix(vec3(0.77, 0.83, 1.06), vec3(0.73, 1.04, 1.12), hue);
    radiance *= 1.0 - knots * 0.52;
    return radiance + emission * wisps;
  }

  // Stars are evaluated at the display's pixel scale. Their tiny round cores
  // remain clean under zoom instead of magnifying square JPEG texels.
  // They are original visual detail, not an astrometric star catalogue.
  vec3 stars(vec2 uv, vec2 uvDx, vec2 uvDy, vec2 gridSize, float seed, float density, float gain) {
    vec2 grid = uv * gridSize;
    vec2 cell = floor(grid);
    float latitude = (uv.y - 0.5) * 3.14159265359;
    float latitudeScale = max(cos(latitude), 0.035);
    float selected = starHash(cell + seed);
    float present = step(selected, density * latitudeScale);
    vec2 center = vec2(starHash(cell + seed + 11.3), starHash(cell + seed + 53.7)) * 0.48 + 0.26;
    vec2 offset = fract(grid) - center;
    offset.x *= latitudeScale;
    // Differentiate the continuous angular field, never the hashed cell or
    // fract(grid): both are discontinuous and can create bright square patches.
    vec2 metric = vec2(latitudeScale, 1.0);
    float pixel = max(length(uvDx * gridSize * metric), length(uvDy * gridSize * metric));
    float magnitude = starHash(cell + seed + 137.0);
    float radius = max(mix(0.006, 0.027, pow(magnitude, 8.0)), pixel * 0.54);
    float distance2 = dot(offset, offset);
    float core = exp(-distance2 / (radius * radius));
    float halo = exp(-distance2 / (radius * radius * 7.0)) * 0.08 * pow(magnitude, 5.0);
    float temperature = starHash(cell + seed + 303.0);
    vec3 tint = mix(vec3(0.64, 0.79, 1.0), vec3(1.0, 0.83, 0.63), temperature);
    return tint * (core + halo) * present * gain * mix(0.28, 1.0, pow(magnitude, 3.0));
  }

  // Convolve a small circular source star with its elliptical pixel footprint.
  // The full derivative covariance retains tangential lens arcs without using
  // the largest distorted derivative as a circular, over-bright star radius.
  vec3 blackHoleStars(vec2 uv, vec2 dx, vec2 dy, float angularPixel,
                      vec2 gridSize, float seed, float density, float gain) {
    vec2 grid = uv * gridSize;
    vec2 cell = floor(grid);
    cell.x = mod(cell.x, gridSize.x);
    float latitudeScale = max(cos((uv.y - 0.5) * 3.14159265359), 0.035);
    float galacticPlane = exp(-abs(uv.y - 0.5) * 19.0);
    float present = step(starHash(cell + seed), density * latitudeScale * (0.78 + 0.55 * galacticPlane));
    vec2 center = vec2(starHash(cell + seed + 11.3), starHash(cell + seed + 53.7)) * 0.48 + 0.26;
    vec2 metric = vec2(latitudeScale, 1.0);
    vec2 offset = (fract(grid) - center) * metric;
    vec2 footprintX = dx * gridSize * metric;
    vec2 footprintY = dy * gridSize * metric;
    float magnitude = starHash(cell + seed + 137.0);
    float nativePixel = angularPixel * gridSize.y / 3.14159265359;
    float radius = max(mix(0.006, 0.025, pow(magnitude, 8.0)), nativePixel * 0.38);
    float sourceArea = radius * radius;
    float cxx = sourceArea + 0.24 * (footprintX.x * footprintX.x + footprintY.x * footprintY.x);
    float cyy = sourceArea + 0.24 * (footprintX.y * footprintX.y + footprintY.y * footprintY.y);
    float cxy = 0.24 * (footprintX.x * footprintX.y + footprintY.x * footprintY.y);
    float determinant = max(cxx * cyy - cxy * cxy, sourceArea * sourceArea);
    float ellipse = max(0.0, (cyy * offset.x * offset.x - 2.0 * cxy * offset.x * offset.y
                              + cxx * offset.y * offset.y) / determinant);
    float energy = min(1.0, sourceArea / sqrt(determinant));
    // When a pixel covers multiple source cells, the panorama mip levels carry
    // the unresolved population; suppress hashed-cell patches at the critical edge.
    float footprint = max(length(footprintX), length(footprintY));
    float resolved = 1.0 - smoothstep(0.45, 1.25, footprint);
    float core = exp(-ellipse) * energy * resolved;
    float temperature = starHash(cell + seed + 303.0);
    vec3 tint = mix(vec3(0.79, 0.85, 0.92), vec3(1.0, 0.89, 0.76), temperature);
    return tint * core * present * gain * mix(0.30, 1.0, pow(magnitude, 3.0));
  }

  void main() {
    vec3 worldDirection = normalize(vDirection);
    float angularPixel = max(length(dFdx(worldDirection)), length(dFdy(worldDirection)));
    vec3 direction = normalize(skyRotation * lensedDirection(worldDirection));
    vec3 panoramaDirection = direction;
    if (riftVariant > 0.5) panoramaDirection = riftDirection(direction);
    vec2 uv = vec2(atan(panoramaDirection.z, panoramaDirection.x) / 6.28318530718 + 0.5,
                   asin(clamp(panoramaDirection.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
    // Longitude wraps. Derivatives across the wrap must not select a blurry
    // mip level, especially when the sharp galactic plane crosses the seam.
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    dx.x -= floor(dx.x + 0.5);
    dy.x -= floor(dy.x + 0.5);
    vec3 photograph = textureGrad(skyMap, uv, dx, dy).rgb * hasMap;
    // A restrained photographic shadow lift reveals the native dust lanes;
    // it changes display exposure, without inventing higher-resolution clouds.
    vec3 radiance = photograph + sqrt(max(photograph, vec3(0.0))) * 0.024;
    if (riftVariant > 0.5) radiance = riftClouds(direction, panoramaDirection, radiance);
    vec3 pinpoints;
    if (blackHoleVariant > 0.5) {
      // Preserve the native photograph's dark lanes, with a muted warm-grey
      // shadow lift that reveals dust instead of replacing it with a flat glow.
      float luminance = dot(photograph, vec3(0.2126, 0.7152, 0.0722));
      vec3 warmPhotograph = mix(photograph, vec3(luminance) * vec3(1.07, 0.96, 0.84), 0.56);
      radiance = warmPhotograph + sqrt(max(warmPhotograph, vec3(0.0))) * 0.056;
      pinpoints = blackHoleStars(uv, dx, dy, angularPixel, vec2(420.0, 210.0), 291.7, 0.135, 0.64);
      pinpoints += blackHoleStars(uv, dx, dy, angularPixel, vec2(960.0, 480.0), 513.1, 0.078, 0.24);
      // Fine pinpoints remain present in compact mode, where the photographic
      // panorama is 4K; the optional fourth layer only adds faint micro-stars.
      pinpoints += blackHoleStars(uv, dx, dy, angularPixel, vec2(1760.0, 880.0), 819.3, 0.044, 0.11);
      if (detail > 0.5) {
        pinpoints += blackHoleStars(uv, dx, dy, angularPixel, vec2(2800.0, 1400.0), 1127.9, 0.016, 0.045);
      }
    } else {
      float starSeed = riftVariant * 113.7;
      pinpoints = stars(uv, dx, dy, vec2(420.0, 210.0), 19.3 + starSeed, 0.052, 0.62);
      if (detail > 0.5) {
        pinpoints += stars(uv, dx, dy, vec2(1440.0, 720.0), 71.8 + starSeed, 0.022, 0.13);
      }
    }
    gl_FragColor = vec4((radiance * intensity + pinpoints) * visibility, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Direct panorama rendering avoids Three's equirectangular-to-cube downsample. */
export class GalaxySky {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly rotation = new THREE.Euler();
  private readonly rotationMatrix = new THREE.Matrix4();
  private readonly blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private blackHoleLens: THREE.Object3D | null = null;
  private readonly lensPosition = new THREE.Vector3();
  private readonly lensScale = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();

  constructor(compact = false) {
    this.blackTexture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        skyMap: { value: this.blackTexture },
        skyRotation: { value: new THREE.Matrix3() },
        intensity: { value: 2.5 },
        visibility: { value: 1 },
        detail: { value: compact ? 0 : 1 },
        hasMap: { value: 0 },
        riftVariant: { value: 0 },
        blackHoleVariant: { value: 0 },
        lensDirection: { value: new THREE.Vector3(0, 0, -1) },
        lensRadiusOverDistance: { value: 0 },
        lensEnabled: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), material);
    this.mesh.name = "native-panorama-galaxy";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const uniforms = this.mesh.material.uniforms;
      const target = this.blackHoleLens;
      if (!target || uniforms.blackHoleVariant.value < 0.5) {
        uniforms.lensEnabled.value = 0;
        uniforms.lensRadiusOverDistance.value = 0;
        return;
      }
      target.getWorldPosition(this.lensPosition);
      target.getWorldScale(this.lensScale);
      camera.getWorldPosition(this.cameraPosition);
      this.lensPosition.sub(this.cameraPosition);
      const distance = this.lensPosition.length();
      const radius = Math.abs(this.lensScale.x);
      const enabled = distance > radius && radius > 0;
      uniforms.lensEnabled.value = enabled ? 1 : 0;
      uniforms.lensRadiusOverDistance.value = enabled ? radius / distance : 0;
      if (enabled) uniforms.lensDirection.value.copy(this.lensPosition).multiplyScalar(1 / distance);
    };
  }

  /** The target's unit radius is its shadow; uniform world scale supplies flight units. */
  setBlackHoleLens(target: THREE.Object3D | null) {
    this.blackHoleLens = target;
    if (!target) {
      const uniforms = this.mesh.material.uniforms;
      uniforms.lensEnabled.value = 0;
      uniforms.lensRadiusOverDistance.value = 0;
      uniforms.lensDirection.value.set(0, 0, -1);
    }
  }

  /** The caller owns panorama texture loading and disposal. */
  setTexture(texture: THREE.Texture | null) {
    this.mesh.material.uniforms.skyMap.value = texture ?? this.blackTexture;
    this.mesh.material.uniforms.hasMap.value = texture ? 1 : 0;
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
    }
  }

  /** Rotation uses the same convention as Scene.backgroundRotation. */
  setView(rotation: readonly number[], intensity: number, visibility = 1, enabled = true, variant: GalaxySkyVariant = "milky-way") {
    this.rotation.set(-rotation[0], -rotation[1], -rotation[2]);
    this.mesh.material.uniforms.skyRotation.value.setFromMatrix4(this.rotationMatrix.makeRotationFromEuler(this.rotation));
    this.mesh.material.uniforms.intensity.value = intensity;
    this.mesh.material.uniforms.visibility.value = THREE.MathUtils.clamp(visibility, 0, 1);
    this.mesh.material.uniforms.riftVariant.value = variant === "echo-rift" ? 1 : 0;
    this.mesh.material.uniforms.blackHoleVariant.value = variant === "black-hole" ? 1 : 0;
    this.mesh.visible = enabled && visibility > 0.001;
  }

  setDetailed(enabled: boolean) {
    this.mesh.material.uniforms.detail.value = enabled ? 1 : 0;
  }

  dispose() {
    this.setBlackHoleLens(null);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.blackTexture.dispose();
  }
}
