import { test, expect } from "@playwright/test";
import { dragEngineSlider, earthPosition, flightFixture, holdFlightInput, hudNumber,
  launchPaused, saveFlight, seedFlight } from "./flight-propulsion-helpers";

async function launch(page: any) {
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.getByRole("combobox", { name: "航行画质" }).selectOption("standard");
}

test("锁定标识居中对齐天体，转向逐帧跟随，鼠标不转向、触屏持续操纵后释放", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await launch(page);
  await page.locator("#flight-align").click();
  await expect(page.locator("#flight-marker")).not.toHaveClass(/offscreen/);
  const offset = await page.evaluate(() => {
    const marker = document.querySelector("#flight-marker")!.getBoundingClientRect();
    const canvas = document.querySelector("canvas")!.getBoundingClientRect();
    return [marker.x + marker.width / 2 - canvas.x - canvas.width / 2,
      marker.y + marker.height / 2 - canvas.y - canvas.height / 2];
  });
  expect(Math.abs(offset[0])).toBeLessThan(2);
  expect(Math.abs(offset[1])).toBeLessThan(2);
  await expect(page.locator("#flight-jump")).toBeEnabled();
  await page.keyboard.down("ArrowRight");
  const frames = await page.evaluate(async () => {
    const positions: string[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      positions.push((document.querySelector("#flight-marker") as HTMLElement).style.transform);
    }
    return new Set(positions).size;
  });
  await page.keyboard.up("ArrowRight");
  expect(frames, "锁定标识应跟随每个渲染帧，而不是慢速仪表刷新").toBeGreaterThanOrEqual(10);
  const box = (await page.locator("canvas").boundingBox())!;
  if (info.project.name === "mobile") {
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, x: point.x + 60 }] });
    await expect(page.locator("#flight-aim")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2);
    await expect(page.locator("#flight-aim")).toBeHidden();
    await page.locator("#flight-align").click();
    await expect.poll(async () => {
      const marker = await page.locator("#flight-marker").boundingBox();
      return Math.abs(marker!.x + marker!.width / 2 - box.x - box.width / 2);
    }).toBeLessThan(2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
    await page.mouse.up();
    await expect(page.locator("#flight-aim")).toBeHidden();
    const transforms = await page.evaluate(async () => {
      const values: string[] = [];
      for (let i = 0; i < 8; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        values.push((document.querySelector("#flight-marker") as HTMLElement).style.transform);
      }
      return values;
    });
    expect(new Set(transforms).size).toBe(1);
  }
  await expect(page.locator("#flight-aim")).toBeHidden();
  await page.locator("#flight-align").click();
  await page.getByRole("button", { name: "切换外部视角" }).click();
  await page.screenshot({ path: info.outputPath("explorer-chase.png") });
  expect(errors).toEqual([]);
});

test("新版引擎：十公里上方大气内使用太空档，目标加减速渐进且刹车可停稳", async ({ page }, info) => {
  test.setTimeout(180000);
  const world = await (await page.request.get("/api/world")).json();
  const mobile = info.project.name === "mobile";
  await seedFlight(page, flightFixture(world, { position: earthPosition(world, 11),
    orientation: [0, 1, 0, 0], velocity: [0, 0, 1000 / world.unitsKm], cruiseSpeedKm: 1000 }));
  await launchPaused(page);
  const panel = page.locator("#flight-propulsion");
  const speed = async () => hudNumber(await page.locator("#flight-speed").innerText());
  const target = async () => hudNumber(await page.locator("#flight-target-speed").innerText());
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-environment", "atmosphere");
  await expect(panel).toHaveAttribute("data-mode", "space");
  await expect(panel).toHaveAttribute("data-band", "transfer");
  await expect(page.locator("#flight-speed-unit")).toHaveText("km/s");
  await expect.poll(speed).toBe(1000);
  await dragEngineSlider(page, 50, mobile);
  await expect(panel).toHaveAttribute("data-band", "maneuver");
  const lowerTarget = await target();
  expect(lowerTarget).toBeGreaterThan(1);
  expect(lowerTarget).toBeLessThan(100);
  await expect.poll(speed).toBe(1000);
  const beforeSlowing = await saveFlight(page);
  expect(Math.hypot(...beforeSlowing.velocity) * world.unitsKm).toBeCloseTo(1000, 5);
  expect(beforeSlowing.cruiseSpeedKm).toBeCloseTo(lowerTarget, 1);
  await page.locator("#flight-pause").click();
  const slow = await holdFlightInput(page, "KeyW", mobile);
  try {
    await expect.poll(speed).toBeLessThan(990);
    expect(await speed()).toBeGreaterThan(lowerTarget + 5);
    await page.locator("#flight-pause").click();
  } finally { await slow(); }
  const slowing = await saveFlight(page);
  const intermediate = Math.hypot(...slowing.velocity) * world.unitsKm;
  expect(intermediate).toBeLessThan(990);
  expect(intermediate).toBeGreaterThan(lowerTarget + 5);
  expect(slowing.cruiseSpeedKm).toBeCloseTo(lowerTarget, 1);
  await dragEngineSlider(page, 350, mobile);
  await expect(panel).toHaveAttribute("data-band", "planetary");
  const higherTarget = await target();
  expect(higherTarget).toBeGreaterThan(10000);
  expect(higherTarget).toBeLessThan(50000);
  const beforeAccelerating = await saveFlight(page);
  expect(Math.hypot(...beforeAccelerating.velocity) * world.unitsKm).toBeCloseTo(intermediate, 5);
  await page.locator("#flight-pause").click();
  const accelerate = await holdFlightInput(page, "KeyW", mobile);
  try {
    await expect.poll(speed).toBeGreaterThan(intermediate + 5);
    expect(await speed()).toBeLessThan(higherTarget - 5);
    await page.locator("#flight-pause").click();
  } finally { await accelerate(); }
  const accelerating = await saveFlight(page);
  const accelerated = Math.hypot(...accelerating.velocity) * world.unitsKm;
  expect(accelerated).toBeGreaterThan(intermediate + 5);
  expect(accelerated).toBeLessThan(higherTarget - 5);
  expect(accelerating.cruiseSpeedKm).toBeCloseTo(higherTarget, 1);
  await page.locator("#flight-pause").click();
  const brake = await holdFlightInput(page, "Space", mobile);
  try { await expect.poll(speed).toBeLessThan(0.1); }
  finally { await brake(); }
  await page.locator("#flight-pause").click();
  const stopped = await saveFlight(page);
  expect(Math.hypot(...stopped.velocity) * world.unitsKm).toBeLessThan(0.15);
  expect(stopped.cruiseSpeedKm).toBeCloseTo(higherTarget, 1);
  expect(stopped.lowFlightSpeedMps).toBe(1000);
  await page.screenshot({ path: info.outputPath("progressive-propulsion.png") });
});
