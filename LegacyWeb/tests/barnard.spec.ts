import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { SURFACE_MAPS } from "../src/body-textures";
import { getBody, type BodyId } from "../src/solar-system";
import { BARNARD_DESTINATIONS, barnardPixels, verifyBarnardFlight } from "../scripts/verify-barnard.mjs";

function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && /Surface map/.test(message.text()))) errors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400 && /barnard.*\.(jpg|png)/.test(response.url())) errors.push(`Texture HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

test("巴纳德星与四颗已确认行星使用独立原生高清概念图并可观测", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = recordErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#star-system").selectOption("barnard");
  await expect(page.locator("button[data-body]:visible")).toHaveCount(5);
  await expect(page.locator(".satellite-navigation")).toBeHidden();
  const measurements = [];
  for (const destination of BARNARD_DESTINATIONS) {
    const id = destination as BodyId, body = getBody(id), map = SURFACE_MAPS[id]!;
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("canvas")).toHaveAttribute("data-system", "barnard");
    await expect(page.locator("canvas")).toHaveAttribute("data-background", "milky-way-4k.jpg");
    await expect(page.locator("h1")).toContainText(body.name);
    await expect(page.locator("#render-status")).toContainText("8K / 4K");
    await expect(page.locator("#render-status")).toContainText("概念");
    await expect(page.locator("canvas")).toHaveAttribute("data-surface-map", info.project.name === "mobile" ? map.compactFile! : map.file);
    await expect(page.locator("canvas")).toHaveAttribute("data-surface-resolution", info.project.name === "mobile" ? "4096x2048" : "8192x4096");
    if (id === "barnard-star") {
      await expect(page.locator(".planet-tags")).toContainText("红矮星");
      await expect(page.locator("#place-ship")).toBeDisabled();
      await expect(page.locator("#place-person")).toBeDisabled();
    } else {
      await expect(page.locator(".planet-tags")).not.toContainText("候选");
      await expect(page.locator(".description")).toContainText("未知");
      await expect(page.locator(".facts")).toContainText("概念值");
      await expect(page.locator(".facts")).toContainText("m sin i");
      await expect(page.locator("#place-ship")).toBeEnabled();
      await expect(page.locator("#place-person")).toBeEnabled();
    }
    await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-render-scale")),
      { message: `${body.name}: 静态观测应恢复完整清晰度` }).toBeGreaterThanOrEqual(.9);
    const image = await page.locator("canvas").screenshot({ path: info.outputPath(`${id}-observation.png`), timeout: 90000 });
    const pixels = barnardPixels(image);
    expect(pixels.lit, `${body.name}: 画布中心应包含实际天体表面`).toBeGreaterThan(pixels.sampled * .08);
    expect(pixels.tones, `${body.name}: 应有地形或光球纹理层次`).toBeGreaterThan(5);
    if (id === "barnard-star") expect(pixels.warm).toBeGreaterThan(pixels.sampled * .04);
    measurements.push({ id, ...pixels });
  }
  await info.attach("barnard-rendered-pixels", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
  await page.locator("#star-system").selectOption("solar");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "earth");
  await expect(page.locator(".satellite-navigation")).toBeVisible();
  expect(errors).toEqual([]);
});

test("巴纳德真实跨系统抵达、星球跃迁和本机存档继续复用同一个渲染器", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = recordErrors(page);
  await page.goto("/?mode=flight");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-mode", "flight");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  const results = await verifyBarnardFlight(page, { screenshotPath: (name: string) => info.outputPath(`${name}.png`) });
  await info.attach("barnard-arrival-pixels", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
});

test("巴纳德概念岩石地表支持真实选点、徒步和刷新恢复", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = recordErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // c's fixed orbit puts the visible hemisphere in daylight; b's same screen
  // point is on its night side, where a dry surface is correctly almost black.
  await page.goto("/#planet=barnard-c");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#place-person")).toBeEnabled();
  await page.locator("#place-person").click();
  const canvas = page.locator("#canvas-host canvas"), box = (await canvas.boundingBox())!;
  const point = { x: box.x + box.width * .5, y: box.y + box.height * .43 };
  if (info.project.name === "mobile") await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(page.locator("#walking-panel")).toHaveAttribute("data-grounded", "true");
  await page.locator("#flight-quality").selectOption("standard");
  await expect(canvas).toHaveAttribute("data-system", "barnard");
  await expect(canvas).toHaveAttribute("data-render-mode", "surface");
  await expect(canvas).toHaveAttribute("data-exploration", "walking");
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const placed = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  await page.keyboard.down("w");
  await expect.poll(async () => parseFloat((await page.locator("#walking-speed").innerText()).replaceAll(",", ""))).toBeGreaterThan(.1);
  await page.keyboard.up("w");
  await expect.poll(async () => parseFloat((await page.locator("#walking-speed").innerText()).replaceAll(",", ""))).toBeLessThan(.05);
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  expect(saved.systemId).toBe("barnard");
  expect(saved.landedBody).toBe("barnard-c");
  expect(saved.walking.bodyId).toBe("barnard-c");
  expect(saved.position).toEqual(placed.position);
  expect(Math.hypot(...saved.walking.offsetM.map((value: number, axis: number) => value - placed.walking.offsetM[axis]))).toBeGreaterThan(.01);
  await expect.poll(async () => Number(await canvas.getAttribute("data-render-scale"))).toBeGreaterThanOrEqual(.8);
  const ground = barnardPixels(await canvas.screenshot({ path: info.outputPath("barnard-c-walking.png"), timeout: 90000 }));
  expect(ground.lit, "地表探索仍应绘制真实地形像素").toBeGreaterThan(ground.sampled * .04);
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-resume").click();
  await expect(page.locator("#flight-ui")).toHaveAttribute("data-mode", "walking");
  await expect(canvas).toHaveAttribute("data-system", "barnard");
  await expect(page.locator("#star-system")).toHaveValue("barnard");
  await page.locator("#flight-pause").click();
  await page.locator("#flight-save").click();
  await expect(page.locator("#flight-storage")).toHaveText(/^已保存 · (本机|服务端)$/);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("voyager-flight-v1")!));
  expect(restored.position).toEqual(saved.position);
  expect(restored.walking.bodyId).toBe("barnard-c");
  expect(Math.hypot(...restored.walking.offsetM.map((value: number, axis: number) => value - saved.walking.offsetM[axis]))).toBeLessThan(.15);
  expect(errors).toEqual([]);
});

test("巴纳德恒星粒状纹理随视角变化，四颗行星受暖色母星照明且保持无大气", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = recordErrors(page);
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const results = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const size = 384;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(size, size);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, .01, 100);
    camera.position.set(0, .12, 3.65);
    camera.lookAt(0, 0, 0);
    const light = new THREE.Vector3(-.3, .25, .9).normalize();
    const shots: { name: string; image: string }[] = [];
    function disposeModel(model: any) {
      model.group.traverse((object: any) => {
        object.geometry?.dispose();
        const materials = object.material ? Array.isArray(object.material) ? object.material : [object.material] : [];
        materials.forEach((material: any) => material.dispose());
      });
    }
    function capture(name: string) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d")!, image = context.createImageData(size, size);
      for (let y = 0; y < size; y++) image.data.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), (size - y - 1) * size * 4);
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      shots.push({ name, image: canvas.toDataURL("image/png").split(",")[1] });
      return pixels;
    }
    const star = createPlanetModel(getBody("barnard-star"), light);
    scene.add(star.group);
    const first = capture("barnard-star-procedural-front");
    star.surface.rotation.y += .7;
    const turned = capture("barnard-star-procedural-turned");
    let changed = 0, warm = 0;
    const tones = new Set<number>();
    for (let i = 0; i < first.length; i += 4) {
      if (first[i + 3] < 250 || first[i] + first[i + 1] + first[i + 2] < 90) continue;
      if (first[i] > first[i + 1] * 1.06 && first[i + 1] > first[i + 2] * 1.06) warm++;
      tones.add(Math.floor(first[i + 1] / 8));
      if (Math.abs(first[i] - turned[i]) + Math.abs(first[i + 1] - turned[i + 1]) + Math.abs(first[i + 2] - turned[i + 2]) > 12) changed++;
    }
    scene.remove(star.group);
    disposeModel(star);
    const planets = [];
    for (const id of ["barnard-d", "barnard-b", "barnard-c", "barnard-e"]) {
      const model = createPlanetModel(getBody(id), light);
      scene.add(model.group);
      const tint = model.surface.material.uniforms.illuminantTint.value;
      const warmTint = tint.toArray();
      const lit = capture(`${id}-warm-host-light`);
      tint.setRGB(1, 1, 1);
      const neutral = capture(`${id}-neutral-comparison`);
      let pixels = 0, difference = 0;
      const warmSum = [0, 0, 0], neutralSum = [0, 0, 0];
      for (let i = 0; i < lit.length; i += 4) {
        if (lit[i + 3] < 250 || neutral[i] + neutral[i + 1] + neutral[i + 2] < 120) continue;
        pixels++;
        for (let channel = 0; channel < 3; channel++) {
          warmSum[channel] += lit[i + channel];
          neutralSum[channel] += neutral[i + channel];
          difference += Math.abs(lit[i + channel] - neutral[i + channel]);
        }
      }
      planets.push({ id, warmTint, pixels, difference: difference / Math.max(pixels, 1),
        redGreenShift: (warmSum[0] / warmSum[1]) / (neutralSum[0] / neutralSum[1]),
        blueRedShift: (warmSum[2] / warmSum[0]) / (neutralSum[2] / neutralSum[0]),
        atmosphere: !!model.layers.atmosphere, clouds: !!model.layers.clouds });
      scene.remove(model.group);
      disposeModel(model);
    }
    const solar = createPlanetModel(getBody("mars"), light);
    const solarTint = solar.surface.material.uniforms.illuminantTint.value.toArray();
    disposeModel(solar);
    const glError = renderer.getContext().getError();
    target.dispose();
    renderer.dispose();
    return { star: { changed, warm, tones: tones.size }, planets, solarTint, glError, shots };
  });
  expect(results.star.warm).toBeGreaterThan(8000);
  expect(results.star.tones).toBeGreaterThan(5);
  expect(results.star.changed, "细小光球纹理应随球面视角改变").toBeGreaterThan(3000);
  for (const planet of results.planets) {
    expect(planet.pixels).toBeGreaterThan(8000);
    expect(planet.difference, `${planet.id}: 母星色温应改变实际像素`).toBeGreaterThan(2);
    expect(planet.redGreenShift).toBeGreaterThan(1.02);
    expect(planet.blueRedShift).toBeLessThan(.98);
    expect(planet.atmosphere).toBe(false);
    expect(planet.clouds).toBe(false);
  }
  expect(results.solarTint).toEqual([1, 1, 1]);
  expect(results.glError).toBe(0);
  for (const shot of results.shots) await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  await info.attach("barnard-stellar-light-pixels", { body: JSON.stringify({ ...results, shots: undefined }, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
});
