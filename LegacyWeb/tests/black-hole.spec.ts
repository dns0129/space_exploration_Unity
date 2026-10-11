import { test, expect } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyBlackHoleFlight } from "../scripts/verify-black-hole.mjs";

async function artifactDirectory(info: TestInfo) {
  const directory = resolve("test-results/black-hole", info.project.name);
  await mkdir(directory, { recursive: true });
  return directory;
}

test("黑洞真实透视着色器显示阴影、光子环、前侧吸积盘与上下透镜光弧", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  // Isolate the production model over black. A missing shader cannot pass by
  // borrowing galaxy stars or DOM decoration. This tests the artistic analytic
  // lens approximation, not the accuracy of a GR geodesic calculation.
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const size = 512;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    // Eye rays in the production shader require a perspective camera.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const model = createPlanetModel(getBody("gargantua"), new THREE.Vector3(0, 0, 1));
    scene.add(model.group);
    const shots: { name: string; image: string }[] = [];
    const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

    function capture(name: string, position: [number, number, number], time = 0, pole = false) {
      camera.position.fromArray(position);
      camera.up.set(0, pole ? 0 : 1, pole ? -1 : 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      for (const uniform of model.timeUniforms) uniform.value = time;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(size, size);
      for (let y = 0; y < size; y++)
        image.data.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), (size - y - 1) * size * 4);
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      shots.push({ name, image: canvas.toDataURL("image/png").split(",")[1] });

      const eye = camera.position.clone();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const ray = new THREE.Vector3(), impact = new THREE.Vector3();
      const shadow: number[] = [], ring: number[] = [], upperArc: number[] = [], lowerArc: number[] = [];
      const tones = new Set<number>();
      let foregroundDisk = 0, outerDisk = 0, warm = 0, lit = 0;
      let xx = 0, yy = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const light = luminance(r, g, b);
        ray.set((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1, 0.5)
          .unproject(camera).sub(eye).normalize();
        impact.copy(eye).addScaledVector(ray, Math.max(0, -eye.dot(ray)));
        const radius = impact.length(), horizontal = impact.dot(right), vertical = impact.dot(up);
        // The foreground disk legitimately crosses the shadow below center
        // for these positive-elevation cameras. Sample its upper black portion
        // rather than treating correctly rendered foreground emission as a bug.
        if (radius < 0.65 && vertical > 0.25) shadow.push(light);
        if (radius > 1.02 && radius < 1.07) ring.push(light);
        if (Math.abs(horizontal) < 0.75 && vertical > 1.15 && vertical < 1.65) upperArc.push(light);
        if (Math.abs(horizontal) < 0.65 && vertical < -1.1 && vertical > -1.42) lowerArc.push(light);
        if (light > 50) {
          lit++;
          tones.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
          if (r > b + 12 && g > b + 5) warm++;
          if (radius < 0.8) foregroundDisk++;
          if (Math.abs(horizontal) > 2 && Math.abs(vertical) < 0.55) outerDisk++;
          if (radius > 1.9) { xx += horizontal * horizontal; yy += vertical * vertical; }
        }
      }
      return { pixels, metrics: { name, lit, warm, tones: tones.size, foregroundDisk, outerDisk,
        shadowMean: mean(shadow), ringMean: mean(ring), upperArcMean: mean(upperArc), lowerArcMean: mean(lowerArc),
        shadowPixels: shadow.length, ringPixels: ring.length,
        exteriorAxisRatio: Math.sqrt(xx / Math.max(yy, 0.001)) } };
    }

    const nearSide = capture("near-side", [0, 1.8, 16]);
    const timeLater = capture("near-side-flow", [0, 1.8, 16], 9);
    const side = capture("edge-on", [0, 0, 16]);
    const azimuth = capture("different-azimuth", [11.3, 1.8, 11.3]);
    const pole = capture("pole-on", [0, 16, 0.001], 0, true);
    const close = capture("close", [0, 1.125, 10]);
    const distant = capture("distant", [0, 2.925, 26]);
    let flowingPixels = 0, azimuthPixels = 0, animationDelta = 0;
    for (let i = 0; i < nearSide.pixels.length; i += 4) {
      const temporal = Math.abs(nearSide.pixels[i] - timeLater.pixels[i])
        + Math.abs(nearSide.pixels[i + 1] - timeLater.pixels[i + 1])
        + Math.abs(nearSide.pixels[i + 2] - timeLater.pixels[i + 2]);
      const directional = Math.abs(nearSide.pixels[i] - azimuth.pixels[i])
        + Math.abs(nearSide.pixels[i + 1] - azimuth.pixels[i + 1])
        + Math.abs(nearSide.pixels[i + 2] - azimuth.pixels[i + 2]);
      if (temporal > 12) flowingPixels++;
      if (directional > 12) azimuthPixels++;
      animationDelta += temporal;
    }
    const glError = renderer.getContext().getError();
    let geometryDisposed = 0, materialDisposed = 0;
    model.surface.geometry.addEventListener("dispose", () => geometryDisposed++);
    const materials = Array.isArray(model.surface.material) ? model.surface.material : [model.surface.material];
    materials.forEach(material => material.addEventListener("dispose", () => materialDisposed++));
    target.dispose();
    model.surface.geometry.dispose();
    materials.forEach(material => material.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    return { views: [nearSide, timeLater, side, azimuth, pole, close, distant].map(view => view.metrics),
      flowingPixels, azimuthPixels, animationDelta: animationDelta / (size * size),
      geometryDisposed, materialDisposed, expectedMaterials: materials.length, glError, shots };
  });
  const directory = await artifactDirectory(info);
  for (const shot of result.shots) {
    const path = resolve(directory, `model-${shot.name}.png`);
    await writeFile(path, Buffer.from(shot.image, "base64"));
    await info.attach(`黑洞 ${shot.name}`, { path, contentType: "image/png" });
  }
  const { shots: _shots, ...metrics } = result;
  await writeFile(resolve(directory, "model-pixels.json"), JSON.stringify(metrics, null, 2));
  expect(errors, "生产着色器应成功编译且无运行时错误").toEqual([]);
  expect(result.glError).toBe(0);
  const nearSide = result.views.find(view => view.name === "near-side")!;
  const edgeOn = result.views.find(view => view.name === "edge-on")!;
  const pole = result.views.find(view => view.name === "pole-on")!;
  for (const view of result.views) {
    expect(view.lit, `${view.name} 应有实际吸积盘与光环像素`).toBeGreaterThan(300);
    expect(view.ringPixels, `${view.name} 应能解析阴影边缘`).toBeGreaterThan(20);
    expect(view.shadowMean, `${view.name} 阴影中未被前盘遮挡的区域应深黑`).toBeLessThan(8);
    expect(view.ringMean, `${view.name} 光子环应明显亮于黑色阴影`).toBeGreaterThan(view.shadowMean + 35);
  }
  expect(nearSide.foregroundDisk, "吸积盘的前侧应穿过阴影中央").toBeGreaterThan(20);
  expect(nearSide.outerDisk, "近侧观察应呈现横向延伸的盘面").toBeGreaterThan(120);
  expect(edgeOn.outerDisk, "精确侧视仍应保留可见的盘面两翼").toBeGreaterThan(120);
  expect(nearSide.upperArcMean, "阴影上方应有宽阔透镜光弧").toBeGreaterThan(35);
  expect(nearSide.lowerArcMean, "阴影下方应有弯曲透镜光弧").toBeGreaterThan(25);
  expect(nearSide.warm / nearSide.lit, "吸积盘应保留暖白至金橙色渐变").toBeGreaterThan(0.4);
  expect(nearSide.tones, "暖色盘面应保留多级色调").toBeGreaterThan(20);
  expect(nearSide.exteriorAxisRatio, "近侧观察的外盘应横向延伸").toBeGreaterThan(2);
  expect(pole.exteriorAxisRatio, "极点观察的三维盘面应转为近圆形").toBeGreaterThan(0.75);
  expect(pole.exteriorAxisRatio).toBeLessThan(1.3);
  expect(result.flowingPixels, "盘面纹理应随时间流动").toBeGreaterThan(120);
  expect(result.animationDelta).toBeGreaterThan(0.1);
  expect(result.azimuthPixels, "改变观察方位应改变实际盘面纹理").toBeGreaterThan(120);
  expect(result.views.find(view => view.name === "close")!.lit, "缩放应连续改变天体像素大小")
    .toBeGreaterThan(result.views.find(view => view.name === "distant")!.lit * 2);
  expect(result.geometryDisposed).toBe(1);
  expect(result.materialDisposed).toBe(result.expectedMaterials);
});

test("现有导航实际进入单黑洞星系，禁止地表放置并可跃迁、恢复和离开", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const directory = await artifactDirectory(info);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#star-system").selectOption("black-hole");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "gargantua");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("button[data-body]:visible")).toHaveCount(1);
  await expect(page.locator('button[data-body="gargantua"]')).toBeVisible();
  await expect(page.locator("h1")).toContainText("暗渊黑洞");
  await expect(page.locator(".description")).toContainText("艺术近似");
  await expect(page.locator(".rotation .control-label")).toContainText("光带流动");
  await expect(page.locator("#pause")).toHaveAttribute("aria-label", /光带流动/);
  await expect(page.locator(".sun-label")).toBeHidden();
  await expect(page.locator("#place-ship")).toBeDisabled();
  await expect(page.locator("#place-person")).toBeDisabled();
  await expect(page.locator("#surface-availability")).toContainText("黑洞");
  await expect(page.locator(".satellite-navigation")).toBeHidden();
  await page.screenshot({ path: resolve(directory, "observation.png") });
  await page.locator("#photo-mode").click();
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: resolve(directory, "photography.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "false");
  // Leaving the system through the same navigation retains existing planets.
  await page.locator("#star-system").selectOption("solar");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "earth");
  await expect(page.locator("#place-ship")).toBeEnabled();
  await page.getByRole("button", { name: "自由航行", exact: true }).click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-quality").selectOption("standard");
  await verifyBlackHoleFlight(page);
  await expect(page.locator("button[data-body]:visible")).toHaveCount(1);
  await expect(page.locator("#flight-target")).toHaveText("暗渊黑洞");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await expect(page.locator("#flight-land")).toHaveAttribute("title", /黑洞/);
  await page.screenshot({ path: resolve(directory, "flight-restored.png") });
  // A full reload exercises persistent storage, not only in-memory resume.
  await page.reload();
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await page.locator("#flight-resume").click();
  await expect(page.locator("canvas")).toHaveAttribute("data-system", "black-hole");
  await expect(page.locator("#star-system")).toHaveValue("black-hole");
  await expect(page.locator("#flight-land")).toBeDisabled();
  await page.screenshot({ path: resolve(directory, "flight-reloaded.png") });
  expect(errors, "桌面及窄屏真实游戏流程应无 WebGL 或 UI 错误").toEqual([]);
});

test("生产场景销毁会释放黑洞几何体、着色材质和画布", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { SolarScene } = await import("/src/planet-scene.ts");
    const host = document.createElement("div");
    host.style.cssText = "width:320px;height:240px;position:fixed;left:0;top:0";
    document.body.append(host);
    const errors: string[] = [];
    const scene = new SolarScene(host, () => {}, message => errors.push(message));
    const selected = await scene.selectBody("gargantua", () => {});
    // Inspect the actual production instance only to subscribe to Three.js
    // disposal events. The behavior under test is SolarScene.dispose itself.
    const models = (scene as any).models;
    const model = models.get("gargantua");
    if (!model) throw new Error("生产场景没有创建黑洞模型");
    const geometries = new Set<any>(), materials = new Set<any>();
    model.group.traverse((object: any) => {
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material: any) => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    let disposedGeometries = 0, disposedMaterials = 0;
    geometries.forEach(geometry => geometry.addEventListener("dispose", () => disposedGeometries++));
    materials.forEach(material => material.addEventListener("dispose", () => disposedMaterials++));
    const before = host.querySelectorAll("canvas").length;
    scene.dispose();
    const after = host.querySelectorAll("canvas").length;
    host.remove();
    return { selected, before, after, geometries: geometries.size, materials: materials.size,
      disposedGeometries, disposedMaterials, errors };
  });
  await writeFile(resolve(await artifactDirectory(info), "scene-disposal.json"), JSON.stringify(result, null, 2));
  expect(result.errors).toEqual([]);
  expect(result.selected).toBe(true);
  expect(result.geometries).toBeGreaterThan(0);
  expect(result.materials).toBeGreaterThan(0);
  expect(result.disposedGeometries).toBe(result.geometries);
  expect(result.disposedMaterials).toBe(result.materials);
  expect(result.before).toBe(1);
  expect(result.after).toBe(0);
});
