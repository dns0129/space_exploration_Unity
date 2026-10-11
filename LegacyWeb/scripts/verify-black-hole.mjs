import assert from "node:assert/strict";
import { expect } from "@playwright/test";

/** Same real navigation flow in the built website and the disconnected export. */
export async function verifyBlackHoleFlight(page) {
  const selector = page.locator("#star-system");
  await selector.selectOption("black-hole");
  await expect(page.locator("#flight-target-label")).toHaveText("导航目标 · 距阴影边缘");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(1);
  await expect(page.locator('button[data-body="gargantua"]')).toBeVisible();
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await expect(page.locator("#flight-land")).toHaveAttribute("title", /黑洞/);
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "black-hole");
  await expect(page.locator("canvas")).toHaveAttribute("data-black-hole-resources", "true");
  await expect(page.locator("#flight-system")).toContainText("黑洞星系");
  await expect(page.locator("#flight-altitude")).toContainText("距阴影边缘");
  await expect(page.locator("#flight-surface-altitude")).toHaveText("无固体地表");
  // Save freezes in pause; restoring must re-select the one-body system and sky.
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  assert.equal(saved.systemId, "black-hole");
  assert.equal(saved.target, "gargantua");
  assert(saved.position.every(Number.isFinite));
  assert(Math.hypot(...saved.position) >= 6 * 30000 / 6371);
  await selector.selectOption("solar");
  await expect(page.locator("#flight-target-label")).toHaveText("导航目标");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await expect(page.locator("canvas")).toHaveAttribute("data-black-hole-resources", "false");
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "black-hole");
  await expect(selector).toHaveValue("black-hole");
  await expect(page.locator("#flight-target-label")).toHaveText("导航目标 · 距阴影边缘");
  await expect(page.locator("#flight-land")).toBeDisabled();
}
