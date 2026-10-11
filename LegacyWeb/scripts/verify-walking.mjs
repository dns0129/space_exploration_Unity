import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// Runs against the actual packaged document after verifySurfaceFlight has restored a landed ship.
export async function verifyWalkingFlight(page) {
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
  const parked = await read();
  await page.locator("#flight-exit").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "walking");
  await expect(page.locator("#walking-gravity")).toContainText("9.81");
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await page.locator("#flight-land").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "ship");
  await page.locator("#flight-exit").click();
  await page.locator("#flight-camera").click();
  await expect(page.locator("#flight-camera")).toContainText("第三人称");
  await page.keyboard.down("KeyW");
  try {
    await expect.poll(async () => Number((await page.locator("#walking-distance").textContent()).replace(/[^\d.]/g, "")),
      { timeout: 45000 }).toBeGreaterThan(15);
  } finally { await page.keyboard.up("KeyW"); }
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.keyboard.down("Space");
  try {
    // Freeze the first observed airborne frame in the browser. Separate CDP
    // input round trips can outlast a short Earth jump under software rendering.
    await page.waitForFunction(() => {
      if (document.querySelector("#walking-panel")?.dataset.grounded !== "false") return false;
      document.querySelector("#flight-pause").click();
      return true;
    }, null, { timeout: 45000 });
  }
  finally { await page.keyboard.up("Space"); }
  await expect(page.locator("#flight-pause")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
  const saved = await read();
  assert.deepEqual(saved.position, parked.position, "walking must leave the parked ship fixed");
  assert.deepEqual(saved.velocity, [0, 0, 0]);
  assert.equal(saved.walking.bodyId, "earth");
  assert.equal(saved.walking.camera, "first");
  assert.equal(saved.walking.grounded, false);
  await page.locator("#flight-camera").click();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-camera")).toContainText("第三人称");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "false");
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
  const restored = await read();
  assert.deepEqual(restored.walking.offsetM, saved.walking.offsetM);
  assert.deepEqual(restored.walking.velocityMps, saved.walking.velocityMps);
  assert.equal(restored.walking.camera, saved.walking.camera);
  await page.locator("#flight-pause").click();
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true", { timeout: 45000 });
}
