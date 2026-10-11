import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { PNG } from "pngjs";

export const BARNARD_DESTINATIONS = ["barnard-star", "barnard-d", "barnard-b", "barnard-c", "barnard-e"];

/** Measure the body at the centre of a real canvas, excluding most sky and HUD. */
export function barnardPixels(bytes) {
  const picture = PNG.sync.read(bytes);
  let sampled = 0, lit = 0, warm = 0;
  const tones = new Set();
  for (let y = Math.round(picture.height * .22); y < picture.height * .64; y++) {
    for (let x = Math.round(picture.width * .32); x < picture.width * .68; x++) {
      const offset = (y * picture.width + x) * 4;
      const [r, g, b] = picture.data.subarray(offset, offset + 3);
      sampled++;
      if (r + g + b > 120) {
        lit++;
        tones.add(Math.floor((r + g + b) / 24));
        if (r > g * 1.06 && g > b * 1.06) warm++;
      }
    }
  }
  return { sampled, lit, warm, tones: tones.size };
}

/** Public-site and disconnected-export navigation use the same real flight flow. */
export async function verifyBarnardFlight(page, { screenshotPath } = {}) {
  const selector = page.locator("#star-system");
  await selector.selectOption("barnard");
  await expect(page.locator("#flight-target")).toContainText("巴纳德星");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(5);
  for (const id of BARNARD_DESTINATIONS) await expect(page.locator(`button[data-body="${id}"]`)).toBeVisible();
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "barnard");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await expect(page.locator("#flight-nearest")).toContainText("巴纳德星");
  await expect(page.locator("#flight-land")).toBeDisabled();
  const star = barnardPixels(await page.locator("canvas").screenshot({
    ...(screenshotPath ? { path: screenshotPath("barnard-star-arrival") } : {}),
    timeout: 90000,
  }));
  assert(star.lit > star.sampled * .03, "Barnard arrival renders an actual stellar disk");
  assert(star.warm > star.sampled * .02, "Barnard stellar disk is warm orange-red");
  await page.locator('button[data-body="barnard-b"]').click();
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("#flight-nearest")).toHaveText("巴纳德星 b");
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "barnard");
  await expect(page.locator("#flight-land")).toBeEnabled();
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")));
  assert.equal(saved.systemId, "barnard");
  assert.equal(saved.target, "barnard-b");
  assert(saved.position.every(Number.isFinite));
  const planet = barnardPixels(await page.locator("canvas").screenshot({
    ...(screenshotPath ? { path: screenshotPath("barnard-b-arrival") } : {}),
    timeout: 90000,
  }));
  assert(planet.lit > planet.sampled * .08, "Barnard b arrival renders an actual planet");
  await selector.selectOption("solar");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).not.toHaveAttribute("data-phase", "ready");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "barnard");
  await expect(selector).toHaveValue("barnard");
  await expect(page.locator("#flight-target")).toHaveText("巴纳德星 b");
  assert.equal(await page.locator("canvas").count(), 1, "existing shared renderer handles Barnard navigation");
  return { star, planet };
}
