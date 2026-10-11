import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import { terrainHeightKm, terrainMapNormal, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

test("地表实际渲染，L 连续降落、暂停、保存恢复与起飞，桌面和触屏均可操作", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: any) => body.id === "earth");
  // The restored photography depicts the Pacific at the old checkpoint.
  // Land on the sunlit, imaged Hilo forest so this checks actual ground colour.
  const outward = terrainMapNormal("earth", [0.06888888888888892, 0.6094444444444445]);
  const height = terrainHeightKm("earth", outward) + LANDING_CLEARANCE_KM + 0.06;
  await page.request.get("/api/flight/save");
  expect((await page.request.post("/api/flight/save", { data: {
    version: 2, worldLayoutVersion: world.layoutVersion, position: earth.position.map((value: number, i: number) => value + outward[i] * (earth.radius + height / world.unitsKm)),
    velocity: [0, 0, 0], orientation: [0, 0, 0, 1], target: "earth", camera: "chase", assist: true, elapsed: 0,
  } })).ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-atmosphere")).toContainText("气动阻力生效");
  await expect(page.locator("#flight-land")).toBeEnabled();
  if (info.project.name === "desktop") await page.keyboard.press("l");
  else await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "descending");
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-status")).toHaveText("航行已暂停");
  const frozen = await page.locator("#flight-surface-altitude").textContent();
  await page.waitForTimeout(500);
  expect(await page.locator("#flight-surface-altitude").textContent()).toBe(frozen);
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await expect(page.locator("#flight-surface-altitude")).toHaveText(/离地 0(?:\.0)? m/);
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  const saved = (await (await page.request.get("/api/flight/save")).json()).state;
  expect(saved.landedBody).toBe("earth");
  expect(saved.velocity).toEqual([0, 0, 0]);
  const pixels = PNG.sync.read(await page.locator("canvas").screenshot());
  let textured = 0, sky = 0;
  for (let y = Math.floor(pixels.height * 0.2); y < pixels.height * 0.8; y++)
    for (let x = Math.floor(pixels.width * 0.3); x < pixels.width * 0.7; x++) {
      const i = (y * pixels.width + x) * 4;
      const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
      if (g > r * 1.08 && g > b * 1.1 && g > 30) textured++;
      if (b > r * 1.1 && b > 60) sky++;
    }
  expect(textured, "地表应有绿色地形像素").toBeGreaterThan(500);
  expect(sky, "大气应有蓝色天空像素").toBeGreaterThan(500);
  await page.screenshot({ path: info.outputPath("earth-landed.png") });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "ascending");
  await expect.poll(async () => Number((await page.locator("#flight-surface-altitude").textContent())!.replace(/[^\d.]/g, ""))).toBeGreaterThan(30);
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "manual");
  expect(errors).toEqual([]);
});
