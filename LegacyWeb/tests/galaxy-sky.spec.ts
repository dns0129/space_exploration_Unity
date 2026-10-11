import { test, expect } from "@playwright/test";

test("星空在徒步米制场景中保持无限远，移动不产生弧形边界", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { GalaxySky } = await import("/src/galaxy-sky.ts");
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    const target = new THREE.WebGLRenderTarget(96, 96);
    const scene = new THREE.Scene();
    const sky = new GalaxySky(true);
    // An opaque panorama makes missing sky pixels distinguishable from dark space.
    const texture = new THREE.DataTexture(new Uint8Array([48, 64, 96, 255]), 1, 1);
    sky.setTexture(texture);
    scene.add(sky.mesh);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.00000001, 1000);
    renderer.setRenderTarget(target);
    function capture(scale: number, position: number[], near: number, far: number) {
      scene.scale.setScalar(scale);
      camera.position.fromArray(position);
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const pixels = new Uint8Array(96 * 96 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 96, 96, pixels);
      return pixels;
    }
    const reference = capture(1, [0, 0, 0], 1e-8, 1000);
    const poses = [[17, 2, 0], [150, 30, -70], [-400, 3, 600]];
    const differences = poses.map(position => {
      const pixels = capture(6371000, position, 0.03, 6371000000);
      return pixels.reduce((max, value, i) => Math.max(max, Math.abs(value - reference[i])), 0);
    });
    // Camera rotation still changes the angular star field.
    camera.rotation.set(0.3, 0.8, 0.1);
    const turned = capture(6371000, poses[0], 0.03, 6371000000);
    const rotatedDifference = turned.reduce((sum, value, i) => sum + Math.abs(value - reference[i]), 0);
    const covered = reference.every((value, i) => i % 4 === 3 || value > 0);
    texture.dispose(); sky.dispose(); target.dispose(); renderer.dispose();
    return { differences, covered, rotatedDifference };
  });
  expect(result.covered).toBe(true);
  expect(result.differences).toEqual([0, 0, 0]);
  expect(result.rotatedDifference).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
