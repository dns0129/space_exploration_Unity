import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("半人马座三恒星与行星可以观测，使用真实银河且可返回太阳系", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /Shader|WebGL|GL_INVALID/i.test(message.text())) errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await page.getByRole("combobox", { name: "恒星系统", exact: true }).selectOption("alpha-centauri");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "alpha-centauri-a");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await expect(page.locator(".satellite-navigation")).toBeHidden();
  for (const [id, name] of [
    ["alpha-centauri-a", "南门二 A"], ["alpha-centauri-b", "南门二 B"],
    ["proxima-centauri", "比邻星"], ["proxima-b", "比邻星 b"],
    ["proxima-c", "比邻星 c"], ["proxima-d", "比邻星 d"],
  ]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("h1")).toContainText(name);
    const pixels = PNG.sync.read(await page.locator("canvas").screenshot());
    let surface = 0;
    for (let y = Math.round(pixels.height * .2); y < pixels.height * .65; y++) {
      for (let x = Math.round(pixels.width * .3); x < pixels.width * .7; x++) {
        const offset = (y * pixels.width + x) * 4;
        if (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2] > 200) surface++;
      }
    }
    expect(surface, `${name} 应有实际渲染表面`).toBeGreaterThan(3000);
    if (id === "proxima-c" || id === "proxima-d") await expect(page.locator(".planet-tags")).toContainText("候选");
    if (id.includes("centauri")) await page.screenshot({ path: info.outputPath(`${id}.png`) });
  }
  await page.getByRole("combobox", { name: "恒星系统", exact: true }).selectOption("solar");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "earth");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await expect(page.locator(".satellite-navigation")).toBeVisible();
  expect(errors).toEqual([]);
});

test("跨系统跃迁改变位置和背景，恢复比邻星存档后仍能返回太阳系", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?mode=flight");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.getByRole("combobox", { name: "航行画质" }).selectOption("standard");
  const selector = page.getByRole("combobox", { name: "恒星系统", exact: true });
  await selector.selectOption("alpha-centauri");
  await expect(page.locator("#flight-target")).toHaveText("南门二 A");
  await expect(page.locator("#flight-distance-unit")).toHaveText("光年");
  await expect(page.locator("#flight-system")).toContainText("太阳系");
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await page.locator("#flight-jump").click();
  await expect(selector).toBeDisabled();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "alpha-centauri");
  await expect(page.locator("#flight-nearest")).toHaveText("南门二 A");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await page.locator('button[data-body="proxima-b"]').click();
  await page.locator("#flight-jump").click();
  await expect(selector).toBeDisabled();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "proxima-centauri");
  await expect(page.locator("#flight-nearest")).toHaveText("比邻星 b");
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/已保存 · (本机|服务端)/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  expect(saved.systemId).toBe("proxima-centauri");
  expect(saved.target).toBe("proxima-b");
  expect(Math.hypot(...saved.position)).toBeLessThan(2000);
  await page.screenshot({ path: info.outputPath("proxima-b-arrival.png") });
  await selector.selectOption("solar");
  await page.locator("#flight-jump").click();
  await expect(selector).toBeDisabled();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "solar");
  await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "proxima-centauri");
  await expect(page.locator("#flight-target")).toHaveText("比邻星 b");
  await expect(selector).toHaveValue("alpha-centauri");
  expect(errors).toEqual([]);
});
