import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { FlightState, WorldConfig } from "../shared/flight-state.mjs";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

export const hudNumber = (text: string) => Number(text.replace(/,/g, "").trim());

export function flightFixture(world: WorldConfig, overrides: Partial<FlightState> = {}): FlightState {
  return {
    version: 2, worldLayoutVersion: world.layoutVersion,
    systemId: "solar", position: [1e6, 1e6, 1e6], velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1], target: "earth", camera: "cockpit", assist: false,
    elapsed: 0, cruiseSpeedKm: 100, lowFlightSpeedMps: 1000, ...overrides,
  };
}

/** Use actual terrain clearance, including the ship's landing clearance. */
export function earthPosition(world: WorldConfig, groundAltitudeKm: number): [number, number, number] {
  const earth = world.bodies.find(body => body.id === "earth")!;
  const radialAltitude = terrainHeightKm("earth", [0, 0, 1]) + LANDING_CLEARANCE_KM + groundAltitudeKm;
  return [earth.position[0], earth.position[1], earth.position[2] + earth.radius + radialAltitude / world.unitsKm];
}

export async function seedFlight(page: Page, state: FlightState) {
  if (await page.locator("#flight-ui").isVisible()) {
    // Leaving flight saves the current ship. Finish that write before seeding
    // the next snapshot, so pagehide cannot overwrite the new terrain fixture.
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/flight/save") && response.request().method() === "POST" && response.ok()),
      page.getByRole("button", { name: "行星观测", exact: true }).click(),
    ]);
    await expect(page.locator("#flight-ui")).toBeHidden();
  }
  await page.request.get("/api/flight/save");
  const response = await page.request.post("/api/flight/save", { data: state });
  expect(response.ok(), "服务器应接受真实地形高度和独立航速预设").toBe(true);
}

export async function launchPaused(page: Page) {
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.getByRole("combobox", { name: "航行画质" }).selectOption("standard");
  await page.locator("#flight-pause").click();
  await restoreFlight(page);
  await expect(page.locator("#flight-pause")).toHaveAttribute("aria-pressed", "true");
}

export async function restoreFlight(page: Page) {
  // The UI restores its loaded/saved snapshot without a second network fetch.
  await page.locator("#flight-resume").click();
}

export async function saveFlight(page: Page): Promise<FlightState> {
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/flight/save") && response.request().method() === "POST" && response.ok()),
    page.locator("#flight-save").click(),
  ]);
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  return (await (await page.request.get("/api/flight/save")).json()).state;
}

/** Drag the native thumb; never assign value or dispatch synthetic input events. */
export async function dragEngineSlider(page: Page, value: number, mobile: boolean) {
  const slider = page.locator("#flight-engine-slider");
  await expect(slider).toBeVisible();
  const geometry = await slider.evaluate(element => {
    const input = element as HTMLInputElement, box = input.getBoundingClientRect();
    const thumbWidth = parseFloat(getComputedStyle(input).getPropertyValue("--engine-thumb-size")) || 20;
    return { x: box.x, y: box.y + box.height / 2, width: box.width, thumbWidth,
      value: Number(input.value), min: Number(input.min), max: Number(input.max) };
  });
  const position = (v: number) => geometry.x + geometry.thumbWidth / 2
    + (geometry.width - geometry.thumbWidth) * (v - geometry.min) / (geometry.max - geometry.min);
  const from = position(geometry.value), to = position(value);
  if (!mobile) {
    await page.mouse.move(from, geometry.y);
    await page.mouse.down();
    await page.mouse.move(to, geometry.y, { steps: 4 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y: geometry.y, id: 0 }] });
    for (let step = 1; step <= 4; step++)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + (to - from) * step / 4, y: geometry.y, id: 0 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}

export async function holdFlightInput(page: Page, action: string, mobile: boolean) {
  if (!mobile) {
    await page.keyboard.down(action);
    return () => page.keyboard.up(action);
  }
  const box = (await page.locator(`[data-flight-input="${action}"]`).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 }] });
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
}
