import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import * as THREE from "three";

function average(image: PNG) {
  const sum = [0, 0, 0];
  let count = 0, greenSquared = 0;
  for (let y = Math.floor(image.height * 0.2); y < image.height * 0.65; y++)
    for (let x = Math.floor(image.width * 0.25); x < image.width * 0.75; x++) {
      const index = (y * image.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) sum[channel] += image.data[index + channel];
      greenSquared += image.data[index + 1] ** 2;
      count++;
    }
  const means = sum.map(value => value / count);
  return [...means, Math.sqrt(Math.max(0, greenSquared / count - means[1] ** 2))];
}

test("高空朝外保留暗空，地平线散射随下降变浓，边界连续且夜面与无大气卫星保持暗空", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  let state: any;
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  const images = new Map<string, number[]>();
  for (const [name, id, altitude, side, view] of [
    ["space", "earth", 500, -1, "outward"],
    ["edge-out", "earth", 160.1, -1, "outward"],
    ["edge-in", "earth", 159.9, -1, "outward"],
    ["entry", "earth", 100, -1, "outward"],
    ["low", "earth", 20, -1, "outward"],
    ["night", "earth", 100, 1, "outward"],
    ["moon", "moon", 20, -1, "outward"],
    ["horizon", "earth", 100, -1, "horizon"],
    ["entry-down", "earth", 100, -1, "down"],
  ] as const) {
    const body = world.bodies.find((body: any) => body.id === id);
    const up = new THREE.Vector3(0, 0, side);
    const forward = view === "horizon" ? new THREE.Vector3(1, 0, 0) : view === "down" ? up.clone().negate() : up;
    const cameraUp = view === "horizon" ? up : new THREE.Vector3(0, 1, 0);
    const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, cameraUp));
    state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar", position: new THREE.Vector3().fromArray(body.position)
      .addScaledVector(up, body.radius + altitude / world.unitsKm).toArray(), velocity: [0,0,0],
      orientation: orientation.toArray(), target: id, camera: "cockpit", assist: true, elapsed: 0 };
    if (!images.size) await page.goto("/");
    else await page.getByRole("button", { name: "行星观测", exact: true }).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: "自由航行", exact: true }).click();
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await page.locator("#flight-quality").selectOption("standard");
    await expect(page.locator("#flight-resume")).toBeEnabled();
    await page.locator("#flight-resume").click();
    await expect(page.locator("#flight-altitude")).toHaveText(`${altitude.toLocaleString("en-US", { maximumFractionDigits: 0 })} km 高度`);
    if (id === "earth" && altitude < 160) await expect(page.locator("#flight-ui")).toHaveAttribute("data-environment", "atmosphere");
    else await expect(page.locator("#flight-atmosphere")).toHaveText("真空环境 · 无大气阻力");
    const image = PNG.sync.read(await page.locator("canvas").screenshot({ style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
    images.set(name, average(image));
    await page.screenshot({ path: info.outputPath(`atmosphere-${name}.png`) });
    if (name === "entry" || name === "horizon" || name === "entry-down") {
      await page.locator("#flight-camera").click();
      await expect(page.locator("#flight-ui")).toHaveAttribute("data-environment", "atmosphere");
      const chase = PNG.sync.read(await page.locator("canvas").screenshot({ style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
      if (name !== "entry")
        expect(average(chase)[2], "外部镜头在 100 km 朝地平线或地表仍应看到大气").toBeGreaterThan(35);
      await page.screenshot({ path: info.outputPath(`atmosphere-${name}-chase.png`) });
    }
  }
  const blue = (name: string) => images.get(name)![2];
  expect(blue("entry") - blue("space"), "100 km 朝外不能被厚蓝光膜覆盖").toBeLessThan(8);
  expect(blue("horizon") - blue("entry"), "高空散射应集中在长光程的地平线").toBeGreaterThan(8);
  expect(blue("low") - blue("entry"), "向下飞行时天空应逐渐变浓").toBeGreaterThan(15);
  expect(Math.abs(blue("edge-out") - blue("edge-in")), "大气边界两侧应连续").toBeLessThan(8);
  expect(blue("low") - blue("night"), "夜面不能出现低空白昼的蓝天").toBeGreaterThan(15);
  expect(blue("low") - blue("moon"), "无大气天体不应产生蓝色天空").toBeGreaterThan(15);
  // Dark ocean should retain texture contrast, without a bright blue coating
  // artificially lifting the average brightness of the entire ground view.
  expect(images.get("entry-down")![1], "100km 俯视必须保留可见地表与云层").toBeGreaterThan(20);
  expect(images.get("entry-down")![3], "俯视地表保留云层明暗，不能只剩同色光膜").toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test("俯冲时外部镜头保持飞船在画内，并以行星地平线稳定构图", async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = await (await page.request.get("/api/world")).json();
  const earth = world.bodies.find((body: any) => body.id === "earth");
  const state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: "solar",
    position: [earth.position[0], earth.position[1], earth.position[2] - earth.radius - 100 / world.unitsKm],
    velocity: [0,0,0], orientation: [0,1,0,0], target: "earth", camera: "chase", assist: true, elapsed: 0 };
  await page.route("**/api/flight/save", route => route.fulfill({ json: { state } }));
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await expect(page.locator("#flight-resume")).toBeEnabled();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-altitude")).toHaveText("100 km 高度");
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-environment", "atmosphere");
  const image = PNG.sync.read(await page.locator("canvas").screenshot({ style: ".flight-ui, .destination-selectors { visibility: hidden !important; }" }));
  let trim = 0;
  for (let y = Math.floor(image.height * 0.2); y < image.height * 0.8; y++)
    for (let x = Math.floor(image.width * 0.25); x < image.width * 0.75; x++) {
      const i = (y * image.width + x) * 4;
      const [r,g,b] = image.data.subarray(i, i + 3);
      if (r > 35 && r > g * 1.25 && g > b * 1.25) trim++;
    }
  await page.screenshot({ path: info.outputPath("earth-atmospheric-dive.png") });
  expect(trim, "俯冲镜头应保留飞船的棕色装甲，而非把船移到视野外").toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
