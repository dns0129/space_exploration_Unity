import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

const bodies = [
  ["sun", "太阳", "SUN"],
  ["mercury", "水星", "MERCURY"],
  ["venus", "金星", "VENUS"],
  ["earth", "地球", "EARTH"],
  ["mars", "火星", "MARS"],
  ["jupiter", "木星", "JUPITER"],
  ["saturn", "土星", "SATURN"],
  ["uranus", "天王星", "URANUS"],
  ["neptune", "海王星", "NEPTUNE"],
] as const;

function countPixels(
  png: PNG,
  matches: (r: number, g: number, b: number) => boolean,
) {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (matches(png.data[i], png.data[i + 1], png.data[i + 2])) count++;
  }
  return count;
}

function difference(before: PNG, after: PNG) {
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const delta =
      Math.abs(before.data[i] - after.data[i]) +
      Math.abs(before.data[i + 1] - after.data[i + 1]) +
      Math.abs(before.data[i + 2] - after.data[i + 2]);
    if (delta > 60) changed++;
  }
  return changed;
}

test("太阳和八颗行星均渲染独立外观，信息与图层随天体切换", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#planet=sun");
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-body",
    "sun",
  );
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "观测设置" }).click();
  await page
    .getByRole("combobox", { name: "渲染画质" })
    .selectOption("standard");

  const colors: Record<string, (r: number, g: number, b: number) => boolean> = {
    sun: (r, g, b) => r > 140 && g > 125 && b > 100,
    mercury: (r, g, b) =>
      r > 70 && Math.abs(r - g) < 25 && Math.abs(g - b) < 28,
    venus: (r, g, b) => r > 80 && r > g * 1.1 && g > b * 1.18,
    earth: (r, g, b) => b > 45 && b > r * 1.4 && g > 25,
    mars: (r, g, b) => r > 80 && r > g * 1.25 && g > b * 1.1,
    jupiter: (r, g, b) => r > 80 && r > g * 1.05 && g > b * 1.13,
    saturn: (r, g, b) => r > 80 && r > g * 1.02 && g > b * 1.09,
    uranus: (r, g, b) => g > 80 && g > r * 1.18 && b > r * 1.16,
    neptune: (r, g, b) => b > 70 && b > g * 1.02 && b > r * 1.12,
  };
  for (const [id, name, english] of bodies) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(
      page.getByRole("heading", { name: `${name} ${english}`, exact: true }),
    ).toBeVisible();
    await expect(page.locator(`button[data-body="${id}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.locator("canvas")).toHaveAttribute(
      "aria-label",
      new RegExp(name),
    );
    const shot = PNG.sync.read(await page.locator("canvas").screenshot());
    expect(
      countPixels(shot, (r, g, b) => r + g + b > 240),
      `${name}必须呈现完整表面`,
    ).toBeGreaterThan(6000);
    expect(
      countPixels(shot, colors[id]),
      `${name}必须具有对应的材质颜色`,
    ).toBeGreaterThan(1500);
    if (id === "mercury") {
      await expect(
        page.getByRole("switch", { name: "大气", exact: true }),
      ).toBeHidden();
      await expect(
        page.getByRole("switch", { name: "云层", exact: true }),
      ).toBeHidden();
    }
    if (id === "saturn")
      await expect(page.getByRole("switch", { name: "环系" })).toBeVisible();
    if (id === "sun") {
      await expect(page.getByRole("switch", { name: "日冕" })).toBeVisible();
      await expect(page.locator('[data-view="night"]')).toBeHidden();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("neptune.png"),
    fullPage: true,
  });
  // Returning to Earth reuses the same renderer and restores its original controls.
  await page.locator('button[data-body="earth"]').click();
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-body",
    "earth",
  );
  await expect(
    page.getByRole("button", { name: "夜景", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "环系" })).toBeHidden();
  expect(errors).toEqual([]);
});

test("土星环、金星厚云与太阳日冕开关改变实际渲染", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#planet=saturn");
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-body",
    "saturn",
  );
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "观测设置" }).click();
  await page
    .getByRole("combobox", { name: "渲染画质" })
    .selectOption("standard");
  await expect(page.locator("#toast")).not.toHaveClass(/visible/);
  // Mobile controls overlap the canvas. Compare the rendered scene without their focus/hover effects.
  const captureSurface = async () =>
    PNG.sync.read(
      await page.locator("canvas").screenshot({
        style:
          ".control-panel, .altitude, .toast, .viewport-tools, .mobile-settings { visibility: hidden !important; }",
      }),
    );
  for (const [id, layer, minPixels] of [
    ["saturn", "环系", 5000],
    ["venus", "云层", 5000],
    ["sun", "日冕", 700],
  ] as const) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    // The screenshot includes the HUD; wait for its first height readout before comparing frames.
    await expect(page.locator("#altitude")).not.toContainText("—");
    const before = await captureSurface();
    const toggle = page.getByRole("switch", { name: layer, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const after = await captureSurface();
    expect(
      difference(before, after),
      `${layer}开关必须改变画面`,
    ).toBeGreaterThan(minPixels);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const restored = await captureSurface();
    expect(
      difference(before, restored),
      "暂停自转时图层恢复原有画面",
    ).toBeLessThan(100);
  }
});

test("加载地球期间切换天体，旧请求不会覆盖新模型，返回地球复用贴图", async ({
  page,
}) => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0,
    responses = 0;
  await page.route("**/textures/earth-*", async (route) => {
    requests++;
    await barrier;
    await route.continue();
  });
  page.on("response", (response) => {
    if (response.url().includes("/textures/earth-")) responses++;
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  try {
    // The resident Earth batch contains day, night, elevation and clouds.
    await expect.poll(() => requests).toBe(4);
    await page.locator('button[data-body="saturn"]').click();
    await expect(page.locator("#canvas-host")).toHaveAttribute(
      "data-body",
      "saturn",
    );
    release();
    await expect.poll(() => responses).toBe(4);
    await expect(page.locator("#canvas-host")).toHaveAttribute(
      "data-body",
      "saturn",
    );
    await page.locator('button[data-body="jupiter"]').click();
    await expect(page.locator("#canvas-host")).toHaveAttribute(
      "data-body",
      "jupiter",
    );
    await page.locator('button[data-body="earth"]').click();
    await expect(page.locator("#canvas-host")).toHaveAttribute(
      "data-body",
      "earth",
    );
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.getByRole("alert")).toBeHidden();
    expect(requests).toBe(4);
  } finally {
    release();
  }
});
