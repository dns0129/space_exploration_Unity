import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("超清地球近观呈现原生分块细节，切换画质释放分块，航行继续使用高清图层", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/textures/earth-detail-*.jpg", async route => { await gate; await route.continue(); });
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#quality").selectOption("ultra");
  await expect(canvas).toHaveAttribute("data-earth-maps", "8k", { timeout: 60_000 });
  await page.locator('[role="switch"][data-layer="clouds"]').click();
  await page.locator('.primary-button[data-view="close"]').click();
  await expect.poll(async () => Number((await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""))).toBeLessThan(6000);
  await expect(canvas).toHaveAttribute("data-earth-detail", "loading");
  // Stabilize the camera before comparing images: only the native detail layer may change.
  await page.waitForTimeout(2500);
  const before = PNG.sync.read(await canvas.screenshot());
  release();
  await expect(canvas).toHaveAttribute("data-earth-detail-tiles", "4", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const after = PNG.sync.read(await canvas.screenshot());
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const difference = Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i+1] - after.data[i+1]) + Math.abs(before.data[i+2] - after.data[i+2]);
    if (difference > 3) changed++;
  }
  expect(changed, "16K 分块必须改变实际地表像素，不能仅改变标签").toBeGreaterThan(1000);
  await page.screenshot({ path: info.outputPath("earth-ultra-close.png") });
  await page.locator("#quality").selectOption("standard");
  await expect(canvas).toHaveAttribute("data-earth-detail-tiles", "0");
  // Flight starts in a far overview. Restore a real near-orbit position to exercise streaming.
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: { id: string }) => body.id === "earth");
  const state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar",
    position: [earth.position[0], earth.position[1], earth.position[2] - earth.radius - 1100 / world.unitsKm],
    velocity: [0, 0, 0], orientation: [0, 1, 0, 0], target: "earth", camera: "cockpit", assist: true, elapsed: 0 };
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(canvas).toHaveAttribute("data-earth-maps", "8k");
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-altitude")).toHaveText("1,100 km 高度");
  await page.locator("#flight-pause").click();
  await page.locator("#flight-quality").selectOption("ultra");
  await expect(canvas).toHaveAttribute("data-earth-detail-tiles", "4", { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("细节下载失败保持地球可操作，紧凑设备使用 4K 回退", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const detailRequests: string[] = [];
  page.on("request", request => {
    if (/earth-detail-|earth-.*-8k/.test(request.url())) detailRequests.push(request.url());
  });
  await page.route("**/textures/earth-detail-*.jpg", route => route.abort());
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  if (info.project.name === "mobile") await page.getByRole("button", { name: "观测设置" }).click();
  await page.locator("#quality").selectOption("ultra");
  if (info.project.name === "mobile") await page.getByRole("button", { name: "观测设置" }).click();
  await page.locator('.primary-button[data-view="close"]').click();
  await expect.poll(async () => Number((await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""))).toBeLessThan(6000);
  const canvas = page.locator("canvas");
  if (info.project.name === "desktop") {
    await expect(canvas).toHaveAttribute("data-earth-maps", "8k", { timeout: 60_000 });
    await expect.poll(() => detailRequests.filter(url => url.includes("earth-detail-")).length).toBeGreaterThan(0);
  } else {
    await expect(canvas).toHaveAttribute("data-earth-maps", "4k");
    expect(detailRequests).toEqual([]);
  }
  await expect(canvas).toHaveAttribute("data-earth-detail-tiles", "0");
  await expect(page.getByRole("alert")).toBeHidden();
  await page.getByRole("button", { name: "重置视角" }).click();
  await expect.poll(async () => Number((await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""))).toBeGreaterThan(18000);
});
