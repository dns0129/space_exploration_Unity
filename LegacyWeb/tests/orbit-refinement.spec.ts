import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";

test("左右跃迁直线减速抵达，星球留在前方，存档保留落点", async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: any) => body.id === "earth");
  await page.request.get("/api/flight/save");
  for (const side of [-1, 1]) {
    if (side === 1) {
      await Promise.all([page.waitForResponse(response=>response.url().endsWith("/api/flight/save") && response.request().method()==="POST"),
        page.getByRole("button",{name:"行星观测",exact:true}).click()]);
      await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode","observe");
    }
    await page.request.post("/api/flight/save", { data: {
      version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar", position: [earth.position[0] + side * 15, earth.position[1], earth.position[2]],
      velocity: [0,0,0], orientation: [0,0,0,1], target: "earth", camera: "cockpit", assist: true, elapsed: 0,
    } });
    await page.goto("/");
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready","true");
    await page.getByRole("button",{name:"自由航行",exact:true}).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode","flight");
    await page.locator("#flight-quality").selectOption("standard");
    await expect(page.locator("canvas")).toHaveAttribute("data-ship-length-km","10");
    await page.locator("#flight-resume").click();
    await page.keyboard.press("j");
    await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "arrival", { timeout: 40_000 });
    await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
    await expect(page.locator("#flight-altitude")).toHaveText("1,100 km 高度");
    await expect(page.locator("#flight-marker")).not.toHaveClass(/offscreen/);
    await page.locator("#flight-save").click();
    await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
    const { state } = await (await page.request.get("/api/flight/save")).json();
    expect((state.position[0] - earth.position[0]) * side).toBeGreaterThan(1.17);
    expect(Math.abs(state.position[2] - earth.position[2])).toBeLessThan(0.00001);
    await page.screenshot({ path: info.outputPath(`orbit-${side < 0 ? "left" : "right"}.png`) });
  }
  expect(errors).toEqual([]);
});

test("跃迁末段实际画面从小星球连续拉近，暂停和抵达不改变姿态", async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: any) => body.id === "earth");
  await page.request.get("/api/flight/save");
  await page.request.post("/api/flight/save", { data: {
    version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar", position: [earth.position[0], earth.position[1], earth.position[2] - 256],
    velocity: [0,0,0], orientation: [0,1,0,0], target: "earth", camera: "cockpit", assist: true, elapsed: 0,
  } });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await page.locator("#flight-quality").selectOption("standard");
  await page.locator("#flight-resume").click();
  // Remove the panorama so pixel growth measures the planet rather than stars.
  await page.locator('[data-layer="stars"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.keyboard.press("j");
  const distances: number[] = [], pixels: number[] = [];
  let arrivalAttitude: number[] | undefined;
  for (const progress of [0, 25, 50, 100]) {
    if (progress) await page.locator("#flight-pause").click();
    await page.evaluate(threshold => new Promise<void>(resolve => {
      const engine = document.querySelector("#warp-engine") as HTMLElement;
      const track = document.querySelector("#warp-progress") as HTMLElement;
      const observer = new MutationObserver(check);
      function check() {
        const reached = threshold === 100 ? engine.dataset.phase === "cooldown"
          : engine.dataset.phase === "arrival" && parseFloat(track.style.width) >= threshold;
        if (!reached) return;
        observer.disconnect();
        (document.querySelector("#flight-pause") as HTMLButtonElement).click();
        resolve();
      }
      observer.observe(engine, { attributes: true, attributeFilter: ["data-phase"] });
      observer.observe(track, { attributes: true, attributeFilter: ["style"] });
      check();
    }), progress);
    await expect(page.locator("#flight-pause")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#flight-marker")).not.toHaveClass(/offscreen/);
    await page.locator("#flight-save").click();
    await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
    const { state } = await (await page.request.get("/api/flight/save")).json();
    const distance = Math.hypot(...state.position.map((value: number, axis: number) => value - earth.position[axis]));
    distances.push(distance);
    if (!arrivalAttitude) arrivalAttitude = state.orientation;
    expect(state.orientation).toEqual(arrivalAttitude);
    const image = PNG.sync.read(await page.locator("canvas").screenshot({
      path: info.outputPath(`warp-approach-${progress}.png`),
      style: ".flight-ui, .toast, .viewport-tools { visibility:hidden!important }",
    }));
    let lit = 0;
    for (let y = Math.floor(image.height * 0.25); y < image.height * 0.75; y++)
      for (let x = Math.floor(image.width * 0.25); x < image.width * 0.75; x++) {
        const index = (y * image.width + x) * 4;
        const [r, g, b] = image.data.subarray(index, index + 3);
        if (r + g + b > 260) lit++;
      }
    pixels.push(lit);
  }
  expect(distances[0]).toBeGreaterThan(20);
  expect(distances[1]).toBeLessThan(distances[0] * 0.5);
  expect(distances[2]).toBeLessThan(distances[1] * 0.5);
  expect((distances[3] - earth.radius) * world.unitsKm).toBeCloseTo(1100, 4);
  expect(pixels[2], "画面中的星球必须明显变大").toBeGreaterThan(pixels[0] * 3);
  expect(pixels[3]).toBeGreaterThan(pixels[0] * 5);
  expect(errors).toEqual([]);
});
