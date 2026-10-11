import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("恢复原有星球材质，近观和最高画质不再生成增强分块", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(180000);
  await page.setViewportSize({ width: 900, height: 650 });
  const requests: string[] = [], errors: string[] = [];
  page.on("request", request => requests.push(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#planet=mars");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#quality").selectOption("ultra");
  for (const id of ["mars", "venus", "jupiter", "ceres", "sun"]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await page.locator('#control-panel button[data-view="close"]').click();
    const canvas = page.locator("canvas");
    expect(await canvas.getAttribute("data-surface-detail-kind")).toBeNull();
    const image = PNG.sync.read(await canvas.screenshot());
    let visible = 0;
    for (let i = 0; i < image.data.length; i += 4)
      if (image.data[i] + image.data[i + 1] + image.data[i + 2] > 120) visible++;
    expect(visible, `${id}必须保留实际可见的原有表面`).toBeGreaterThan(5000);
  }
  expect(requests.filter(url => url.includes("surface-material-atlas"))).toEqual([]);
  expect(errors).toEqual([]);
});
