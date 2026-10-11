import { test, expect } from "@playwright/test";

test("回声裂隙背景具有独立细节，静止且不受徒步坐标缩放影响，切回原背景保持原样", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { GalaxySky } = await import("/src/galaxy-sky.ts");
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    const target = new THREE.WebGLRenderTarget(128, 128);
    const scene = new THREE.Scene();
    const sky = new GalaxySky(false);
    const data = new Uint8Array(128 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      data[i] = 8 + Math.round((Math.sin(x * Math.PI / 64) + 1) * 13);
      data[i + 1] = 8 + Math.round((Math.cos(x * Math.PI / 32 + y / 6) + 1) * 13);
      data[i + 2] = 8 + Math.round((Math.sin(y / 7) + 1) * 20);
      data[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, 128, 64);
    sky.setTexture(texture);
    scene.add(sky.mesh);
    const camera = new THREE.PerspectiveCamera(90, 1, 1e-8, 1000);
    renderer.setRenderTarget(target);
    function capture(variant: "milky-way" | "echo-rift") {
      sky.setView([0.17, 0.43, -0.08], 2, 1, true, variant);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
      return pixels;
    }
    function difference(a: Uint8Array, b: Uint8Array) {
      return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
    }
    const original = capture("milky-way");
    const echo = capture("echo-rift");
    const repeat = capture("echo-rift");
    scene.scale.setScalar(6371000);
    camera.position.set(150, 30, -70);
    camera.near = 0.03;
    camera.far = 6371000000;
    camera.updateProjectionMatrix();
    const walking = capture("echo-rift");
    sky.setDetailed(false);
    const compact = capture("echo-rift");
    sky.setDetailed(true);
    const restored = capture("milky-way");
    const output = {
      variantDifference: difference(original, echo),
      repeatDifference: difference(echo, repeat),
      walkingDifference: difference(echo, walking),
      restoredDifference: difference(original, restored),
      compactNonBlack: compact.some((value, i) => i % 4 !== 3 && value > 0),
    };
    texture.dispose(); sky.dispose(); target.dispose(); renderer.dispose();
    return output;
  });
  expect(result.variantDifference).toBeGreaterThan(30000);
  expect(result.repeatDifference).toBe(0);
  expect(result.walkingDifference).toBe(0);
  expect(result.restoredDifference).toBe(0);
  expect(result.compactNonBlack).toBe(true);
  expect(errors).toEqual([]);
});
