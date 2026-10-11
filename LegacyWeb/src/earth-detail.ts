import * as THREE from "three";

export type RenderQuality = "standard" | "high" | "ultra";

export const earthDetailSampling = /* glsl */ `
  uniform sampler2D detailTile0, detailTile1, detailTile2, detailTile3;
  uniform vec4 detailRect0, detailRect1, detailRect2, detailRect3;
  uniform vec4 detailBlend;
  vec3 earthTile(sampler2D tile, vec4 rect, float blend, vec3 base, vec2 uv, vec2 gx, vec2 gy) {
    if (blend <= 0.0) return base;
    vec2 local = vec2(fract(uv.x - rect.x), uv.y - rect.y) / rect.zw;
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return base;
    vec2 edge = min(local, 1.0 - local);
    float weight = blend * smoothstep(0.0, 0.025, min(edge.x, edge.y));
    vec2 tileUv = (local * 2048.0 + 8.0) / 2064.0;
    vec2 dx = gx / rect.zw * (2048.0 / 2064.0), dy = gy / rect.zw * (2048.0 / 2064.0);
    return mix(base, sampleMap(tile, tileUv, vec2(2064.0), dx, dy, true).rgb, weight);
  }
  vec3 earthDay(vec2 uv, vec2 gx, vec2 gy, bool seam) {
    vec3 day = sampleMap(dayMap, uv, mapSize, gx, gy, seam).rgb;
    day = earthTile(detailTile0, detailRect0, detailBlend.x, day, uv, gx, gy);
    day = earthTile(detailTile1, detailRect1, detailBlend.y, day, uv, gx, gy);
    day = earthTile(detailTile2, detailRect2, detailBlend.z, day, uv, gx, gy);
    return earthTile(detailTile3, detailRect3, detailBlend.w, day, uv, gx, gy);
  }
`;

type Slot = { key: string; texture: THREE.Texture; col: number; row: number; fade: number };

/** Four resident 2048² tiles reveal native 16K geography, without a 512 MiB whole-world texture. */
export class EarthDetail {
  readonly uniforms: Record<string, THREE.IUniform>;
  private slots: (Slot | undefined)[] = Array(4);
  private desired: string[] = [];
  private pending = false;
  private disposed = false;
  private readonly failedUntil = new Map<string, number>();
  private readonly eye = new THREE.Vector3();
  private checkAt = 0;

  constructor(
    private readonly fallback: THREE.Texture,
    private readonly load: (file: string) => Promise<THREE.Texture>,
    private readonly release: (texture: THREE.Texture) => void,
    private readonly upload: (texture: THREE.Texture) => void,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.uniforms = { detailBlend: { value: new THREE.Vector4() } };
    for (let i = 0; i < 4; i++) {
      this.uniforms[`detailTile${i}`] = { value: fallback };
      this.uniforms[`detailRect${i}`] = { value: new THREE.Vector4(0, 0, 1 / 8, 1 / 4) };
    }
  }

  update(surface: THREE.Mesh | undefined, camera: THREE.Camera, enabled: boolean, delta: number, now: number) {
    if (this.disposed) return;
    const blend = this.uniforms.detailBlend.value as THREE.Vector4;
    this.slots.forEach((slot, i) => {
      if (slot) { slot.fade = Math.min(1, slot.fade + delta * 2); blend.setComponent(i, enabled ? slot.fade : 0); }
    });
    if (now < this.checkAt) return;
    this.checkAt = now + 300;
    if (!enabled || !surface) { this.clear(!!surface); return; }
    surface.updateWorldMatrix(true, false);
    surface.worldToLocal(this.eye.copy(camera.position));
    if (this.eye.length() > 3.0) { this.clear(); return; }
    this.eye.normalize();
    const u = THREE.MathUtils.euclideanModulo(Math.atan2(this.eye.z, -this.eye.x) / (2 * Math.PI), 1);
    const northV = Math.acos(THREE.MathUtils.clamp(this.eye.y, -1, 1)) / Math.PI;
    const col = Math.floor(u * 8 - 0.5), row = THREE.MathUtils.clamp(Math.floor(northV * 4 - 0.5), 0, 2);
    this.desired = [0, 1].flatMap(dy => [0, 1].map(dx => `${THREE.MathUtils.euclideanModulo(col + dx, 8)}-${row + dy}`));
    for (let i = 0; i < 4; i++) {
      if (this.slots[i] && !this.desired.includes(this.slots[i]!.key)) this.remove(i);
    }
    this.requestNext(now);
    this.canvas.dataset.earthDetail = this.slots.filter(Boolean).length ? "16k" : "loading";
    this.canvas.dataset.earthDetailTiles = this.slots.filter(Boolean).length.toString();
  }

  private requestNext(now: number) {
    if (this.pending) return;
    const key = this.desired.find(key => !this.slots.some(slot => slot?.key === key)
      && (this.failedUntil.get(key) ?? 0) < now);
    if (!key) return;
    this.pending = true;
    void this.load(`earth-detail-${key}.jpg`).then(texture => {
      if (this.disposed || !this.desired.includes(key)) { this.release(texture); return; }
      const i = this.slots.findIndex(slot => !slot);
      if (i < 0) { this.release(texture); return; }
      // Gutters supply neighbouring texels; edge clamping also keeps coarse mips well behaved.
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.upload(texture);
      const [col, row] = key.split("-").map(Number);
      this.slots[i] = { key, texture, col, row, fade: 0 };
      this.uniforms[`detailTile${i}`].value = texture;
      this.uniforms[`detailRect${i}`].value.set(col / 8, (3 - row) / 4, 1 / 8, 1 / 4);
    }).catch(() => {
      // A missing detail tile leaves the complete global map usable and retries with a backoff.
      this.failedUntil.set(key, performance.now() + 30_000);
    }).finally(() => { this.pending = false; });
  }

  private remove(i: number) {
    const slot = this.slots[i];
    if (slot) this.release(slot.texture);
    this.slots[i] = undefined;
    this.uniforms[`detailTile${i}`].value = this.fallback;
    (this.uniforms.detailBlend.value as THREE.Vector4).setComponent(i, 0);
  }
  private clear(publish = true) {
    this.desired = [];
    for (let i = 0; i < 4; i++) this.remove(i);
    if (publish) {
      this.canvas.dataset.earthDetail = "global";
      this.canvas.dataset.earthDetailTiles = "0";
    }
  }
  dispose() { this.disposed = true; this.clear(false); }
}
