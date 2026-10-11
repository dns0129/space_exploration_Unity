import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

const numeric = (text: string) => Number(text.replace(/[^0-9.\-]/g, ""));

async function seedLanded(page: Page, id: string) {
  const world = await (await page.request.get("/api/world")).json();
  const body = world.bodies.find((candidate: any) => candidate.id === id);
  const height = terrainHeightKm(id, [0, 0, -1]) + LANDING_CLEARANCE_KM;
  const state = {
    version: 2,
    worldLayoutVersion: world.layoutVersion,
    position: [body.position[0], body.position[1], body.position[2] - body.radius - height / world.unitsKm],
    velocity: [0, 0, 0],
    orientation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    target: id, camera: "chase", assist: true, elapsed: 0,
    systemId: body.systemId ?? "solar", landedBody: id,
  };
  // Establish the session cookie before writing the browser's checkpoint.
  await page.request.get("/api/flight/save");
  expect((await page.request.post("/api/flight/save", { data: state })).ok()).toBe(true);
  return state;
}

async function launchAndRestore(page: Page, paused = false) {
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  if (paused) await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
}

async function saveState(page: Page) {
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  return (await (await page.request.get("/api/flight/save")).json()).state;
}

async function hold(page: Page, input: string | string[], mobile: boolean) {
  const codes = Array.isArray(input) ? input : [input];
  if (!mobile) {
    for (const code of codes) await page.keyboard.down(code);
    return async () => { for (const code of codes) await page.keyboard.up(code); };
  }
  const touchPoints = [];
  for (const [id, code] of codes.entries()) {
    const button = page.locator(`[data-flight-input="${code}"]`);
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    touchPoints.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, id });
  }
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints,
  });
  return async () => {
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  };
}

test("落地离舱、徒步和跳跃、近船返舱、暂停与存档恢复均可操作", async ({ page }, info) => {
  test.setTimeout(180_000);
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const landed = await seedLanded(page, "earth");
  await launchAndRestore(page);
  await expect(page.locator("#flight-exit")).toBeEnabled();
  if (mobile) await page.locator("#flight-exit").click();
  else await page.keyboard.press("KeyE");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#walking-gravity")).toContainText("9.81");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await expect(page.locator("#flight-align")).toBeDisabled();

  const cameraLabel = await page.locator("#flight-camera").textContent();
  if (mobile) await page.locator("#flight-camera").click();
  else await page.keyboard.press("KeyC");
  await expect(page.locator("#flight-camera")).not.toHaveText(cameraLabel!);
  await page.locator("#flight-camera").click();

  // Keep jump held through the entire flight: landing must not trigger another jump.
  const releaseJump = await hold(page, "Space", mobile);
  try {
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "false");
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
    await page.waitForTimeout(1_000);
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
  } finally { await releaseJump(); }

  // The immediate boarding path is available before moving away from the ship.
  await expect(page.locator("#flight-land")).toBeEnabled();
  if (mobile) await page.locator("#flight-land").click();
  else await page.keyboard.press("KeyE");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "flight");
  await page.locator("#flight-exit").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  const initial = await saveState(page);
  expect(initial.walking.bodyId).toBe("earth");

  const releaseWalk = await hold(page, "KeyW", mobile);
  try {
    await expect.poll(async () => numeric(await page.locator("#walking-speed").innerText())).toBeGreaterThan(1);
  } finally { await releaseWalk(); }
  const releaseRun = await hold(page, ["KeyW", "ShiftLeft"], mobile);
  try {
    await expect.poll(async () => numeric(await page.locator("#walking-speed").innerText())).toBeGreaterThan(4);
    await expect.poll(async () => numeric(await page.locator("#walking-distance").innerText())).toBeGreaterThan(22);
  } finally { await releaseRun(); }
  await expect(page.locator("#flight-land")).toBeDisabled();
  // Flight shortcuts must not move the parked ship or remotely board it.
  for (const code of ["KeyL", "KeyR", "KeyJ", "KeyE"]) await page.keyboard.press(code);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready");
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-status")).toContainText("暂停");
  const frozen = await saveState(page);
  expect(frozen.position).toEqual(landed.position);
  expect(frozen.velocity).toEqual([0, 0, 0]);
  expect(Math.hypot(...frozen.walking.offsetM.map((value: number, i: number) => value - initial.walking.offsetM[i]))).toBeGreaterThan(10);
  const releasePaused = await hold(page, "KeyW", mobile);
  try { await page.waitForTimeout(750); }
  finally { await releasePaused(); }
  const stillFrozen = await saveState(page);
  expect(stillFrozen.walking).toEqual(frozen.walking);
  expect(stillFrozen.elapsed).toEqual(frozen.elapsed);
  await page.screenshot({ path: info.outputPath("earth-walking.png") });

  await launchAndRestore(page, true);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  const restored = await saveState(page);
  expect(restored.position).toEqual(frozen.position);
  for (let i = 0; i < 3; i++) expect(restored.walking.offsetM[i]).toBeCloseTo(frozen.walking.offsetM[i], 1);
  expect(restored.walking.bodyId).toBe("earth");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.getByRole("button", { name: "行星观测", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "observe");
  await expect(page.locator('button[data-body="mars"]')).toBeEnabled();
  await page.locator('button[data-body="mars"]').click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "mars");
  expect(errors).toEqual([]);
});

test("月球徒步显示低重力，跳跃后人物腾空且飞船保持停泊", async ({ page }, info) => {
  test.setTimeout(120_000);
  const landed = await seedLanded(page, "moon");
  await launchAndRestore(page);
  await page.locator("#flight-exit").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#walking-gravity")).toContainText("1.62");
  const releaseJump = await hold(page, "Space", info.project.name === "mobile");
  try {
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "false");
    await page.locator("#flight-pause").click();
    const jumping = await saveState(page);
    expect(jumping.position).toEqual(landed.position);
    expect(jumping.walking.bodyId).toBe("moon");
    expect(jumping.walking.grounded).toBe(false);
    expect(Math.hypot(...jumping.walking.velocityMps)).toBeGreaterThan(0.1);
    await page.screenshot({ path: info.outputPath("moon-walking-jump.png") });
  } finally { await releaseJump(); }
  await launchAndRestore(page);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true", { timeout: 60_000 });
});
