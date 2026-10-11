import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { PNG } from "pngjs";

test("月面看到地球，木卫一表面看到木星", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const world = await (await page.request.get("/api/world")).json();
  let state: unknown;
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.evaluate(async () => {
    const { SolarScene } = await import("/src/planet-scene.ts");
    const render = SolarScene.prototype["renderFlightWorld"];
    SolarScene.prototype["renderFlightWorld"] = function () {
      (window as any).celestialTestScene = this;
      render.call(this);
    };
  });
  for (const [surfaceId, targetId] of [["moon", "earth"], ["io", "jupiter"]]) {
    const surface = world.bodies.find((body: { id: string }) => body.id === surfaceId);
    const target = world.bodies.find((body: { id: string }) => body.id === targetId);
    const outward = new THREE.Vector3(...target.position).sub(new THREE.Vector3(...surface.position)).normalize();
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(), outward, new THREE.Vector3(0, 1, 0)));
    state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar",
      position: new THREE.Vector3(...surface.position).addScaledVector(outward, surface.radius + 20 / world.unitsKm).toArray(),
      velocity: [0, 0, 0], orientation: orientation.toArray(), target: targetId, camera: "cockpit", assist: true, elapsed: 0 };
    await page.getByRole("button", { name: "自由航行", exact: true }).click();
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await expect(page.locator("#flight-resume")).toBeEnabled();
    await page.locator("#flight-resume").click();
    await page.locator("#flight-pause").click();
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-render-mode", "surface");
    await expect.poll(async () => JSON.parse(await canvas.getAttribute("data-surface-celestial-bodies") ?? "[]")).toContain(targetId);
    await expect(canvas).toHaveAttribute("data-surface-frame-idle", "true");
    const png = PNG.sync.read(await canvas.screenshot({ path: info.outputPath(`${surfaceId}-${targetId}.png`),
      style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
    // Compare with the same sky and camera after removing only celestial meshes.
    await page.evaluate(() => {
      const scene = (window as any).celestialTestScene;
      const models = scene.surfaceCelestialScene.children.filter((object: any) => object.isGroup && object.visible);
      models.forEach((object: any) => object.visible = false);
      scene.renderFlightWorld();
      models.forEach((object: any) => object.visible = true);
    });
    const empty = PNG.sync.read(await canvas.screenshot({
      style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
    let changed = 0;
    for (let y = Math.floor(png.height * 0.48); y < png.height * 0.52; y++)
      for (let x = Math.floor(png.width * 0.48); x < png.width * 0.52; x++) {
        const offset = (y * png.width + x) * 4;
        if ([0, 1, 2].some(channel => Math.abs(png.data[offset + channel] - empty.data[offset + channel]) > 10)) changed++;
      }
    expect(changed, `${targetId} 的实际天体像素出现在天空中央`).toBeGreaterThan(10);
    await page.getByRole("button", { name: "行星观测", exact: true }).click();
  }
  expect(errors).toEqual([]);
});
