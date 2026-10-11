import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function checkpoint(page: Page) {
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/已保存/);
  if ((await page.locator("#flight-storage").innerText()).includes("本机"))
    return page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  return (await (await page.request.get("/api/flight/save")).json()).state;
}
async function restore(page: Page, state: unknown) {
  // Let pagehide save the old scene before installing the new checkpoint.
  await page.goto(`/?starship-check=${Date.now()}#planet=earth-station`);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  expect((await page.request.post("/api/flight/save", { data: state })).ok()).toBe(true);
  await page.evaluate(s => localStorage.setItem("voyager-flight-v1", JSON.stringify(s)), state);
  await page.locator("#quality").selectOption("standard", { force: true });
  await page.locator("#flight-quality").selectOption("standard", { force: true });
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
}

test("星舰驾驶室接管、自由飞行、外部视角、舰内走动与移动后恢复", async ({ page }, info) => {
  test.setTimeout(600000);
  await page.setViewportSize(info.project.name === "mobile" ? { width: 393, height: 700 } : { width: 960, height: 640 });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#planet=earth-station");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("h1")).toContainText("远航星舰");
  await page.locator("#quality").selectOption("standard", { force: true });
  await page.locator("#flight-quality").selectOption("standard", { force: true });
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await page.locator("#flight-land").click();
  const canvas = page.locator("#canvas-host canvas");
  await expect(canvas).toHaveAttribute("data-station-zone", "停泊区");
  await expect(page.locator("#starship-helm")).toBeDisabled();
  await page.keyboard.press("KeyE");
  await expect(canvas).toHaveAttribute("data-exploration", "station");
  await page.locator("#flight-pause").click();
  const docked = await checkpoint(page);
  // Restore a legal pose reached by walking around the central table.
  const helm = { ...docked, stationVisit: { ...docked.stationVisit, positionM: [0, 0, -36], yaw: 0, pitch: 0 } };
  await restore(page, helm);
  await expect(canvas).toHaveAttribute("data-station-zone", "驾驶室");
  await page.locator("#flight-pause").click();
  await expect(page.locator("#starship-helm")).toBeEnabled();
  await page.locator("#starship-helm").click();
  await expect(canvas).toHaveAttribute("data-exploration", "starship");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "flight");
  await page.locator("#flight-pause").click();
  const before = await checkpoint(page);
  expect(before.stationVisit.piloting).toBe(true);
  await page.locator("#flight-pause").click();
  await page.keyboard.down("KeyW");
  await expect.poll(async () => Number((await page.locator("#flight-speed").innerText()).replace(/[^\d.]/g, ""))).toBeGreaterThan(1);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(800);
  await page.keyboard.up("ArrowLeft");
  await page.locator("#flight-pause").click();
  const flown = await checkpoint(page);
  expect(Math.hypot(...flown.position.map((n: number, i: number) => n - before.position[i]))).toBeGreaterThan(0);
  expect(flown.orientation).not.toEqual(before.orientation);
  await page.locator("#flight-camera").click();
  await expect(canvas).toHaveAttribute("data-render-mode", "space");
  await page.screenshot({ path: info.outputPath("starship-exterior.png") });
  await page.locator("#flight-camera").click();
  await expect(canvas).toHaveAttribute("data-render-mode", "station");
  await page.screenshot({ path: info.outputPath("starship-bridge.png") });
  await page.locator("#flight-pause").click();
  if (info.project.name === "mobile") await page.locator("#starship-helm").click();
  else await page.keyboard.press("KeyX");
  await expect(canvas).toHaveAttribute("data-exploration", "station");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await page.keyboard.down("KeyS");
  await expect.poll(async () => JSON.parse((await canvas.getAttribute("data-station-position-m"))!)[2]).toBeGreaterThan(-35.5);
  await page.keyboard.up("KeyS");
  await page.locator("#flight-pause").click();
  const walking = await checkpoint(page);
  expect(walking.stationVisit.piloting).toBe(false);
  expect(walking.position).not.toEqual(docked.position);
  await restore(page, walking);
  await expect(canvas).toHaveAttribute("data-exploration", "station");
  const recovered = await checkpoint(page);
  expect(recovered.position).toEqual(walking.position);
  expect(recovered.orientation).toEqual(walking.orientation);
  expect(recovered.stationVisit).toEqual(walking.stationVisit);
  await restore(page, flown);
  await expect(canvas).toHaveAttribute("data-exploration", "starship");
  expect((await checkpoint(page)).stationVisit.piloting).toBe(true);
  // Navigation remains usable with the same vessel and cabin after a real warp.
  await page.locator("#flight-pause").click();
  await page.locator("#satellite-target").selectOption("moon");
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 60000 });
  await expect(page.locator("#flight-nearest")).toHaveText("月球");
  await page.locator("#starship-helm").click();
  await expect(canvas).toHaveAttribute("data-exploration", "station");
  await page.locator("#flight-pause").click();
  const lunar = await checkpoint(page);
  expect(lunar.stationVisit.vessel).toBe(true);
  expect(lunar.target).toBe("moon");
  expect(errors).toEqual([]);
});
