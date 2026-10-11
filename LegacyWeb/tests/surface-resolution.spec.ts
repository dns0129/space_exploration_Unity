import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const bodies = ["mars", "moon"] as const;
const surfaceFile = (body: typeof bodies[number], native: boolean) => `${body}-real${native ? "-8k" : ""}.jpg`;
const isSurfaceFile = (url: string) => /\/(mars|moon)-real(?:-8k)?\.jpg$/.test(new URL(url).pathname);

function observeSurfaceRequests(page: Page) {
  const requests: string[] = [], responses: { file: string; status: number }[] = [], errors: string[] = [];
  page.on("request", request => {
    if (isSurfaceFile(request.url())) requests.push(new URL(request.url()).pathname.split("/").pop()!);
  });
  page.on("response", response => {
    if (isSurfaceFile(response.url())) responses.push({ file: new URL(response.url()).pathname.split("/").pop()!, status: response.status() });
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "warning" && /Surface map/.test(message.text())) errors.push(message.text());
  });
  return { requests, responses, errors };
}

async function selectSurface(page: Page, body: typeof bodies[number], native: boolean) {
  if (body === "moon") await page.getByRole("combobox", { name: "卫星导航", exact: true }).selectOption(body);
  else await page.locator(`button[data-body="${body}"]`).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", body);
  await expect(page.locator("canvas")).toHaveAttribute("data-surface-map", surfaceFile(body, native));
  await expect(page.locator("canvas")).toHaveAttribute("data-surface-resolution", native ? "8192x4096" : "4096x2048");
  await expect(page.getByRole("alert")).toBeHidden();
}

function expectDetailedSurface(image: PNG, body: typeof bodies[number]) {
  let painted = 0, textured = 0, sampled = 0;
  const levels = new Set<number>();
  // Sample the lit interior of the close-view sphere, away from the sky and its limb.
  for (let y = Math.round(image.height * .3); y < image.height * .65; y++) {
    for (let x = Math.round(image.width * .4); x < image.width * .7; x++) {
      sampled++;
      const i = (y * image.width + x) * 4;
      const [r, g, b] = image.data.subarray(i, i + 3);
      const matches = body === "mars" ? r > 70 && r > g * 1.15 && g > b * 1.05
        : r + g + b > 180 && Math.abs(r - g) < 35 && Math.abs(g - b) < 35;
      if (!matches) continue;
      painted++;
      levels.add(Math.floor((r + g + b) / 24));
      const difference = Math.abs(r - image.data[i + 4]) + Math.abs(g - image.data[i + 5]) + Math.abs(b - image.data[i + 6]);
      if (difference > 6 && difference < 120) textured++;
    }
  }
  expect(painted, `${body}近观必须呈现对应颜色的完整表面`).toBeGreaterThan(sampled * .3);
  expect(levels.size, `${body}地貌必须具有不同的明暗层次`).toBeGreaterThan(6);
  expect(textured, `${body}必须实际显示地表纹理，不能仅更新分辨率标签`).toBeGreaterThan(painted * .03);
}

test("火星与月球按需加载原生 8K，手机保留完整 4K，并实际显示地表细节", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const native = info.project.name === "desktop";
  const observed = observeSurfaceRequests(page);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  expect(observed.requests, "进入地球不能预先下载火星或月球影像").toEqual([]);

  for (const body of bodies) {
    await selectSurface(page, body, native);
    await page.locator('.primary-button[data-view="close"]').click();
    await expect.poll(async () => Number((await page.locator("#altitude").innerText()).replace(/[^0-9]/g, "")))
      .toBeLessThan(body === "mars" ? 3000 : 1520);
    const image = PNG.sync.read(await page.locator("canvas").screenshot({
      path: info.outputPath(`${body}-${native ? "8k" : "4k"}-surface.png`),
      style: ".control-panel, .altitude, .toast, .viewport-tools, .mobile-settings { visibility: hidden !important; }",
    }));
    expectDetailedSurface(image, body);
  }
  await selectSurface(page, "mars", native);
  const files = bodies.map(body => surfaceFile(body, native));
  expect(observed.requests, "再次观测应复用已加载影像").toEqual(files);
  expect(observed.responses).toEqual(files.map(file => ({ file, status: 200 })));
  expect(observed.errors).toEqual([]);
});

test("原生 8K 下载失败时火星与月球恢复完整 4K 影像", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "手机直接使用 4K，不请求可选 8K 影像");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const observed = observeSurfaceRequests(page);
  await page.route(/\/textures\/(mars|moon)-real-8k\.jpg$/, route => route.abort());
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  for (const body of bodies) await selectSurface(page, body, false);
  expect(observed.requests).toEqual(bodies.flatMap(body => [surfaceFile(body, true), surfaceFile(body, false)]));
  expect(observed.responses).toEqual(bodies.map(body => ({ file: surfaceFile(body, false), status: 200 })));
  expect(observed.errors).toEqual([]);
});

test("GPU 最大纹理为 4096 时直接加载火星与月球 4K 影像", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "桌面模拟独立 GPU 限制，手机紧凑路径另行覆盖");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const getParameter = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (parameter: number) {
      return parameter === this.MAX_TEXTURE_SIZE ? 4096 : getParameter.call(this, parameter);
    };
  });
  const observed = observeSurfaceRequests(page);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  for (const body of bodies) await selectSurface(page, body, false);
  const files = bodies.map(body => surfaceFile(body, false));
  expect(observed.requests).toEqual(files);
  expect(observed.responses).toEqual(files.map(file => ({ file, status: 200 })));
  expect(observed.errors).toEqual([]);
});
