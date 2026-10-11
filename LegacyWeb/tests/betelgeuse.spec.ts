import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("参宿四仅包含恒星，高清表面可观测并能跃迁、恢复和返回太阳系", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [], textures: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && /Surface map/.test(message.text()))) errors.push(message.text());
  });
  page.on("response", response => {
    if (/betelgeuse-(4|8)k\.jpg/.test(response.url())) {
      if (response.status() >= 400) errors.push(`Texture HTTP ${response.status()}`);
      textures.push(response.url());
    }
  });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  const selector = page.getByRole("combobox", { name: "恒星系统", exact: true });
  await selector.selectOption("betelgeuse");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "betelgeuse");
  await expect(page.locator("h1")).toContainText("参宿四");
  await expect(page.locator(".planet-tags")).toContainText("红超巨星");
  await expect(page.locator("#render-status")).toContainText("8K / 4K");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(1);
  await expect(page.locator(".satellite-navigation")).toBeHidden();
  expect(textures).toHaveLength(1);
  expect(textures[0]).toContain(info.project.name === "mobile" ? "betelgeuse-4k.jpg" : "betelgeuse-8k.jpg");
  await page.getByRole("button", { name: "近距离观测参宿四", exact: true }).click();
  const pixels = PNG.sync.read(await page.locator("canvas").screenshot());
  let warm = 0;
  const levels = new Set<number>();
  for (let y = Math.round(pixels.height*.3); y < pixels.height*.65; y++) {
    for (let x = Math.round(pixels.width*.4); x < pixels.width*.7; x++) {
      const i = (y*pixels.width+x)*4;
      const [r, g, b] = pixels.data.subarray(i, i+3);
      if (r > 130 && r > g && g > b) { warm++; levels.add(Math.floor(g/8)); }
    }
  }
  expect(warm, "近观应渲染橙红色光球").toBeGreaterThan(2500);
  expect(levels.size, "表面应有对流胞纹理层次").toBeGreaterThan(5);
  await page.screenshot({ path: info.outputPath("betelgeuse-close.png") });

  await selector.selectOption("solar");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await selector.selectOption("betelgeuse");
  await expect(page.locator("#flight-target")).toHaveText("参宿四");
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "betelgeuse");
  await expect(page.locator("#flight-nearest")).toHaveText("参宿四");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/已保存/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  expect(saved.systemId).toBe("betelgeuse");
  expect(saved.target).toBe("betelgeuse");
  await page.screenshot({ path: info.outputPath("betelgeuse-arrival.png") });
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "betelgeuse");
  await expect(selector).toHaveValue("betelgeuse");
  await selector.selectOption("solar");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await expect(page.locator("#flight-nearest")).toHaveText("地球");
  expect(errors).toEqual([]);
});
