import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export const ECHO_RIFT_DESTINATIONS = [
  "echo-pulsar", "veyl", "echo-thalassa", "cinder", "ruin", "shard",
];

/** Exercise the published/embedded UI in an active flight without runtime imports. */
export async function verifyEchoRiftFlight(page) {
  const selector = page.locator("#star-system");
  await selector.selectOption("echo-rift");
  await expect(selector.locator('option[value="echo-rift"]')).toHaveText(/^回声裂隙/);
  await expect(page.locator("button[data-body]:visible")).toHaveCount(6);
  for (const id of ECHO_RIFT_DESTINATIONS)
    await expect(page.locator(`button[data-body="${id}"]`)).toBeVisible();
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "echo-rift");
  await expect(page.locator("#flight-system")).toContainText("回声裂隙");
  const echoBackground = await page.locator("canvas").getAttribute("data-background");
  assert(echoBackground, "Fictional system needs its own galactic panorama");
  await expect(page.locator("canvas")).toHaveAttribute("data-background-variant", "echo-rift");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  assert.equal(saved.systemId, "echo-rift");
  assert.equal(saved.target, "echo-pulsar");
  assert(saved.position.every(Number.isFinite));
  await selector.selectOption("solar");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await expect(page.locator("canvas")).toHaveAttribute("data-background-variant", "milky-way");
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "echo-rift");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", echoBackground);
  await expect(page.locator("canvas")).toHaveAttribute("data-background-variant", "echo-rift");
  await expect(selector).toHaveValue("echo-rift");
  for (const id of ["echo-pulsar", "veyl", "ruin", "shard"]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#flight-land")).toBeDisabled();
  }
}
