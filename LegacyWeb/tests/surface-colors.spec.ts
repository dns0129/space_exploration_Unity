import { test, expect, type Page } from "@playwright/test";
import * as THREE from "three";
import { PNG } from "pngjs";
import { getBody, type BodyId } from "../src/solar-system";
import { world } from "../shared/flight-state.mjs";
import { terrainHeightKm, terrainMapNormal, LANDING_CLEARANCE_KM, TERRAIN_VERSION } from "../shared/surface.mjs";

type RGB = [number, number, number];
type Sample = { body: BodyId; label: string; uv: [number, number]; map: string; colour: "red" | "grey" | "green" };
const samples: Sample[] = [
  { body: "mars", label: "火星红色地表", uv: [.2, .5], map: "mars-real.jpg", colour: "red" },
  { body: "moon", label: "月球灰色地表", uv: [.9, .5], map: "moon-real.jpg", colour: "grey" },
  // Papua New Guinea: a sunlit vegetation cell, not ocean or Australian desert.
  { body: "earth", label: "地球绿色陆地", uv: [.9, .46], map: "earth-day.jpg", colour: "green" },
];
const pictureStyle = ".flight-ui, .destination-selectors, .toast { visibility: hidden !important; }";

function checkpoint(sample: Sample, landed: boolean) {
  const body = world.bodies.find(candidate => candidate.id === sample.body)!;
  const radial = new THREE.Vector3().fromArray(terrainMapNormal(sample.body, sample.uv)).normalize();
  const tangent = new THREE.Vector3(0, 1, 0).cross(radial).normalize();
  const up = radial.clone().cross(tangent).normalize();
  const orientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), radial.clone().negate(), up));
  const altitude = terrainHeightKm(sample.body, radial.toArray()) + LANDING_CLEARANCE_KM + (landed ? 0 : .5);
  return { version: 2, worldLayoutVersion: world.layoutVersion, terrainVersion: TERRAIN_VERSION,
    systemId: body.systemId ?? "solar", target: sample.body, camera: "cockpit", assist: false, elapsed: 0,
    position: new THREE.Vector3().fromArray(body.position).addScaledVector(radial, body.radius + altitude / world.unitsKm).toArray(),
    velocity: [0, 0, 0], orientation: orientation.toArray(), ...(landed ? { landedBody: sample.body } : {}) };
}

async function launchSaved(page: Page, sample: Sample, landed: boolean, quality: "standard" | "ultra" = "standard") {
  const state = checkpoint(sample, landed);
  // Ordinary user save, routed at the public storage API. No scene internals,
  // artificial lighting, shader injection, or new production test hooks.
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.goto(`/#planet=${sample.body}`);
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption(quality);
  // Restore while paused so gravity cannot change the chosen camera/latitude
  // while the photographic map or optional detail tiles finish loading.
  await page.locator("#flight-pause").click();
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-pause")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#flight-nearest")).toHaveText(getBody(sample.body).name);
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("data-render-mode", "surface");
  if (landed) await expect(page.locator("#flight-surface")).toHaveAttribute("data-phase", "landed");
  return canvas;
}

function chromaticity(rgb: RGB): RGB {
  const total = rgb.reduce((sum, value) => sum + value, 0);
  return rgb.map(value => value / total) as RGB;
}
function colourDistance(a: RGB, b: RGB) {
  const ca = chromaticity(a), cb = chromaticity(b);
  return ca.reduce((sum, value, channel) => sum + Math.abs(value - cb[channel]), 0);
}
function matches(rgb: RGB, colour: Sample["colour"]) {
  const [r, g, b] = rgb;
  if (colour === "red") return r > g * 1.08 && r > b * 1.15;
  if (colour === "green") return g > r * 1.08 && g > b * 1.12;
  return (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb) < .15;
}

function groundPixels(image: PNG, colour: Sample["colour"]) {
  const rgb: RGB = [0, 0, 0];
  let count = 0, matched = 0, examined = 0;
  // Cockpit looks straight down. Only the central ground patch is compared;
  // sky, horizon, overlays, and the ship silhouette cannot supply the colour.
  for (let y = Math.floor(image.height * .42); y < image.height * .58; y += 2) {
    for (let x = Math.floor(image.width * .42); x < image.width * .58; x += 2) {
      const index = (y * image.width + x) * 4;
      const pixel: RGB = [image.data[index], image.data[index + 1], image.data[index + 2]];
      examined++;
      if (Math.max(...pixel) < 8 || Math.min(...pixel) > 245) continue;
      for (let channel = 0; channel < 3; channel++) rgb[channel] += pixel[channel];
      count++;
      if (matches(pixel, colour)) matched++;
    }
  }
  expect(count, "必须有足量非黑屏、非曝光白屏的实际地面像素").toBeGreaterThan(examined * .9);
  return { rgb: rgb.map(value => value / count) as RGB, fraction: matched / count, count };
}

async function sourceColour(page: Page, sample: Sample): Promise<RGB> {
  // Independently decode the shipped photographic layer. This proves the fixed
  // sample really is red/grey/green; it does not trust diagnostic data strings.
  return page.evaluate(async ({ map, uv }) => {
    const image = new Image();
    image.src = `/textures/${map}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 12;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, uv[0] * image.naturalWidth - 6, (1 - uv[1]) * image.naturalHeight - 6, 12, 12, 0, 0, 12, 12);
    const bytes = context.getImageData(0, 0, 12, 12).data;
    const rgb = [0, 0, 0];
    for (let index = 0; index < bytes.length; index += 4)
      for (let channel = 0; channel < 3; channel++) rgb[channel] += bytes[index + channel] / 144;
    return rgb as [number, number, number];
  }, sample);
}

function expectGroundColour(stats: ReturnType<typeof groundPixels>, source: RGB, sample: Sample) {
  expect(matches(source, sample.colour), "选定的源图层区域本身必须具有预期颜色").toBe(true);
  expect(stats.fraction, "至少 75% 的真实地面像素须保留图层色相").toBeGreaterThan(.75);
  // The restored renderer keeps its original nonlinear ACES contrast curve.
  // Raw JPEG channel ratios are not display chromaticity, especially in dark
  // vegetation. Check the independently decoded source hue and the actual
  // rendered hue above, then compare rendered near/landed views below.
  const [r, g, b] = stats.rgb;
  if (sample.colour === "red") {
    expect(r / g, "火星地面必须呈红色").toBeGreaterThan(1.15);
    expect(r / b).toBeGreaterThan(1.3);
  } else if (sample.colour === "green") {
    expect(g / r, "绿色陆地地面不能变为统一的沙土色").toBeGreaterThan(1.12);
    expect(g / b).toBeGreaterThan(1.2);
  } else {
    expect(Math.max(r, g, b) / Math.min(r, g, b), "月球地面应保持中性灰色").toBeLessThan(1.15);
  }
}

for (const sample of samples) {
  test(`${sample.label}在近地与落地时均匹配真实图层像素`, async ({ browser, baseURL }, info) => {
    test.setTimeout(180_000);
    const mobile = info.project.name === "mobile";
    const results: { phase: string; source: RGB; actual: ReturnType<typeof groundPixels> }[] = [];
    for (const landed of [false, true]) {
      const context = await browser.newContext({ baseURL, reducedMotion: "reduce", deviceScaleFactor: 1,
        viewport: mobile ? { width: 393, height: 851 } : { width: 900, height: 650 }, isMobile: mobile, hasTouch: mobile });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        const canvas = await launchSaved(page, sample, landed);
        const source = await sourceColour(page, sample);
        await page.waitForTimeout(900);
        const phase = landed ? "landed" : "500m";
        const image = PNG.sync.read(await canvas.screenshot({ path: info.outputPath(`${sample.body}-${phase}-${info.project.name}.png`), style: pictureStyle }));
        const actual = groundPixels(image, sample.colour);
        results.push({ phase, source, actual });
        expectGroundColour(actual, source, sample);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
    expect(colourDistance(results[0].actual.rgb, results[1].actual.rgb), "接近地面至落地不能改变区域色相").toBeLessThan(.12);
    await info.attach("source-and-rendered-pixel-colours", { body: JSON.stringify({ body: sample.body, uv: sample.uv, results }, null, 2), contentType: "application/json" });
  });
}

test("完整地表球面切换最高画质只细化采样，保留原有影像颜色", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sample = samples.find(candidate => candidate.body === "earth")!;
  const canvas = await launchSaved(page, sample, true);
  const source = await sourceColour(page, sample);
  const before = groundPixels(PNG.sync.read(await canvas.screenshot({ style: pictureStyle })), "green");
  expectGroundColour(before, source, sample);
  await page.locator("#flight-quality").selectOption("ultra");
  const after = groundPixels(PNG.sync.read(await canvas.screenshot({ style: pictureStyle })), "green");
  expectGroundColour(after, source, sample);
  expect(colourDistance(before.rgb, after.rgb)).toBeLessThan(.12);
  expect(await canvas.getAttribute("data-surface-detail-kind")).toBeNull();
});
