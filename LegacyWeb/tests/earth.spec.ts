import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("地球实际渲染，观察控制和图层工作正常", async ({ page }, testInfo) => {
  // Software WebGL needs more time for the denser Earth mesh and additional material layers.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("#altitude")).not.toContainText("—");
  await expect(page.getByRole("heading", { name: "地球 EARTH" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "太阳系天体" }).getByRole("button"),
  ).toHaveCount(11);
  await expect(
    page.getByRole("button", { name: "火星，切换观测" }),
  ).toBeEnabled();

  // Inspect rendered pixels, so a successful DOM with a blank/failed WebGL scene cannot pass.
  const screenshot = PNG.sync.read(await page.locator("canvas").screenshot());
  let oceanPixels = 0;
  let surfacePixels = 0;
  for (let i = 0; i < screenshot.data.length; i += 4) {
    const [r, g, b] = screenshot.data.subarray(i, i + 3);
    if (b > 45 && b > r * 1.4 && g > 25) oceanPixels++;
    if (r > 60 && g > 50 && b > 25 && Math.abs(r - g) < 70) surfacePixels++;
  }
  expect(oceanPixels, "海洋和蓝色大气必须渲染").toBeGreaterThan(3000);
  expect(surfacePixels, "陆地和云层必须渲染").toBeGreaterThan(1000);
  await page.screenshot({
    path: testInfo.outputPath("earth-overview.png"),
    fullPage: true,
  });

  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "观测设置" }).click();
  await page.getByRole("button", { name: "暂停自转" }).click();
  await expect(page.getByRole("button", { name: "继续自转" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "继续自转" }).click();
  await page.getByRole("combobox", { name: "自转演示速度" }).selectOption("5");
  await expect(
    page.getByRole("combobox", { name: "自转演示速度" }),
  ).toHaveValue("5");
  for (const layer of ["云层", "大气", "星空"]) {
    const toggle = page.getByRole("switch", { name: layer });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await page
    .getByRole("combobox", { name: "渲染画质" })
    .selectOption("standard");
  await expect(
    page.getByRole("status").filter({ hasText: "已切换标准画质" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "渲染画质" }).selectOption("high");
  await page.getByRole("button", { name: "近地", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""),
      ),
    )
    .toBeLessThan(6500);
  await page.getByRole("button", { name: "夜景", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "夜景", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () =>
      Math.abs(
        Number(
          (await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""),
        ) - 18_021,
      ),
    )
    .toBeLessThan(200);
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "观测设置" }).click();
  const nightScreenshot = PNG.sync.read(
    await page.locator("canvas").screenshot(),
  );
  let cityPixels = 0;
  for (let y = 0; y < nightScreenshot.height; y++) {
    for (
      let x = Math.floor(nightScreenshot.width / 2);
      x < nightScreenshot.width;
      x++
    ) {
      const offset = (y * nightScreenshot.width + x) * 4;
      const [r, g, b] = nightScreenshot.data.subarray(offset, offset + 3);
      if (r > 50 && r > g * 1.12 && g > b * 1.2) cityPixels++;
    }
  }
  expect(cityPixels, "夜面必须呈现暖色城市灯光").toBeGreaterThan(20);
  await page.screenshot({
    path: testInfo.outputPath("earth-night.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "重置视角" }).click();
  await expect(page.locator('[data-view="overview"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () =>
      Math.abs(
        Number(
          (await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""),
        ) - 18_549,
      ),
    )
    .toBeLessThan(100);
  const previousAltitude = Number(
    (await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""),
  );
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.locator("#altitude").innerText()).replace(/[^0-9]/g, ""),
      ),
    )
    .toBeLessThan(previousAltitude);
  await page.getByRole("button", { name: "操作指南" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭操作指南" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("贴图加载失败时可见错误，重试后恢复场景", async ({ page }) => {
  await page.route("**/textures/earth-day.jpg", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("高清贴图未能完整加载");
  await expect(
    page.getByRole("button", { name: "放大", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/textures/earth-day.jpg");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.locator("canvas")).toHaveCount(1);
});
