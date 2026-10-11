import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

interface StationCheckpoint {
  position: number[];
  velocity: number[];
  elapsed: number;
  target: string;
  stationVisit: {
    bodyId: string;
    positionM: number[];
    yaw: number;
    pitch: number;
    camera: "first" | "third";
  };
}

async function position(page: Page): Promise<number[]> {
  return JSON.parse((await page.locator("#canvas-host canvas").getAttribute("data-station-position-m"))!);
}

async function saveState(page: Page): Promise<StationCheckpoint> {
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/已保存 · (服务端|本机)/);
  if ((await page.locator("#flight-storage").innerText()).includes("本机"))
    return page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  return (await (await page.request.get("/api/flight/save")).json()).state;
}

async function seedState(page: Page, state: StationCheckpoint) {
  expect((await page.request.post("/api/flight/save", { data: state })).ok()).toBe(true);
  await page.evaluate(value => localStorage.setItem("voyager-flight-v1", JSON.stringify(value)), state);
}

async function launchStation(page: Page, checkpoint?: StationCheckpoint) {
  // A repeated hash navigation may retain the current paused scene. Change the
  // query to exercise a genuine document reload and fresh save-store connection.
  await page.goto(`/?station-check=${Date.now()}#planet=earth-station`);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  // Seed after pagehide has saved the old scene, before launch reads its save.
  if (checkpoint) await seedState(page, checkpoint);
  // Configure the real standard preset before launch; loading high-quality
  // global maps first can stall a software GPU across four document reloads.
  await page.locator("#quality").selectOption("standard");
  await page.locator("#flight-quality").selectOption("standard", { force: true });
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  if (checkpoint) {
    // Freeze before restoring so the saved pose can be compared without a frame
    // of movement or airborne drift after the checkpoint is applied.
    await page.locator("#flight-pause").click();
    await expect(page.locator("#flight-resume")).toBeEnabled();
    await page.locator("#flight-resume").click();
  } else {
    await expect(page.locator("#flight-land")).toBeEnabled();
    await expect(page.locator("#flight-land")).toHaveText("停泊并进入星舰（L）");
    await page.locator("#flight-land").click();
  }
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-render-mode", "station");
  await expect(page.locator("#canvas-host canvas")).toHaveAttribute("data-exploration", "station");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "station");
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
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  return async () => {
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  };
}

async function moveUntil(page: Page, input: string[], mobile: boolean, check: () => Promise<void>) {
  const release = await hold(page, input, mobile);
  try { await check(); }
  finally { await release(); }
}

test("星舰停泊、舱内移动、驾驶室与观测舱、碰撞、暂停和存档恢复", async ({ page }, info) => {
  test.setTimeout(480_000);
  const mobile = info.project.name === "mobile";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text()))
      errors.push(message.text());
  });
  await launchStation(page);
  const host = page.locator("#canvas-host canvas");
  await expect(host).toHaveAttribute("data-station-zone", "停泊区");
  await expect(host).toHaveAttribute("data-station-camera", "first");
  const spawn = await position(page);
  for (const [i, coordinate] of [0, 0, 24].entries()) expect(spawn[i]).toBeCloseTo(coordinate, 2);
  await page.screenshot({ path: info.outputPath("station-docking-bay.png") });
  await expect(page.locator("#flight-land")).toBeDisabled();
  await expect(page.locator("#flight-jump")).toBeDisabled();
  await expect(page.locator("#flight-align")).toBeDisabled();
  await expect(page.locator('button[data-body="ceres"]')).toBeDisabled();

  if (mobile) await page.locator("#flight-camera").click();
  else await page.keyboard.press("KeyC");
  await expect(host).toHaveAttribute("data-station-camera", "third");
  await page.locator("#flight-camera").click();
  await expect(host).toHaveAttribute("data-station-camera", "first");

  // A held jump must land once and remain grounded until the button is released.
  const releaseJump = await hold(page, "Space", mobile);
  try {
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "false");
    await expect(page.locator("#flight-land")).toBeDisabled();
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
    await page.waitForTimeout(300);
    await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
  } finally { await releaseJump(); }

  await page.locator("#flight-pause").click();
  const parked = await saveState(page);
  expect(parked.stationVisit.bodyId).toBe("earth-station");
  expect(parked.velocity).toEqual([0, 0, 0]);
  await page.locator("#flight-pause").click();

  await moveUntil(page, ["KeyW"], mobile, async () => {
    await expect.poll(async () => (await position(page))[2], { intervals: [100] }).toBeLessThan(22);
    await expect.poll(async () => Number((await page.locator("#walking-speed").innerText()).replace(/[^\d.]/g, "")))
      .toBeGreaterThan(2);
  });
  await moveUntil(page, ["KeyW", "ShiftLeft"], mobile, async () => {
    await expect(host).toHaveAttribute("data-station-zone", "连接廊道");
    await expect.poll(async () => Number((await page.locator("#walking-speed").innerText()).replace(/[^\d.]/g, "")))
      .toBeGreaterThan(4);
  });
  await expect(page.locator("#flight-land")).toBeDisabled();
  for (const code of ["KeyE", "KeyL", "KeyR", "KeyJ"]) await page.keyboard.press(code);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "station");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready");

  await moveUntil(page, ["KeyW", "ShiftLeft"], mobile, async () => {
    await expect(host).toHaveAttribute("data-station-zone", "驾驶室");
    // Continue toward the visible central console. Collision must stop the
    // character before the console instead of allowing a walk through it.
    await expect.poll(async () => (await position(page))[2], { intervals: [100] }).toBeLessThan(-26);
    await page.waitForTimeout(500);
    expect((await position(page))[2]).toBeGreaterThan(-27.6);
  });
  await page.locator("#flight-pause").click();
  const command = await saveState(page);
  expect(command.position).toEqual(parked.position);
  expect(command.velocity).toEqual(parked.velocity);
  expect(command.stationVisit.camera).toBe("first");
  expect(command.stationVisit.positionM[2]).toBeLessThan(-18);
  await page.screenshot({ path: info.outputPath("station-command-room.png") });
  await moveUntil(page, ["KeyW", "ArrowRight", "Space"], mobile, async () => {
    await page.waitForTimeout(600);
  });
  const frozen = await saveState(page);
  expect(frozen.stationVisit).toEqual(command.stationVisit);
  expect(frozen.elapsed).toEqual(command.elapsed);

  await launchStation(page, command);
  await expect(host).toHaveAttribute("data-station-zone", "驾驶室");
  const restored = await saveState(page);
  expect(restored.position).toEqual(command.position);
  expect(restored.stationVisit).toEqual(command.stationVisit);
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.locator("#flight-pause").click();

  // The observation bay joins the corridor on its east side. Reach it through
  // its doorway with real controls, then walk to the panoramic Earth window.
  await moveUntil(page, ["KeyS", "ShiftLeft"], mobile, async () => {
    await expect.poll(async () => (await position(page))[2], { intervals: [100] }).toBeGreaterThan(-8);
  });
  await moveUntil(page, ["KeyD", "ShiftLeft"], mobile, async () => {
    await expect(host).toHaveAttribute("data-station-zone", "观测舱");
    await expect.poll(async () => (await position(page))[0], { intervals: [100] }).toBeGreaterThan(20);
  });
  await page.locator("#flight-pause").click();
  const observation = await saveState(page);
  // Face the same window from the first-person view, preserving the position
  // reached above. Restoring this pose also checks nonzero yaw/pitch storage.
  const windowPose = {
    ...observation,
    stationVisit: { ...observation.stationVisit, yaw: -Math.PI / 2, pitch: 0.12, camera: "first" },
  };
  await launchStation(page, windowPose);
  await expect(host).toHaveAttribute("data-station-zone", "观测舱");
  await expect(host).toHaveAttribute("data-station-camera", "first");
  const windowRestored = await saveState(page);
  expect(windowRestored.stationVisit).toEqual(windowPose.stationVisit);
  await page.screenshot({ path: info.outputPath("station-earth-window.png") });

  // The hangar remains walkable; the helm now requires reaching the bridge.
  await launchStation(page, parked);
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.keyboard.press("KeyE");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-exploration", "station");
  expect(errors).toEqual([]);
});
