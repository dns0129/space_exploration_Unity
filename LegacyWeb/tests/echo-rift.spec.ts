import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { ECHO_RIFT_DESTINATIONS, verifyEchoRiftFlight } from "../scripts/verify-echo-rift.mjs";
import type { FlightState, WorldConfig } from "../shared/flight-state.mjs";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

async function saveState(page: Page): Promise<FlightState> {
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (服务端|本机)$/);
  return page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
}

async function selectBody(page: Page, id: string) {
  await page.locator(`button[data-body="${id}"]`).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
  await expect(page.locator("#loading-overlay")).toBeHidden();
}

test("回声裂隙六个天体实际渲染，独立银河背景和地表可用性正确", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("canvas")).toHaveAttribute("data-background-variant", "milky-way");
  await page.locator("#star-system").selectOption("echo-rift");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "echo-pulsar");
  await expect(page.locator("#star-system option:checked")).toHaveText(/^回声裂隙/);
  await expect(page.locator("button[data-body]:visible")).toHaveCount(6);
  await expect(page.locator("canvas")).toHaveAttribute("data-background-variant", "echo-rift");
  for (const id of ECHO_RIFT_DESTINATIONS) {
    await selectBody(page, id);
    const solid = id === "echo-thalassa" || id === "cinder";
    if (solid) {
      await expect(page.locator("#place-ship")).toBeEnabled();
      await expect(page.locator("#place-person")).toBeEnabled();
    } else {
      await expect(page.locator("#place-ship")).toBeDisabled();
      await expect(page.locator("#place-person")).toBeDisabled();
      await expect(page.locator("#surface-availability")).not.toBeEmpty();
    }
    // Hide the galaxy while measuring the body, so stars cannot mask a missing model.
    const settings = page.locator("#mobile-settings");
    if (await settings.isVisible()) await settings.click();
    const stars = page.locator('[data-layer="stars"]');
    if ((await stars.getAttribute("aria-checked")) === "true") await stars.click();
    const shot = PNG.sync.read(await page.locator("canvas").screenshot({
      style: ".header,.planet-rail,.destination-selectors,.planet-info,.surface-placement," +
        ".viewport-tools,.altitude,.interaction-hint,.mobile-settings,.control-panel," +
        ".footer,#toast,#flight-ui,.site-update,.space-stage>:not(#canvas-host){visibility:hidden!important}",
    }));
    let lit = 0;
    const tones = new Set<number>();
    for (let y = Math.round(shot.height * .2); y < shot.height * .7; y++) {
      for (let x = Math.round(shot.width * .2); x < shot.width * .8; x++) {
        const offset = (y * shot.width + x) * 4;
        const [r, g, b] = shot.data.subarray(offset, offset + 3);
        if (r + g + b > 90) {
          lit++;
          tones.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
        }
      }
    }
    expect(lit, `${id} 应有真实天体像素，不能只显示背景`).toBeGreaterThan(1000);
    expect(tones.size, `${id} 应显示有层次的材质`).toBeGreaterThan(8);
    await stars.click();
    if (await settings.isVisible()) await settings.click();
    await page.screenshot({ path: info.outputPath(`${id}-observation.png`) });
  }
  expect(errors).toEqual([]);
});

test("回声裂隙跨系统跃迁、独立背景及存档恢复", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?mode=flight");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await verifyEchoRiftFlight(page);
  await page.locator('button[data-body="echo-pulsar"]').click();
  const before = await saveState(page);
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "echo-rift");
  await expect(page.locator("#star-system")).toHaveValue("echo-rift");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(6);
  const restored = await saveState(page);
  expect(restored.position).toEqual(before.position);
  expect(restored.target).toBe("echo-pulsar");
  await page.screenshot({ path: info.outputPath("echo-rift-restored.png") });
  expect(errors).toEqual([]);
});

for (const id of ["echo-thalassa", "cinder"]) {
  test(`${id} 可实放飞船与人物，固体地貌与恢复位置一致`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const world: WorldConfig = await (await page.request.get("/api/world")).json();
    const body = world.bodies.find(candidate => candidate.id === id)!;
    await page.goto(`/#planet=${id}`);
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#loading-overlay")).toBeHidden();
    for (const kind of ["ship", "person"]) {
      if (kind === "person") {
        await page.locator("#mode-observe").click();
        await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
      }
      await page.locator(`#place-${kind}`).click();
      const box = (await page.locator("#canvas-host canvas").boundingBox())!;
      const point = { x: box.x + box.width * .5, y: box.y + box.height * .43 };
      if (info.project.name === "mobile") await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
      if (kind === "person") {
        await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
        await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
      } else await expect(page.locator("#flight-exit")).toBeEnabled();
      const placed = await saveState(page);
      expect(placed.landedBody).toBe(id);
      expect(placed.systemId).toBe("echo-rift");
      expect(placed.target).toBe(id);
      expect(placed.velocity).toEqual([0, 0, 0]);
      const radial = placed.position.map((value, i) => value - body.position[i]);
      const radius = Math.hypot(...radial);
      const height = (radius - body.radius) * world.unitsKm;
      expect(height).toBeCloseTo(terrainHeightKm(id, radial.map(value => value / radius)) + LANDING_CLEARANCE_KM, 4);
      if (kind === "person") expect(placed.walking?.bodyId).toBe(id);
      else expect(placed.walking).toBeUndefined();
      await page.screenshot({ path: info.outputPath(`${id}-${kind}-placed.png`) });
    }
    const saved = await saveState(page);
    await page.reload();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
    await page.locator("#mode-flight").click();
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await page.locator("#flight-resume").click();
    await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
    const restored = await saveState(page);
    expect(restored.position).toEqual(saved.position);
    expect(restored.walking?.bodyId).toBe(id);
    expect(restored.walking?.grounded).toBe(true);
    expect(errors).toEqual([]);
  });
}
