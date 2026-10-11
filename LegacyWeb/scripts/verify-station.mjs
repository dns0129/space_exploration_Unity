import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// Exercise the actual static/offline document after the planetary walking tour.
export async function verifyStationVisit(page) {
  const canvas = page.locator("#canvas-host canvas");
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  const save = async () => {
    await page.locator("#flight-save").click();
    await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
    return read();
  };
  await page.locator("#mode-observe").click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
  await page.locator("#star-system").selectOption("solar");
  await page.locator('button[data-body="earth-station"]').click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "earth-station");
  await expect(page.locator(".facts")).toContainText(/2,?400/);
  await expect(page.locator(".facts")).toContainText("360");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("#flight-land")).toBeEnabled();
  await expect(page.locator("#flight-land")).toHaveText("停泊并进入星舰（L）");
  await page.locator("#flight-land").click();
  await expect(canvas).toHaveAttribute("data-render-mode", "station");
  await expect(canvas).toHaveAttribute("data-exploration", "station");
  await expect(canvas).toHaveAttribute("data-station-zone", "停泊区");
  await expect(canvas).toHaveAttribute("data-station-camera", "first");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "station");
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await page.locator("#flight-pause").click();
  const parked = await save();
  assert.equal(parked.stationVisit.bodyId, "earth-station");
  assert.deepEqual(parked.stationVisit.positionM, [0, 0, 24]);
  assert.deepEqual(parked.velocity, [0, 0, 0]);
  await page.locator("#flight-pause").click();
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  try {
    await expect(canvas).toHaveAttribute("data-station-zone", "连接廊道", { timeout: 45000 });
  } finally {
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ShiftLeft");
  }
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-pause").click();
  const saved = await save();
  assert.deepEqual(saved.position, parked.position, "walking inside the station must leave the docked ship fixed");
  assert.deepEqual(saved.velocity, [0, 0, 0]);
  assert.equal(saved.stationVisit.bodyId, "earth-station");
  assert(saved.stationVisit.positionM[2] < 12, "W must move the person through the docking-bay doorway");
  assert.equal(saved.stationVisit.camera, "first");
  await page.locator("#flight-camera").click();
  await expect(canvas).toHaveAttribute("data-station-camera", "third");
  await page.locator("#flight-resume").click();
  await expect(canvas).toHaveAttribute("data-station-camera", "first");
  await expect(canvas).toHaveAttribute("data-station-zone", "连接廊道");
  await page.keyboard.down("KeyW");
  try { await page.waitForTimeout(300); }
  finally { await page.keyboard.up("KeyW"); }
  const restored = await save();
  assert.deepEqual(restored.stationVisit, saved.stationVisit, "restoring must preserve the paused station pose and camera");
  assert.deepEqual(restored.position, saved.position);
  assert.equal(restored.elapsed, saved.elapsed);
}
