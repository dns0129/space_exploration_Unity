import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { PNG } from "pngjs";
import { terrainHeightKm } from "../shared/surface.mjs";

function skyPixels(image: PNG, region = { top: 0.16, bottom: 0.42 }) {
  const sum = [0, 0, 0];
  let neutral = 0, blue = 0, samples = 0, luminance = 0, luminanceSquared = 0;
  for (let y = Math.floor(image.height * region.top); y < image.height * region.bottom; y++) {
    for (let x = Math.floor(image.width * 0.2); x < image.width * 0.8; x++) {
      const i = (y * image.width + x) * 4;
      const [r, g, b] = image.data.subarray(i, i + 3);
      sum[0] += r; sum[1] += g; sum[2] += b;
      const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
      luminance += light; luminanceSquared += light * light;
      // Bright nearly neutral cloud light is distinct from blue molecular scattering.
      if (r > 65 && g > 80 && b > 90 && r > g * 0.77 && g > b * 0.77) neutral++;
      if (b > r * 1.3 && b > g * 1.1) blue++;
      samples++;
    }
  }
  return { average: sum.map(value => value / samples), cloud: neutral / samples, blue: blue / samples,
    contrast: Math.sqrt(Math.max(0, luminanceSquared / samples - (luminance / samples) ** 2)) };
}

test("低空天空与不同星球云系实际出现，穿云连续、晨昏暖色、夜面和月球保持暗空", async ({ page }, info) => {
  test.setTimeout(420000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  let state: unknown;
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  const results = new Map<string, ReturnType<typeof skyPixels>>();
  for (const [name, id, altitude, side, view] of [
    ["above-clouds", "earth", 16.2, 1, "horizon"],
    ["within-clouds", "earth", 10.6, 1, "horizon"],
    ["within-clouds-nearby", "earth", 10.62, 1, "horizon"],
    ["night-clouds", "earth", 10.6, -1, "horizon"],
    ["moon-vacuum", "moon", 10.6, 1, "horizon"],
    ["low-sky", "earth", 1.2, 1, "sky"],
    ["sunset-sky", "earth", 1.2, 1, "sunset"],
    ["venus-sky", "venus", 10.6, 1, "planet-sky"],
    ["titan-sky", "titan", 10.6, 1, "planet-sky"],
    ["proxima-sky", "proxima-b", 2, 1, "planet-sky"],
  ] as const) {
    const body = world.bodies.find((body: any) => body.id === id);
    const up = new THREE.Vector3(0.45, 0, -Math.sqrt(1 - 0.45 ** 2)).multiplyScalar(side);
    // A nearby sunlit valley keeps the 1.2 km clearance below the cumulus base
    // after Earth's terrain gained kilometre-scale mountains.
    if (view === "sky") up.set(0.4623, 0, -Math.sqrt(1 - 0.4623 ** 2));
    if (view === "sunset") up.set(Math.sqrt(1 - 0.02 ** 2), 0, -0.02);
    if (view === "planet-sky") {
      const sun = world.bodies.find((candidate: any) => candidate.id === (body.hostStarId ?? "sun"));
      up.fromArray(sun.position).sub(new THREE.Vector3().fromArray(body.position)).normalize();
    }
    const forward = new THREE.Vector3(-up.z, 0, up.x);
    if (view !== "horizon") forward.multiplyScalar(0.88).addScaledVector(up, 0.45).normalize();
    const orientation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, up),
    );
    // Only these low views specify ground clearance. Entry comparisons retain
    // their fixed 10.6/10.62/16.2 km radial cloud altitudes.
    const radialAltitude = view === "sky" || view === "sunset"
      ? terrainHeightKm(id, up.toArray()) + altitude : altitude;
    state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: body.systemId ?? "solar", position: new THREE.Vector3().fromArray(body.position)
      .addScaledVector(up, body.radius + radialAltitude / world.unitsKm).toArray(), velocity: [0, 0, 0],
      orientation: orientation.toArray(), target: id, camera: "cockpit", assist: true, elapsed: 0 };
    if (results.size) await page.getByRole("button", { name: "行星观测", exact: true }).click();
    await page.getByRole("button", { name: "自由航行", exact: true }).click();
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await page.locator("#flight-quality").selectOption("standard");
    await expect(page.locator("#flight-resume")).toBeEnabled();
    await page.locator("#flight-resume").click();
    await expect(page.locator("#flight-altitude")).toHaveText(`${Math.round(radialAltitude)} km 高度`);
    const image = PNG.sync.read(await page.locator("canvas").screenshot({ style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
    // The upward view shows nearby cloud banks in the lower sky. Measuring only
    // the zenith misses those clouds; the 90% limit still stays above the horizon.
    // Horizontal entry comparisons retain their original region unchanged.
    results.set(name, skyPixels(image, view === "horizon" ? undefined : { top: 0.16, bottom: 0.9 }));
    await page.screenshot({ path: info.outputPath(`entry-${name}.png`) });
  }
  const within = results.get("within-clouds")!;
  expect(within.cloud - results.get("above-clouds")!.cloud, "进入云层后应出现明亮的立体云光").toBeGreaterThan(0.04);
  const nearby = results.get("within-clouds-nearby")!;
  expect(Math.max(...within.average.map((value, channel) => Math.abs(value - nearby.average[channel]))),
    "云层内改变20米高度不能跳变").toBeLessThan(8);
  expect(results.get("night-clouds")!.average[2], "夜面云层没有白昼光照").toBeLessThan(within.average[2] * 0.6);
  expect(results.get("moon-vacuum")!.average[2], "月球不产生地球体积云或蓝色天空").toBeLessThan(within.average[2] * 0.6);
  const low = results.get("low-sky")!;
  expect(low.average[2], "低空抬头能看见明亮天空").toBeGreaterThan(100);
  expect(low.blue, "近地云层必须留有蓝天，不能把整个视野刷成灰白").toBeGreaterThan(0.15);
  expect(low.cloud, "地表上方有独立于蓝天的积云细节").toBeGreaterThan(0.025);
  expect(low.contrast, "天空有积云轮廓与明暗，不能只填一块平色").toBeGreaterThan(6);
  const sunset = results.get("sunset-sky")!;
  expect(sunset.average[0] / Math.max(sunset.average[2], 1), "晨昏散射比日面更暖")
    .toBeGreaterThan(low.average[0] / low.average[2] + 0.15);
  for (const name of ["venus-sky", "titan-sky", "proxima-sky"]) {
    const planetary = results.get(name)!;
    expect(planetary.average[1], `${name} 应有自身的可见天空与云光`).toBeGreaterThan(60);
    expect(planetary.contrast, `${name} 云与天空要有可见层次`).toBeGreaterThan(3);
    expect(planetary.average[0] / Math.max(planetary.average[2], 1), `${name} 保留不同于地球的暖色天气`)
      .toBeGreaterThan(low.average[0] / low.average[2] + 0.1);
  }
  expect(errors).toEqual([]);
});
