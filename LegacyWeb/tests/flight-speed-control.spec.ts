import { test, expect } from "@playwright/test";
import { PROPULSION_BANDS } from "../shared/propulsion.mjs";
import { dragEngineSlider, earthPosition, flightFixture, hudNumber, launchPaused,
  restoreFlight, saveFlight, seedFlight } from "./flight-propulsion-helpers";

test("新版引擎：真实拖拽覆盖五档，导航折叠后独立滑块可见且保存恢复", async ({ page }, info) => {
  test.setTimeout(180000);
  const world = await (await page.request.get("/api/world")).json();
  await seedFlight(page, flightFixture(world));
  await launchPaused(page);
  const panel = page.locator("#flight-propulsion"), slider = page.locator("#flight-engine-slider");
  await expect(panel).toHaveAttribute("data-mode", "space");
  await expect(slider).toHaveAttribute("type", "range");
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "500");
  await expect(page.locator("[data-engine-band]")).toHaveCount(5);
  await expect(page.locator("#flight-orbital, #flight-engine-mode, #flight-cruise-speed")).toHaveCount(0);
  expect(await panel.evaluate(element => !!element.closest("#flight-navigation"))).toBe(false);
  const expanded = (await panel.boundingBox())!;
  await page.locator("#flight-navigation-summary").click();
  await expect(page.locator("#flight-navigation")).not.toHaveAttribute("open", "");
  await expect(page.locator("#flight-jump")).toBeHidden();
  await expect(page.locator(".planet-rail")).toBeHidden();
  await expect(page.locator(".destination-selectors")).toBeHidden();
  await expect(slider).toBeVisible();
  const collapsed = (await panel.boundingBox())!;
  expect(Math.abs(collapsed.x - expanded.x)).toBeLessThan(1);
  expect(Math.abs(collapsed.y - expanded.y)).toBeLessThan(1);
  const navigation = (await page.locator(".flight-navigation").boundingBox())!;
  expect(collapsed.y).toBeGreaterThanOrEqual(navigation.y + navigation.height - 1);
  for (const [index, band] of PROPULSION_BANDS.entries()) {
    await dragEngineSlider(page, index * 100 + 50, info.project.name === "mobile");
    await expect(panel).toHaveAttribute("data-band", band.id);
    await expect(page.locator("#flight-engine-band")).toContainText(band.name);
    await expect(page.locator("#flight-target-speed-unit")).toHaveText("km/s");
    const target = hudNumber(await page.locator("#flight-target-speed").innerText());
    expect(target).toBeGreaterThan(band.minKm);
    expect(target).toBeLessThan(band.maxKm);
    await expect(page.locator("#flight-speed")).toHaveText("0");
  }
  const selected = hudNumber(await page.locator("#flight-target-speed").innerText());
  const saved = await saveFlight(page);
  expect(saved.cruiseSpeedKm).toBeCloseTo(selected, 1);
  expect(Math.hypot(...saved.velocity)).toBe(0);
  await dragEngineSlider(page, 50, info.project.name === "mobile");
  await expect(panel).toHaveAttribute("data-band", "maneuver");
  await restoreFlight(page);
  await expect(panel).toHaveAttribute("data-band", "interstellar");
  await expect.poll(async () => hudNumber(await page.locator("#flight-target-speed").innerText())).toBeCloseTo(selected, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("five-band-engine.png") });
});

test("新版引擎：真实地形十公里边界切换米秒低空滑块，两个预设独立保存恢复", async ({ page }, info) => {
  test.setTimeout(180000);
  const world = await (await page.request.get("/api/world")).json();
  await seedFlight(page, flightFixture(world, { position: earthPosition(world, 10),
    orientation: [0, 1, 0, 0], cruiseSpeedKm: 15000 }));
  await launchPaused(page);
  const panel = page.locator("#flight-propulsion"), slider = page.locator("#flight-engine-slider");
  await expect(panel).toHaveAttribute("data-mode", "ground");
  await expect(panel).toHaveAttribute("data-band", "low");
  await expect(slider).toHaveAttribute("min", "1");
  await expect(slider).toHaveAttribute("max", "1000");
  await expect(page.locator("#flight-target-speed-unit")).toHaveText("m/s");
  await expect(page.locator("#flight-target-speed")).toHaveText("1,000");
  await expect(page.locator("#flight-engine-bands")).toBeHidden();
  await dragEngineSlider(page, 1, info.project.name === "mobile");
  await expect(page.locator("#flight-target-speed")).toHaveText("1");
  await dragEngineSlider(page, 700, info.project.name === "mobile");
  const lowSpeed = hudNumber(await page.locator("#flight-target-speed").innerText());
  expect(lowSpeed).toBeGreaterThan(680);
  expect(lowSpeed).toBeLessThan(720);
  const groundSave = await saveFlight(page);
  expect(groundSave.cruiseSpeedKm).toBe(15000);
  expect(groundSave.lowFlightSpeedMps).toBe(lowSpeed);
  expect(Math.hypot(...groundSave.velocity)).toBe(0);
  for (const [altitude, mode] of [[10.01, "space"], [9.99, "ground"]] as const) {
    await seedFlight(page, { ...groundSave, position: earthPosition(world, altitude) });
    // A fresh page loads the new server snapshot; Restore uses the UI's cache.
    await launchPaused(page);
    await expect(panel).toHaveAttribute("data-mode", mode);
    await expect(page.locator("#flight-ui")).toHaveAttribute("data-environment", "atmosphere");
    await expect(page.locator("#flight-target-speed-unit")).toHaveText(mode === "ground" ? "m/s" : "km/s");
    await expect.poll(async () => hudNumber(await page.locator("#flight-target-speed").innerText())).toBe(mode === "ground" ? lowSpeed : 15000);
    const roundTrip = await saveFlight(page);
    expect(roundTrip.cruiseSpeedKm).toBe(15000);
    expect(roundTrip.lowFlightSpeedMps).toBe(lowSpeed);
    expect(roundTrip.position).toEqual(earthPosition(world, altitude));
  }
  await page.screenshot({ path: info.outputPath("terrain-boundary-engine.png") });
});
