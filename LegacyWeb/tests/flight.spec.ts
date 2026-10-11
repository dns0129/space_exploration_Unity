import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
const number = (text: string) => Number(text.replace(/[^0-9.]/g, ""));
async function launch(page: any) {
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-mode",
    "flight",
  );
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page
    .getByRole("combobox", { name: "航行画质" })
    .selectOption("standard");
}
async function warp(page: any) {
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 45000 });
  await page.locator("#flight-jump").click();
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "charging");
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "transit", { timeout: 30000 });
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "arrival", { timeout: 45000 });
  await expect(page.locator("#warp-engine")).toHaveAttribute("data-phase", "ready", { timeout: 30000 });
}
async function hold(page: any, action: string, mobile: boolean) {
  if (!mobile) {
    await page.keyboard.down(action);
    return () => page.keyboard.up(action);
  }
  const locator = page.locator(`[data-flight-input="${action}"]`);
  const box = await locator.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 },
    ],
  });
  return async () => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  };
}
test("自由航行真实渲染，推力、刹车、服务端保存和恢复正常", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await launch(page);
  await expect(page.getByRole("region", { name: "飞船驾驶台" })).toBeVisible();
  await expect(page.locator("#flight-propulsion")).toHaveAttribute("data-mode", "space");
  await expect(page.locator("#flight-propulsion")).toHaveAttribute("data-band", "cruise");
  await expect(page.locator("#flight-target-speed")).toHaveText("100");
  await expect(page.locator("#flight-target-speed-unit")).toHaveText("km/s");
  await expect(page.locator("#flight-engine-slider")).toHaveAttribute("max", "500");
  await expect
    .poll(async () =>
      number(await page.locator("#flight-distance").innerText()),
    )
    .toBeGreaterThan(1000);
  const shot = PNG.sync.read(await page.locator("canvas").screenshot());
  let blue = 0;
  for (let i = 0; i < shot.data.length; i += 4)
    if (shot.data[i + 2] > 60 && shot.data[i + 2] > shot.data[i] * 1.4) blue++;
  expect(blue, "航行中的地球必须真实渲染").toBeGreaterThan(1500);
  const before = number(await page.locator("#flight-distance").innerText());
  const release = await hold(page, "KeyW", info.project.name === "mobile");
  try {
    await expect
      .poll(async () => number(await page.locator("#flight-speed").innerText()))
      .toBeGreaterThan(5);
  } finally {
    await release();
  }
  await expect
    .poll(async () =>
      number(await page.locator("#flight-distance").innerText()),
    )
    .toBeLessThan(before - 1);
  const stop = await hold(page, "Space", info.project.name === "mobile");
  try {
    await expect
      .poll(async () => number(await page.locator("#flight-speed").innerText()))
      .toBeLessThan(0.1);
  } finally {
    await stop();
  }
  await page.getByRole("button", { name: "暂停航行", exact: true }).click();
  await page.getByRole("button", { name: "保存航行", exact: true }).click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  const saved = await (await page.request.get("/api/flight/save")).json();
  expect(saved.state.target).toBe("earth");
  expect(saved.state.position).toHaveLength(3);
  expect(saved.state.elapsed).toBeGreaterThan(0.1);
  const savedDistance = await page.locator("#flight-distance").innerText();
  await page.locator('button[data-body="saturn"]').click();
  await warp(page);
  await expect(page.locator("#flight-nearest")).toHaveText("土星");
  await page.getByRole("button", { name: "暂停航行", exact: true }).click();
  await page.getByRole("button", { name: "恢复存档", exact: true }).click();
  await expect(page.locator("#flight-nearest")).toHaveText("地球");
  await expect(page.locator("#flight-distance")).toHaveText(savedDistance);
  await page.getByRole("button", { name: "切换外部视角" }).click();
  await expect(
    page.getByRole("button", { name: "切换座舱视角" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("flight-chase.png") });
  await page.getByRole("button", { name: "行星观测", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-mode",
    "observe",
  );
  await expect(
    page.getByRole("heading", { name: "地球 EARTH", exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停航行", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const again = await hold(page, "KeyW", info.project.name === "mobile");
  try {
    await expect
      .poll(async () => number(await page.locator("#flight-speed").innerText()))
      .toBeGreaterThan(5);
  } finally {
    await again();
  }
  expect(errors).toEqual([]);
});
test("可在九个天体附近驾驶，刷新后恢复目的地、视角和位置", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launch(page);
  for (const [id, name] of [
    ["mercury", "水星"],
    ["venus", "金星"],
    ["mars", "火星"],
    ["jupiter", "木星"],
    ["saturn", "土星"],
    ["uranus", "天王星"],
    ["neptune", "海王星"],
    ["sun", "太阳"],
    ["earth", "地球"],
  ]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await warp(page);
    await expect(page.locator("#flight-nearest")).toHaveText(name);
    const shot = PNG.sync.read(await page.locator("canvas").screenshot());
    let surface = 0;
    for (let i = 0; i < shot.data.length; i += 4)
      if (shot.data[i] + shot.data[i + 1] + shot.data[i + 2] > 240) surface++;
    expect(surface, `${name}在连续世界中实际渲染`).toBeGreaterThan(3000);
  }
  await page.locator('button[data-body="saturn"]').click();
  await warp(page);
  await page.getByRole("button", { name: "切换外部视角" }).click();
  await page.getByRole("button", { name: "驾驶辅助：开", exact: true }).click();
  await page.getByRole("button", { name: "保存航行", exact: true }).click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  const saved = await (await page.request.get("/api/flight/save")).json();
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复存档", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "恢复存档", exact: true }).click();
  await expect(page.locator("#flight-nearest")).toHaveText("土星");
  await expect(
    page.getByRole("button", { name: "切换座舱视角" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "驾驶辅助：关", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停航行", exact: true }).click();
  await page.getByRole("button", { name: "保存航行", exact: true }).click();
  await expect(page.locator("#flight-storage")).toHaveText("已保存 · 服务端");
  const resumed = await (await page.request.get("/api/flight/save")).json();
  expect(resumed.state.position).toEqual(saved.state.position);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("flight-saturn.png") });
});
