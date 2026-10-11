import assert from "node:assert/strict";
import { expect } from "@playwright/test";

/** Run in an active flight, both under the Pages base and with networking disabled. */
export async function verifyBetelgeuseFlight(page) {
  const selector = page.locator("#star-system");
  await selector.selectOption("betelgeuse");
  await expect(page.locator("#flight-target")).toHaveText("参宿四");
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "betelgeuse");
  await expect(page.locator("#flight-nearest")).toHaveText("参宿四");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(1);
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 本机");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  assert.equal(saved.systemId, "betelgeuse");
  assert.equal(saved.target, "betelgeuse");
  await selector.selectOption("solar");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "betelgeuse");
  await expect(selector).toHaveValue("betelgeuse");
}
