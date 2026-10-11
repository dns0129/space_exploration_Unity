import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { readFile } from "node:fs/promises";
import type { FlightState, WorldConfig } from "../shared/flight-state.mjs";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

async function observe(page: Page, id = "moon") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/#planet=${id}`);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  if (await page.locator("#mobile-settings").isVisible()) await page.locator("#mobile-settings").click();
  await page.locator("#quality").selectOption("standard");
  if (await page.locator("#mobile-settings").isVisible()) await page.locator("#mobile-settings").click();
}

async function canvasPoint(page: Page, u: number, v: number) {
  const box = (await page.locator("#canvas-host canvas").boundingBox())!;
  return { x: box.x + box.width * u, y: box.y + box.height * v };
}

async function tapCanvas(page: Page, mobile: boolean, u: number, v: number) {
  const point = await canvasPoint(page, u, v);
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function dragCanvas(page: Page, mobile: boolean) {
  const start = await canvasPoint(page, 0.5, 0.5);
  const end = await canvasPoint(page, 0.65, 0.55);
  if (!mobile) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ ...start, id: 0 }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ ...end, id: 0 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}

async function savedFlight(page: Page): Promise<FlightState> {
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (服务端|本机)$/);
  if ((await page.locator("#flight-storage").innerText()).endsWith("服务端"))
    return (await (await page.request.get("/api/flight/save")).json()).state;
  return page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
}

function assertGrounded(state: FlightState, world: WorldConfig, id: string) {
  const body = world.bodies.find(candidate => candidate.id === id)!;
  const radial = state.position.map((value, i) => value - body.position[i]);
  const distance = Math.hypot(...radial);
  const normal = radial.map(value => value / distance);
  const height = (distance - body.radius) * world.unitsKm;
  expect(state.landedBody).toBe(id);
  expect(state.target).toBe(id);
  expect(state.systemId).toBe(body.systemId ?? "solar");
  expect(state.velocity).toEqual([0, 0, 0]);
  expect(height).toBeCloseTo(terrainHeightKm(id, normal) + LANDING_CLEARANCE_KM, 4);
  return normal;
}

async function assertCleanPhoto(page: Page) {
  await expect(page.locator(".observatory")).toHaveClass(/photo-mode/);
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#canvas-host canvas")).toBeVisible();
  const ui = page.locator(
    ".header, .planet-rail, .destination-selectors, .planet-info, .surface-placement, " +
    ".viewport-tools, .altitude, .interaction-hint, .mobile-settings, .control-panel, " +
    ".footer, #toast, #help-dialog, #flight-ui, .site-update, .space-stage > :not(#canvas-host)",
  );
  await expect.poll(async () => ui.evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }).map(element => element.id || element.className))).toEqual([]);
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector("#canvas-host canvas")?.getBoundingClientRect();
    if (!canvas) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(canvas.x), Math.abs(canvas.y),
      Math.abs(canvas.width - innerWidth), Math.abs(canvas.height - innerHeight));
  })).toBeLessThan(2);
  expect(await page.locator("button:visible, a:visible, input:visible, select:visible, summary:visible").count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
}

test("地表放置支持取消和拖动选点，切换天体会取消且非固体天体禁用", async ({ page }, info) => {
  test.setTimeout(180_000);
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await observe(page);
  await expect(page.locator("#place-ship")).toBeEnabled();
  await expect(page.locator("#place-person")).toBeEnabled();
  await page.locator("#place-ship").click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-placement", "ship");
  await expect(page.locator("#placement-hint")).toBeVisible();
  // Empty sky must not silently use a default landing coordinate.
  await tapCanvas(page, mobile, 0.98, 0.02);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-placement", "ship");
  // Orbiting the globe remains possible while choosing a location.
  await dragCanvas(page, mobile);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-placement", "ship");
  await page.locator("#cancel-placement").click();
  await expect(page.locator("#canvas-host")).not.toHaveAttribute("data-placement");
  await expect(page.locator("#placement-hint")).toBeHidden();
  await page.locator("#place-person").click();
  await page.locator("#place-person").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#canvas-host")).not.toHaveAttribute("data-placement");
  await page.locator("#place-ship").click();
  await page.locator('button[data-body="mars"]').click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "mars");
  await expect(page.locator("#canvas-host")).not.toHaveAttribute("data-placement");
  for (const id of ["jupiter", "sun", "earth-station"]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("#place-ship")).toBeDisabled();
    await expect(page.locator("#place-person")).toBeDisabled();
    await expect(page.locator("#surface-availability")).toBeVisible();
    await expect(page.locator("#surface-availability")).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});

test("飞船和人物落在所选地貌且可保存恢复，摄影隐藏驾驶和徒步界面", async ({ page }, info) => {
  test.setTimeout(240_000);
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const world: WorldConfig = await (await page.request.get("/api/world")).json();
  await observe(page, "mars");
  await page.locator("#place-ship").click();
  await tapCanvas(page, mobile, 0.5, 0.43);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await page.locator("#flight-quality").selectOption("standard");
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-render-mode", "surface");
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-exploration", "ship");
  await expect(page.locator("#flight-exit")).toBeEnabled();
  await expect(page.locator("#canvas-host")).not.toHaveAttribute("data-placement");
  const ship = await savedFlight(page);
  const firstNormal = assertGrounded(ship, world, "mars");
  expect(ship.walking).toBeUndefined();
  await page.screenshot({ path: info.outputPath("mars-placed-ship.png") });
  await page.locator("#photo-mode").click();
  await assertCleanPhoto(page);
  await page.screenshot({ path: info.outputPath("mars-ship-photography.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("#flight-ui")).toBeVisible();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await page.locator("#mode-observe").click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
  await page.locator("#place-person").click();
  await tapCanvas(page, mobile, 0.5, 0.56);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-render-mode", "surface");
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-exploration", "walking");
  const astronaut = await savedFlight(page);
  const secondNormal = assertGrounded(astronaut, world, "mars");
  expect(Math.hypot(...secondNormal.map((value, i) => value - firstNormal[i])),
    "不同屏幕选点应落在不同纬度，而不是同一个默认着陆点").toBeGreaterThan(0.1);
  expect(astronaut.walking?.bodyId).toBe("mars");
  expect(astronaut.walking?.grounded).toBe(true);
  expect(astronaut.walking?.camera).toBe("third");
  await page.locator("#photo-mode").click();
  await assertCleanPhoto(page);
  await page.screenshot({ path: info.outputPath("mars-walking-photography.png") });
  await page.keyboard.press("KeyP");
  await expect(page.locator("#walking-panel")).toBeVisible();
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  const restored = await savedFlight(page);
  expect(restored.position).toEqual(astronaut.position);
  expect(restored.walking?.bodyId).toBe("mars");
  expect(restored.walking?.grounded).toBe(true);
  expect(errors).toEqual([]);
});

test("摄影覆盖全屏且没有界面残留，可从焦点按钮用快捷键或双击退出", async ({ page }, info) => {
  test.setTimeout(180_000);
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await observe(page);
  // The real public-site update banner lives outside #app and has inline display styling.
  await page.evaluate(() => {
    const banner = document.createElement("aside");
    banner.className = "site-update";
    banner.style.cssText = "display:flex;position:fixed;bottom:18px;z-index:5000";
    banner.innerHTML = "<span>新版本已上线</span><button>刷新体验</button>";
    document.body.append(banner);
  });
  await expect(page.locator(".site-update")).toBeVisible();
  await page.locator("#place-ship").click();
  await page.locator("#photo-mode").focus();
  await page.keyboard.press("KeyP");
  await assertCleanPhoto(page);
  await expect(page.locator("#canvas-host")).not.toHaveAttribute("data-placement");
  await page.keyboard.press("KeyH");
  await assertCleanPhoto(page);
  expect(await page.locator("#help-dialog").evaluate(element => (element as HTMLDialogElement).open)).toBe(false);
  const pixels = PNG.sync.read(await page.locator("#canvas-host canvas").screenshot());
  let litPixels = 0;
  for (let i = 0; i < pixels.data.length; i += 4)
    if (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] > 120) litPixels++;
  expect(litPixels, "摄影画面仍必须有实际渲染的月球").toBeGreaterThan(2000);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const capturePath = info.outputPath("moon-photography-download.png");
  await download.saveAs(capturePath);
  const capturedBytes = await readFile(capturePath);
  expect([...capturedBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const captured = PNG.sync.read(capturedBytes);
  expect(captured.width).toBeGreaterThan(100);
  expect(captured.height).toBeGreaterThan(100);
  expect(captured.width / captured.height).toBeCloseTo(await page.evaluate(() => innerWidth / innerHeight), 2);
  let capturedLitPixels = 0;
  for (let i = 0; i < captured.data.length; i += 4)
    if (captured.data[i] + captured.data[i + 1] + captured.data[i + 2] > 120) capturedLitPixels++;
  expect(capturedLitPixels, "导出的 PNG 必须包含真实场景，不能是已清空的 WebGL 缓冲区").toBeGreaterThan(2000);
  await assertCleanPhoto(page);
  await page.screenshot({ path: info.outputPath("moon-photography.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".observatory")).not.toHaveClass(/photo-mode/);
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".header")).toBeVisible();
  await expect(page.locator(".site-update")).toBeVisible();
  await expect(page.locator("#place-ship")).toBeVisible();
  await page.locator("#photo-mode").click();
  await assertCleanPhoto(page);
  if (mobile) {
    const point = await canvasPoint(page, 0.5, 0.5);
    await page.evaluate(() => {
      const taps: { timestamp: number; handled: number }[] = [];
      (window as Window & { voyagerPhotoTaps?: typeof taps }).voyagerPhotoTaps = taps;
      document.querySelector("#canvas-host")!.addEventListener("pointerup", event => {
        if ((event as PointerEvent).pointerType === "touch")
          taps.push({ timestamp: event.timeStamp, handled: performance.now() });
      }, { capture: true });
    });
    const session = await page.context().newCDPSession(page);
    try {
      // Queue hardware timestamps in channel order; waiting for each render acknowledgement makes slow taps.
      const gestureTime = Date.now() / 1000 - 0.2;
      await Promise.all([
        session.send("Input.dispatchTouchEvent", {
          type: "touchStart", touchPoints: [{ ...point, id: 0 }], timestamp: gestureTime,
        }),
        session.send("Input.dispatchTouchEvent", {
          type: "touchEnd", touchPoints: [], timestamp: gestureTime + 0.04,
        }),
        session.send("Input.dispatchTouchEvent", {
          type: "touchStart", touchPoints: [{ ...point, id: 0 }], timestamp: gestureTime + 0.12,
        }),
        session.send("Input.dispatchTouchEvent", {
          type: "touchEnd", touchPoints: [], timestamp: gestureTime + 0.16,
        }),
      ]);
    } finally { await session.detach(); }
    await info.attach("photo-touch-timing", {
      body: JSON.stringify(await page.evaluate(() =>
        (window as Window & { voyagerPhotoTaps?: unknown[] }).voyagerPhotoTaps)),
      contentType: "application/json",
    });
  } else await page.locator("#canvas-host canvas").dblclick();
  await expect(page.locator(".observatory")).not.toHaveClass(/photo-mode/);
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
  expect(errors).toEqual([]);
});
