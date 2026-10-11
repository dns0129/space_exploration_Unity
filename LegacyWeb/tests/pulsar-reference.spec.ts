import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("蓝白脉冲星具有可辨认的等离子核心、白色亮边、细长双喷流和独立尘雾环", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  // A fixed camera and black background isolate the actual production model:
  // neither a galaxy texture nor a brighter background can satisfy these checks.
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const size = 512;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-5.6, 5.6, 5.6, -5.6, 0.1, 100);
    camera.position.set(0, 0.35, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const model = createPlanetModel(getBody("echo-pulsar"), new THREE.Vector3(0, 0, 1));
    scene.add(model.group);
    const jets = model.group.getObjectByName("pulsar-jets");
    const nebula = model.group.getObjectByName("pulsar-nebula");
    const corona = model.group.getObjectByName("pulsar-corona");
    if (!jets || !nebula || !corona) throw new Error("脉冲星必须包含可单独渲染的喷流、尘雾环和日冕");
    const layers = [model.surface, jets, nebula, corona];
    const shots: { name: string; image: string }[] = [];
    function capture(name: string, enabled: typeof layers, span = 5.6) {
      layers.forEach(layer => { layer.visible = enabled.includes(layer); });
      camera.left = -span; camera.right = span; camera.top = span; camera.bottom = -span;
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        image.data.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), (size - y - 1) * size * 4);
      }
      // RGB already holds the additive light over black; flatten diagnostic PNG
      // alpha so image viewers do not attenuate the transparent glow again.
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      shots.push({ name, image: canvas.toDataURL("image/png").split(",")[1] });
      return pixels;
    }
    const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const surface = capture("pulsar-core", [model.surface], 1.2);
    const coreValues: number[] = [], rimValues: number[] = [];
    let chromaticCore = 0, whiteCore = 0;
    const tones = new Set<number>();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5 - size / 2) * 2.4 / size, (y + 0.5 - size / 2) * 2.4 / size);
      const i = (y * size + x) * 4, r = surface[i], g = surface[i + 1], b = surface[i + 2];
      const light = luminance(r, g, b);
      if (radius < 0.70) {
        coreValues.push(light);
        if (b > g + 8 && b > r && Math.min(r, g, b) < 235) chromaticCore++;
        if (Math.min(r, g, b) > 245) whiteCore++;
        tones.add((r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3));
      } else if (radius > 0.90 && radius < 0.98) rimValues.push(light);
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const coreMean = mean(coreValues);
    const coreDeviation = Math.sqrt(mean(coreValues.map(value => (value - coreMean) ** 2)));
    // Average small areas before measuring contrast. Uniform blue covered in
    // bright single-pixel noise can pass a per-pixel variance check, but does not
    // reproduce the reference's larger swirling plasma regions.
    const patchMeans: number[] = [], patchSize = 32;
    for (let y = 0; y < size; y += patchSize) for (let x = 0; x < size; x += patchSize) {
      if (Math.hypot(x + patchSize / 2 - size / 2, y + patchSize / 2 - size / 2) > 120) continue;
      let light = 0;
      for (let py = y; py < y + patchSize; py++) for (let px = x; px < x + patchSize; px++) {
        const i = (py * size + px) * 4;
        light += luminance(surface[i], surface[i + 1], surface[i + 2]);
      }
      patchMeans.push(light / (patchSize * patchSize));
    }
    const patchMean = mean(patchMeans);
    const corePatchDeviation = Math.sqrt(mean(patchMeans.map(value => (value - patchMean) ** 2)));
    const jetPixels = capture("pulsar-jets", [jets]);
    const radiusPixels = size / 11.2;
    type LightPoint = { x: number; y: number; light: number };
    function points(pixels: Uint8Array, threshold: number) {
      const result: LightPoint[] = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const light = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (light > threshold) result.push({ x: x + 0.5 - size / 2, y: y + 0.5 - size / 2, light });
      }
      return result;
    }
    function axes(values: LightPoint[]) {
      let xx = 0, xy = 0, yy = 0;
      for (const point of values) { xx += point.x ** 2; xy += point.x * point.y; yy += point.y ** 2; }
      xx /= values.length; xy /= values.length; yy /= values.length;
      const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
      const major = (xx + yy + discriminant) / 2, minor = (xx + yy - discriminant) / 2;
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
      return { ratio: Math.sqrt(major / Math.max(minor, 0.001)), x: Math.cos(angle), y: Math.sin(angle) };
    }
    const jetPoints = points(jetPixels, 35), jetAxis = axes(jetPoints);
    const lobes = [-1, 1].map(sign => {
      const lobe = jetPoints.filter(point => sign * (point.x * jetAxis.x + point.y * jetAxis.y) > radiusPixels * 1.2);
      return { pixels: lobe.length, bright: lobe.filter(point => point.light > 170).length,
        extent: Math.max(0, ...lobe.map(point => sign * (point.x * jetAxis.x + point.y * jetAxis.y))) / radiusPixels };
    });
    const nebulaPixels = capture("pulsar-nebula", [nebula]);
    const nebulaPoints = points(nebulaPixels, 8), nebulaAxis = axes(nebulaPoints);
    let warmDust = 0, exteriorDust = 0;
    for (const point of nebulaPoints) {
      const x = Math.round(point.x + size / 2 - 0.5), y = Math.round(point.y + size / 2 - 0.5);
      const i = (y * size + x) * 4;
      if (nebulaPixels[i] > nebulaPixels[i + 2] + 3 && nebulaPixels[i + 1] > nebulaPixels[i + 2]) warmDust++;
      if (Math.hypot(point.x, point.y) > radiusPixels * 1.2) exteriorDust++;
    }
    capture("pulsar-reference-model", layers);
    const glError = renderer.getContext().getError();
    target.dispose();
    model.group.traverse((object: any) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose());
      else object.material?.dispose();
    });
    renderer.dispose();
    return { coreMean, coreDeviation, corePatchDeviation, rimMean: mean(rimValues), corePixels: coreValues.length,
      chromaticCore, whiteCore, tones: tones.size, jetAxisRatio: jetAxis.ratio, lobes,
      nebulaPixels: nebulaPoints.length, nebulaAxisRatio: nebulaAxis.ratio, warmDust, exteriorDust,
      glError, shots };
  });
  for (const shot of result.shots) await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  const { shots: _shots, ...metrics } = result;
  await writeFile(info.outputPath("pulsar-pixels.json"), JSON.stringify(metrics, null, 2));
  expect(errors, "真实脉冲星着色器应成功编译").toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.chromaticCore / result.corePixels, "核心应保留蓝紫纹理，不能过曝成白球").toBeGreaterThan(0.35);
  expect(result.whiteCore / result.corePixels).toBeLessThan(0.1);
  expect(result.coreDeviation, "核心应有明暗交织的等离子结构").toBeGreaterThan(10);
  expect(result.corePatchDeviation, "核心应有较大尺度的等离子明暗区域，不能只有均匀闪点").toBeGreaterThan(5);
  expect(result.tones).toBeGreaterThan(80);
  expect(result.rimMean, "外缘应比核心更明亮").toBeGreaterThan(result.coreMean + 15);
  expect(result.jetAxisRatio, "两极喷流应细长，不能退化为光晕").toBeGreaterThan(5);
  for (const lobe of result.lobes) {
    expect(lobe.pixels, "两侧都应存在从恒星以外延伸的喷流").toBeGreaterThan(120);
    expect(lobe.bright, "喷流应有明亮光芯").toBeGreaterThan(40);
    expect(lobe.extent, "喷流至少延伸至恒星半径的 2.5 倍").toBeGreaterThan(2.5);
  }
  expect(result.exteriorDust, "环状光雾应作为独立天体效果存在").toBeGreaterThan(500);
  expect(result.warmDust, "光雾应保留参考图的灰金色尘埃").toBeGreaterThan(100);
  expect(result.nebulaAxisRatio, "倾斜环状光雾应呈扁长形状").toBeGreaterThan(1.5);
});

test("真实观测页在桌面和手机完整显示参考图风格脉冲星", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#planet=echo-pulsar", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", "echo-pulsar");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect(page.locator("#star-system")).toHaveValue("echo-rift");
  await expect(page.locator("#place-ship")).toBeDisabled();
  await page.screenshot({ path: info.outputPath("pulsar-observation.png") });
  await page.locator("#photo-mode").click();
  await expect(page.locator("#photo-mode")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("pulsar-photography.png") });
  expect(errors).toEqual([]);
});
