import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("碎裂天体保留球壳轮廓，真实缺口露出红橙内层并随绕行改变遮挡", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const size = 512;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.20, 3.55);
    camera.lookAt(0, 0, 0);
    const shots: { name: string; image: string }[] = [];
    const bodies: { id: string; visiblePixels: number; hotPixels: number; rockPixels: number;
      exposedPixels: number; mantleDifference: number; viewDifference: number; silhouetteRoundness: number;
      openingAxisRatio: number; rockTones: number; debrisPixels: number; debrisTones: number;
      detail32MeanDifference: number; detail32ChangedPixels: number; moltenDarkFraction: number;
      moltenBrightFraction: number; moltenContrast: number; thinMoltenFraction: number;
      nearRiftRockPixels: number; nearRiftRockDetailDifference: number; rockUnstableFraction: number;
      glError: number }[] = [];
    function capture(name: string) {
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
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      shots.push({ name, image: canvas.toDataURL("image/png").split(",")[1] });
      return pixels;
    }
    for (const id of ["ruin", "shard"]) {
      const light = new THREE.Vector3(-0.75, 0.45, 0.48).normalize();
      const model = createPlanetModel(getBody(id), light);
      scene.add(model.group);
      const front = capture(`${id}-reference-front`);
      const mantle = model.group.getObjectByName("recessed-molten-mantle")!;
      const debris = model.group.getObjectByName("irregular-detached-rocks")!;
      if (!mantle || !debris) throw new Error(`${id} 缺少可独立验证的内层或漂浮岩壳碎块`);
      // Exclude detached rocks from the silhouette and crack measurements, so
      // scattered debris cannot stand in for the surviving spherical planet.
      debris.visible = false;
      const bodyOnly = capture(`${id}-spherical-remnant`);
      mantle.visible = false;
      const material = model.surface.material;
      material.side = THREE.FrontSide;
      material.needsUpdate = true;
      const hollow = capture(`${id}-real-crust-opening`);
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
      mantle.visible = true;
      debris.visible = true;
      // Reparent temporarily while preserving the production world transform:
      // the fragments keep their real geometry and material, without the parent
      // crust or mantle masking missing or untextured floating rocks.
      const debrisParent = debris.parent!;
      scene.attach(debris);
      model.group.visible = false;
      const fragments = capture(`${id}-isolated-fragments`);
      model.group.visible = true;
      debrisParent.attach(debris);
      camera.position.set(0, 0.12, 2.35);
      camera.lookAt(0, 0, 0);
      capture(`${id}-rock-detail-close`);
      // A physically close, lit crust patch resolves the highest procedural
      // octave. The PNG remains 512 square; "32K" denotes the continuous field's
      // sampling frequency, not an invented 32768-pixel photographic texture.
      const patchNormal = new THREE.Vector3(-0.45, 0.22, Math.sqrt(1 - 0.45 ** 2 - 0.22 ** 2));
      camera.near = 0.0001;
      camera.position.copy(patchNormal).multiplyScalar(1.016);
      camera.lookAt(patchNormal.clone().multiplyScalar(0.976));
      camera.updateProjectionMatrix();
      const detailLimit = material.uniforms.rockDetailLimit;
      if (!detailLimit) throw new Error(`${id} 缺少可校验的程序微细节采样频率`);
      detailLimit.value = 16384;
      const detail16 = capture(`${id}-procedural-detail-16k-frequency`);
      detailLimit.value = 32768;
      const detail32 = capture(`${id}-procedural-detail-32k-frequency`);
      let detail32Difference = 0, detail32ChangedPixels = 0;
      for (let i = 0; i < detail32.length; i += 4) {
        const difference = Math.abs(detail32[i] - detail16[i]) + Math.abs(detail32[i + 1] - detail16[i + 1])
          + Math.abs(detail32[i + 2] - detail16[i + 2]);
        detail32Difference += difference;
        if (difference > 3) detail32ChangedPixels++;
      }
      const detail32MeanDifference = detail32Difference / (size * size * 3);
      camera.near = 0.1;
      camera.position.set(0, 0.20, 3.55);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      // Find a genuinely open, central rift from rendered pixels, then raycast
      // the real mantle. This targets the user's problematic fracture close-up
      // rather than measuring only a convenient intact patch on the left.
      let openingPixel = -1, openingScore = Infinity;
      for (let y = Math.round(size * 0.30); y < size * 0.70; y++) for (let x = Math.round(size * 0.20); x < size * 0.80; x++) {
        const i = (y * size + x) * 4;
        if (bodyOnly[i + 3] <= 240 || hollow[i + 3] >= 10) continue;
        const margin = [-2, 0, 2].every(oy => [-2, 0, 2].every(ox => hollow[((y + oy) * size + x + ox) * 4 + 3] < 10));
        if (!margin) continue;
        const score = (x - size / 2) ** 2 + (y - size / 2) ** 2;
        if (score < openingScore) { openingScore = score; openingPixel = y * size + x; }
      }
      if (openingPixel < 0) throw new Error(`${id} 前视中央缺口中没有可测量的真实熔融层`);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(((openingPixel % size) + 0.5) / size * 2 - 1,
        (Math.floor(openingPixel / size) + 0.5) / size * 2 - 1), camera);
      const hit = raycaster.intersectObject(mantle, false)[0];
      if (!hit) throw new Error(`${id} 可见裂带像素没有实际熔融层几何`);
      const approach = camera.position.clone().sub(hit.point).normalize();
      camera.near = 0.0001;
      camera.position.copy(hit.point).addScaledVector(approach, 0.12);
      camera.lookAt(hit.point);
      camera.updateProjectionMatrix();
      const nearRiftProduction = capture(`${id}-near-rift-production`);
      // Hide the mantle for the rock checks, so moving lava cannot be mistaken
      // for noisy rock grains; render the same real crust before/after time.
      mantle.visible = false; debris.visible = false;
      const nearRiftRock = capture(`${id}-near-rift-rock-detail`);
      const detailEnabled = material.uniforms.rockDetailEnabled;
      if (!detailEnabled) throw new Error(`${id} 缺少可校验的岩石程序微细节开关`);
      detailEnabled.value = 0;
      const nearRiftRockPlain = capture(`${id}-near-rift-rock-detail-disabled`);
      detailEnabled.value = 1;
      const savedTimes = model.timeUniforms.map(uniform => uniform.value);
      model.timeUniforms.forEach(uniform => { uniform.value += 23; });
      const nearRiftRockLater = capture(`${id}-near-rift-rock-time-shift`);
      model.timeUniforms.forEach((uniform, index) => { uniform.value = savedTimes[index]; });
      let nearRiftRockPixels = 0, rockDetailDifference = 0, unstableRockPixels = 0;
      for (let i = 0; i < nearRiftRock.length; i += 4) {
        const r = nearRiftRock[i], g = nearRiftRock[i + 1], b = nearRiftRock[i + 2];
        if (nearRiftRock[i + 3] < 240 || r + g + b < 45 || r > g * 1.65) continue;
        // Removing the mantle can expose the far side of a double-sided shell.
        // Accept only rock pixels also visible in the intact production shot.
        if (Math.abs(r - nearRiftProduction[i]) + Math.abs(g - nearRiftProduction[i + 1])
          + Math.abs(b - nearRiftProduction[i + 2]) > 3) continue;
        nearRiftRockPixels++;
        rockDetailDifference += Math.abs(r - nearRiftRockPlain[i]) + Math.abs(g - nearRiftRockPlain[i + 1])
          + Math.abs(b - nearRiftRockPlain[i + 2]);
        if (Math.max(Math.abs(r - nearRiftRockLater[i]), Math.abs(g - nearRiftRockLater[i + 1]),
          Math.abs(b - nearRiftRockLater[i + 2])) > 3) unstableRockPixels++;
      }
      const nearRiftRockDetailDifference = rockDetailDifference / Math.max(1, nearRiftRockPixels * 3);
      const rockUnstableFraction = unstableRockPixels / Math.max(1, nearRiftRockPixels);
      mantle.visible = true; debris.visible = true;
      const mantleParent = mantle.parent!;
      scene.attach(mantle);
      model.group.visible = false;
      const molten = capture(`${id}-near-rift-isolated-molten-layer`);
      model.group.visible = true;
      mantleParent.attach(mantle);
      const moltenValues: number[] = [], brightMask = new Uint8Array(size * size);
      let moltenDark = 0, moltenBright = 0, thinMolten = 0;
      for (let i = 0; i < molten.length; i += 4) {
        if (molten[i + 3] < 240) continue;
        const r = molten[i], g = molten[i + 1], b = molten[i + 2];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        moltenValues.push(luminance);
        if (r < 100 && luminance < 45) moltenDark++;
        if (r > 145 && r > g * 1.8 && r > b * 3) { moltenBright++; brightMask[i / 4] = 1; }
      }
      for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) {
        const i = y * size + x;
        if (brightMask[i] && (!brightMask[i - 4] || !brightMask[i + 4] || !brightMask[i - size * 4] || !brightMask[i + size * 4])) thinMolten++;
      }
      moltenValues.sort((a, b) => a - b);
      const moltenDarkFraction = moltenDark / moltenValues.length, moltenBrightFraction = moltenBright / moltenValues.length;
      const moltenContrast = moltenValues[Math.floor(moltenValues.length * 0.90)] - moltenValues[Math.floor(moltenValues.length * 0.10)];
      const thinMoltenFraction = thinMolten / Math.max(1, moltenBright);
      camera.near = 0.1;
      camera.position.set(0, 0.20, 3.55);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      model.surface.rotation.y = Math.PI * 0.48;
      const side = capture(`${id}-reference-orbit`);
      let visiblePixels = 0, hotPixels = 0, rockPixels = 0, exposedPixels = 0, mantleDifference = 0, viewDifference = 0;
      let debrisPixels = 0;
      const rockTones = new Set<number>(), debrisTones = new Set<number>();
      const silhouette = new Array<number>(72).fill(0);
      const openings: [number, number][] = [];
      for (let i = 0; i < front.length; i += 4) {
        const [r, g, b, a] = front.subarray(i, i + 4);
        const x = (i / 4) % size + 0.5 - size / 2, y = Math.floor(i / 4 / size) + 0.5 - size / 2;
        if (a > 240) visiblePixels++;
        if (a > 240 && r > 95 && r > g * 1.8 && r > b * 3) hotPixels++;
        if (a > 240 && r + g + b > 60 && Math.max(r, g, b) < 165 && r < g * 2.2) {
          rockPixels++;
          rockTones.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
        }
        if (bodyOnly[i + 3] > 240) {
          const angle = Math.atan2(y, x) + Math.PI;
          const sector = Math.min(71, Math.floor(angle / (2 * Math.PI) * 72));
          silhouette[sector] = Math.max(silhouette[sector], Math.hypot(x, y));
          if (hollow[i + 3] < 10) { exposedPixels++; openings.push([x, y]); }
        }
        const [dr, dg, db, da] = fragments.subarray(i, i + 4);
        if (da > 240 && dr + dg + db > 30) {
          debrisPixels++;
          debrisTones.add((dr >> 4) * 256 + (dg >> 4) * 16 + (db >> 4));
        }
        if (r - hollow[i] > 30) mantleDifference++;
        if (Math.abs(r - side[i]) + Math.abs(g - side[i + 1]) + Math.abs(b - side[i + 2]) > 60) viewDifference++;
      }
      const radii = silhouette.slice().sort((a, b) => a - b);
      const silhouetteRoundness = radii[7] / radii[64];
      const openingCenter = openings.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
        .map(value => value / openings.length);
      let xx = 0, xy = 0, yy = 0;
      for (const [x, y] of openings) {
        const dx = x - openingCenter[0], dy = y - openingCenter[1];
        xx += dx * dx; xy += dx * dy; yy += dy * dy;
      }
      const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
      const openingAxisRatio = Math.sqrt((xx + yy + discriminant) / Math.max(1, xx + yy - discriminant));
      bodies.push({ id, visiblePixels, hotPixels, rockPixels, exposedPixels, mantleDifference, viewDifference,
        silhouetteRoundness, openingAxisRatio, rockTones: rockTones.size, debrisPixels, debrisTones: debrisTones.size,
        detail32MeanDifference, detail32ChangedPixels,
        moltenDarkFraction, moltenBrightFraction, moltenContrast, thinMoltenFraction,
        nearRiftRockPixels, nearRiftRockDetailDifference, rockUnstableFraction,
        glError: renderer.getContext().getError() });
      scene.remove(model.group);
      const materials = new Set<THREE.Material>();
      model.group.traverse((object: any) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material: THREE.Material) => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      materials.forEach(material => material.dispose());
    }
    renderer.dispose();
    target.dispose();
    return { bodies, shots };
  });
  for (const shot of result.shots) await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  await writeFile(info.outputPath("shattered-pixels.json"), JSON.stringify(result.bodies, null, 2));
  expect(errors, "生产模型的岩壳、断面和熔融材质应能编译").toEqual([]);
  for (const body of result.bodies) {
    expect(body.glError).toBe(0);
    expect(body.visiblePixels, `${body.id} 需要仍可辨认的星球主体`).toBeGreaterThan(45_000);
    expect(body.rockPixels, `${body.id} 需要可见粗糙岩壳，不能是纯发光球`).toBeGreaterThan(10_000);
    expect(body.rockTones, `${body.id} 岩壳应保留矿物与粗糙表面的多层色调`).toBeGreaterThan(35);
    expect(body.silhouetteRoundness, `${body.id} 主体应保留近圆球形轮廓，不能变成分散石块`).toBeGreaterThan(0.75);
    expect(body.hotPixels, `${body.id} 缺口中需要红橙熔融像素`).toBeGreaterThan(1_000);
    expect(body.hotPixels / body.visiblePixels, `${body.id} 红热主要集中在裂带，不能覆盖整个球体`).toBeLessThan(0.35);
    // The reference is a narrow longitudinal rupture in a surviving sphere.
    // Combine area with directional shape instead of requiring the old broad,
    // round excavated cap's absolute opening area.
    expect(body.exposedPixels, `${body.id} 岩壳必须具有真实贯通缺口`).toBeGreaterThan(3_000);
    expect(body.exposedPixels / body.visiblePixels, `${body.id} 真实裂带应覆盖至少2.5%的投影面积`).toBeGreaterThan(0.025);
    expect(body.openingAxisRatio, `${body.id} 缺口应形成撕裂带，不能退化为圆形火山口`).toBeGreaterThan(1.35);
    expect(body.mantleDifference, `${body.id} 内层应从岩壳下方真实显露`).toBeGreaterThan(2_000);
    expect(body.viewDifference, `${body.id} 绕行应改变立体断面的遮挡`).toBeGreaterThan(15_000);
    expect(body.debrisPixels, `${body.id} 应具有实际可见的漂浮岩壳碎块`).toBeGreaterThan(150);
    expect(body.debrisTones, `${body.id} 碎块应有岩石材质层次，不能是单色几何体`).toBeGreaterThan(15);
    expect(body.detail32MeanDifference, `${body.id} 32K采样频率应在近景新增真实可见的程序微细节`).toBeGreaterThan(0.25);
    expect(body.detail32ChangedPixels, `${body.id} 最高细节层应改变足够多实际渲染像素`).toBeGreaterThan(2_000);
    expect(body.moltenDarkFraction, `${body.id} 熔融层自身应有暗凝固壳，不能靠外壳阴影冒充`).toBeGreaterThan(0.15);
    expect(body.moltenBrightFraction, `${body.id} 暗凝固壳之间应存在亮红橙隙`).toBeGreaterThan(0.025);
    expect(body.moltenBrightFraction, `${body.id} 熔融层不能成为一整面均匀红膜`).toBeLessThan(0.65);
    expect(body.moltenContrast, `${body.id} 近裂带熔岩需要明暗层次`).toBeGreaterThan(45);
    expect(body.thinMoltenFraction, `${body.id} 亮熔岩应包含窄隙，不能只有模糊大色块`).toBeGreaterThan(0.20);
    expect(body.nearRiftRockPixels, `${body.id} 近裂带还应真实看到断壁岩壳`).toBeGreaterThan(1_000);
    expect(body.nearRiftRockDetailDifference, `${body.id} 断壁近景应显示实际粗糙微细节`).toBeGreaterThan(0.5);
    expect(body.rockUnstableFraction, `${body.id} 静止镜头的岩石颗粒不应随时间闪动`).toBeLessThan(0.005);
  }
});

test("观测站实际显示两颗碎裂天体，仍禁止着陆和直接放置", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#planet=ruin");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#loading-overlay")).toBeHidden();
  for (const id of ["ruin", "shard"]) {
    await page.locator(`button[data-body="${id}"]`).click();
    await expect(page.locator("#canvas-host")).toHaveAttribute("data-body", id);
    await expect(page.locator("#loading-overlay")).toBeHidden();
    await expect(page.locator("#place-ship")).toBeDisabled();
    await expect(page.locator("#place-person")).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`${id}-observatory.png`) });
    await page.locator("#photo-mode").click();
    await expect(page.locator(".observatory")).toHaveClass(/photo-mode/);
    await page.screenshot({ path: info.outputPath(`${id}-photography.png`) });
    await page.keyboard.press("Escape");
    await expect(page.locator(".observatory")).not.toHaveClass(/photo-mode/);
  }
  expect(errors).toEqual([]);
});
