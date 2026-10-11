import { test, expect } from "@playwright/test";

test("卫星有独立观测模型、信息和锁定导航，可跃迁到月球", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#planet=moon");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  const selector = page.getByRole("combobox", { name: "卫星导航", exact: true });
  expect(await selector.locator("option").count()).toBe(27);
  for (const [id, name] of [["moon", "月球"], ["io", "木卫一"], ["titan", "土卫六"], ["miranda", "天卫五"], ["triton", "海卫一"]]) {
    await selector.selectOption(id);
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("h1")).toContainText(name);
    await expect(page.locator(".facts")).toContainText("中心");
    await page.screenshot({ path: info.outputPath(`${id}-observation.png`) });
  }
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.getByRole("combobox", { name: "航行画质" }).selectOption("standard");
  await selector.selectOption("moon");
  await expect(page.locator("#flight-target")).toHaveText("月球");
  await page.locator("#flight-align").click();
  await expect(page.locator("#flight-marker span")).toHaveText("月球");
  await page.locator("#flight-jump").click();
  await expect(selector).toBeDisabled();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("#flight-nearest")).toHaveText("月球");
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/已保存 · (服务端|本机)/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  expect(saved.target).toBe("moon");
  await selector.selectOption("io");
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-target")).toHaveText("月球");
  await page.screenshot({ path: info.outputPath("moon-arrival.png") });
  expect(errors).toEqual([]);
});

test("近地向太空推进和减速脉冲可见，不能绕过跃迁限制", async ({ page }, info) => {
  test.setTimeout(120000);
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: any) => body.id === "earth");
  await page.request.get("/api/flight/save");
  expect((await page.request.post("/api/flight/save", { data: {
    version: 2, worldLayoutVersion: world.layoutVersion, position: [earth.position[0], earth.position[1], earth.position[2] + earth.radius + 50 / world.unitsKm],
    velocity: [0, 0, 0], orientation: [0, 1, 0, 0], target: "mars", camera: "cockpit", assist: false, elapsed: 0,
  } })).ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.getByRole("combobox", { name: "航行画质" }).selectOption("standard");
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-engine")).toHaveText("行星引擎 · 向太空离地");
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await page.keyboard.down("w");
  await expect.poll(async () => Number((await page.locator("#flight-speed").innerText()).replaceAll(",", ""))).toBeGreaterThan(100);
  await page.keyboard.up("w");
  await page.keyboard.down("Space");
  await expect.poll(async () => Number(await page.locator("#flight-deceleration").evaluate(el => (el as HTMLElement).style.opacity))).toBeGreaterThan(0.2);
  await page.screenshot({ path: info.outputPath("deceleration-pulse.png") });
  await page.keyboard.up("Space");
});
