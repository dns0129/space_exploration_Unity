import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { world } from "../shared/flight-state.mjs";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

// Exercise the actual packaged UI, without importing any runtime module into the browser.
export async function verifySurfaceFlight(page) {
  await page.getByRole("button", { name: "行星观测", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true", { timeout: 45000 });
  await expect(page.locator("#loading-overlay")).toBeHidden();
  const earth = world.bodies.find((body) => body.id === "earth");
  const height = terrainHeightKm("earth", [0, 0, -1]) + LANDING_CLEARANCE_KM + 0.02;
  const initial = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar",
    position: [earth.position[0], earth.position[1], earth.position[2] - earth.radius - height / world.unitsKm],
    velocity: [0, 0, 0], orientation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    target: "earth", camera: "chase", assist: true, elapsed: 0 };
  await page.evaluate((state) => localStorage.setItem("voyager-flight-v1", JSON.stringify(state)), initial);
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await expect(page.locator("#flight-target")).toHaveText("地球");
  await expect(page.locator("#flight-nearest")).toHaveText("地球", { timeout: 45000 });
  await expect(page.locator("#flight-atmosphere")).toContainText("气动阻力生效", { timeout: 45000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-render-mode", "surface");
  await expect(page.locator("canvas")).toHaveAttribute("data-space-work-active", "false");
  await expect(page.locator("#flight-orbital")).toHaveCount(0);
  await expect(page.locator("#flight-speed-unit")).toHaveText("m/s");
  const slider = page.locator("#flight-engine-slider");
  await expect(slider).toHaveAttribute("min", "1");
  await expect(slider).toHaveAttribute("max", "1000");
  await slider.evaluate(input => {
    input.value = "133";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(slider).toHaveValue("133");
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "descending");
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed", { timeout: 45000 });
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  assert.equal(saved.landedBody, "earth");
  assert.deepEqual(saved.velocity, [0, 0, 0]);
  assert.equal(saved.cruiseSpeedKm, 100);
  assert.equal(saved.lowFlightSpeedMps, 133);
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "ascending");
  await expect.poll(async () => Number((await page.locator("#flight-surface-altitude").textContent()).replace(/[^\d.]/g, ""))).toBeGreaterThan(20);
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "manual");
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await expect(slider).toHaveValue("133");
}
