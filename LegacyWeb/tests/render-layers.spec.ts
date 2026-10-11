import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as THREE from "three";
import { PNG } from "pngjs";
import { terrainHeightKm } from "../shared/surface.mjs";

test.use({ viewport: { width: 900, height: 650 } });

const frames = (page: Page, count = 12) => page.evaluate(count => new Promise<void>(resolve => {
  let frameCount = 0;
  const frame = () => { if (++frameCount >= count) resolve(); else requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}), count);

test("局部大气和真空地表停止全局模型工作，返回太空重新更新", async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const world = await (await page.request.get("/api/world")).json();
  let state: unknown;
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  let detailRequests = 0;
  page.on("request", request => {
    if (/earth-detail-|earth-(day|night|terrain|clouds)-8k/.test(request.url())) detailRequests++;
  });
  for (const [id, altitudeKm, mode] of [
    ["earth", 100, "surface"], ["moon", 20, "surface"], ["earth", 500, "space"],
  ] as const) {
    const body = world.bodies.find((body: { id: string }) => body.id === id);
    state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar", position: [body.position[0], body.position[1],
      body.position[2] - body.radius - altitudeKm / world.unitsKm], velocity: [0, 0, 0],
      orientation: [0, 0, 0, 1], target: id, camera: "cockpit", assist: true, elapsed: 0 };
    if (id === "earth" && altitudeKm === 100) await page.goto("/");
    else {
      await page.getByRole("button", { name: "行星观测", exact: true }).click();
      await expect(page.locator("canvas")).toHaveAttribute("data-render-mode", "observation");
    }
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
    if (id === "earth" && altitudeKm === 100) await page.evaluate(async () => {
      const { SolarScene } = await import("/src/planet-scene.ts");
      const render = SolarScene.prototype["renderFlightWorld"];
      SolarScene.prototype["renderFlightWorld"] = function () {
        (window as any).renderLayersScene = this;
        return render.call(this);
      };
    });
    await page.getByRole("button", { name: "自由航行", exact: true }).click();
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await page.locator("#flight-quality").selectOption("standard");
    await expect(page.locator("#flight-resume")).toBeEnabled();
    await page.locator("#flight-resume").click();
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-render-mode", mode);
    await expect(canvas).toHaveAttribute("data-space-work-active", String(mode === "space"));
    const updates = Number(await canvas.getAttribute("data-space-updates"));
    const models = Number(await canvas.getAttribute("data-space-models"));
    const downloads = detailRequests;
    await page.evaluate(() => new Promise<void>(resolve => {
      let frames = 0;
      const frame = () => { if (++frames >= 8) resolve(); else requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    }));
    if (mode === "surface") {
      expect(Number(await canvas.getAttribute("data-space-updates"))).toBe(updates);
      expect(Number(await canvas.getAttribute("data-space-models"))).toBe(models);
      expect(detailRequests, "局部场景不得继续请求全球地球细节图层").toBe(downloads);
    } else {
      expect(Number(await canvas.getAttribute("data-space-updates"))).toBeGreaterThan(updates);
      const layers = await page.evaluate(() => {
        const scene = (window as any).renderLayersScene;
        return {
          earthVisible: scene.flightModelById.get("earth").group.visible,
          atmosphereVisible: scene.flightModelById.get("earth").layers.atmosphere.visible,
        };
      });
      expect(layers, "返回太空仍绘制地球，但隐藏其大气壳").toEqual({ earthVisible: true, atmosphereVisible: false });
    }
    expect(models, "空间模型按需建立，启动时不生成全部天体").toBeLessThan(world.bodies.length);
  }
  expect(errors).toEqual([]);
});

test("暂停的局部座舱和追踪镜头保留画布，画质、恢复和视口变化仍重绘", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "暂停绘制与完整分辨率截图在桌面验证");
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: { id: string }) => body.id === "earth");
  const up = new THREE.Vector3(0.4623, 0, -Math.sqrt(1 - 0.4623 ** 2));
  const forward = new THREE.Vector3(-up.z, 0, up.x).multiplyScalar(0.88).addScaledVector(up, 0.45).normalize();
  const state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar", position: new THREE.Vector3().fromArray(earth.position)
    .addScaledVector(up, earth.radius + (terrainHeightKm("earth", up.toArray()) + 1.2) / world.unitsKm).toArray(), velocity: [0, 0, 0],
    orientation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(), forward, up)).toArray(), target: "earth", camera: "cockpit", assist: true, elapsed: 0 };
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await page.locator("#flight-pause").click();
  const canvas = page.locator("canvas");
  const renders = async () => Number(await canvas.getAttribute("data-world-render-count"));
  const idle = async () => {
    await expect(canvas).toHaveAttribute("data-surface-frame-idle", "true", { timeout: 45000 });
    await expect.poll(async () => {
      const previous = await renders();
      await frames(page);
      return await renders() - previous;
    }, { timeout: 45000 }).toBe(0);
  };
  await expect(canvas).toHaveAttribute("data-render-mode", "surface");
  await idle();
  await expect(canvas).toHaveAttribute("data-render-scale", "1.00");
  const screenshot = await canvas.screenshot({ path: info.outputPath("paused-local-full-resolution-sky.png"),
    style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" });
  const image = PNG.sync.read(screenshot);
  expect(image.width).toBeGreaterThan(600);
  expect(image.height).toBeGreaterThan(400);
  let brightestBlue = 0;
  for (let i = 2; i < image.data.length; i += 64) brightestBlue = Math.max(brightestBlue, image.data[i]);
  expect(brightestBlue, "保留的全分辨率画布仍含实际天空像素").toBeGreaterThan(60);

  const frozen = await renders();
  await page.locator('button[data-body="mars"]').click();
  await page.keyboard.press("KeyJ");
  await expect(page.locator("#flight-target")).toHaveText("火星");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#flight-pause")).toHaveAttribute("aria-pressed", "true");
  await frames(page);
  expect(await renders(), "暂停时导航和拒绝跃迁只更新HUD").toBe(frozen);

  for (const change of [
    () => page.locator("#flight-quality").selectOption("high"),
    () => page.locator("#flight-resume").click(),
    () => page.locator("#flight-camera").click(),
    () => page.setViewportSize({ width: 860, height: 620 }),
  ]) {
    const previous = await renders();
    await change();
    await expect.poll(renders).toBeGreaterThan(previous);
    await idle();
  }
  await expect(page.locator("#flight-camera")).toHaveAttribute("aria-pressed", "true");
  const chaseCount = await renders();
  await frames(page);
  expect(await renders(), "追踪镜头暂停稳定后也停止GPU重复绘制").toBe(chaseCount);
  await canvas.screenshot({ path: info.outputPath("paused-local-chase.png") });
  await page.locator("#flight-pause").click();
  await expect(canvas).toHaveAttribute("data-surface-frame-idle", "false");
  await frames(page);
  expect(await renders()).toBeGreaterThan(chaseCount);
  expect(errors).toEqual([]);
});
