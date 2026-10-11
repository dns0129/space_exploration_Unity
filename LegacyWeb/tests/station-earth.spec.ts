import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("空间站窗外复用轨道地球、云层、夜景与大气，并保持受光和暂停状态", async ({ page }, info) => {
  test.setTimeout(info.project.name === "desktop" ? 360_000 : 240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto("/#planet=earth-station");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  await page.locator("#quality").selectOption("standard", { force: true });
  await page.locator("#flight-quality").selectOption("standard", { force: true });
  // Observe the application's real renderer as in surface-celestial.spec.ts;
  // no production test API or additional WebGL renderer is needed.
  await page.evaluate(async () => {
    const { SolarScene } = await import("/src/planet-scene.ts");
    const renderWorld = SolarScene.prototype["renderFlightWorld"];
    SolarScene.prototype["renderFlightWorld"] = function () {
      const state = (window as any).stationEarthTest ??= {};
      state.scene = this;
      const renderer = this["renderer"], passes: any[] = [];
      const render = renderer.render, clearDepth = renderer.clearDepth;
      renderer.render = function (scene: any, camera: any) {
        passes.push({ type: "render", scene: scene.uuid, camera: camera.uuid });
        return render.call(this, scene, camera);
      };
      renderer.clearDepth = function () {
        passes.push({ type: "clearDepth" });
        return clearDepth.call(this);
      };
      try { renderWorld.call(this); }
      finally {
        renderer.render = render;
        renderer.clearDepth = clearDepth;
        state.passes = passes;
      }
    };
  });
  await page.locator("#mode-flight").click();
  await expect(page.locator("#loading-overlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!(window as any).stationEarthTest?.scene?.flightModelById.get("earth"))).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).stationEarthTest;
    const earth = state.scene.flightModelById.get("earth");
    state.orbitalEarth = earth;
    state.earthDetailCount = state.scene.earthDetails.size;
    state.solarSky = state.scene.galaxySky.mesh.material.uniforms.skyMap.value;
    state.orbitalResources = [earth.surface.geometry, earth.surface.material, earth.layers.clouds,
      earth.layers.clouds.material, earth.layers.atmosphere, earth.layers.atmosphere.material,
      ...["dayMap", "nightMap", "terrainMap", "cloudMap"].map(name => earth.surface.material.uniforms[name].value)];
  });
  await page.locator("#flight-land").click();
  const canvas = page.locator("#canvas-host canvas");
  await expect(canvas).toHaveAttribute("data-render-mode", "station");
  await page.locator("#flight-pause").click();
  const fixture = await page.evaluate(async () => {
    const { terrainHeightKm, LANDING_CLEARANCE_KM } = await import("/shared/surface.mjs");
    const state = (window as any).stationEarthTest;
    const scene = state.scene;
    state.pad = scene.flightState();
    state.window = { ...state.pad,
      stationVisit: { bodyId: "earth-station", positionM: [21, 0, -2], yaw: -Math.PI / 2, pitch: 0.12, camera: "first" } };
    const config = scene.dynamics.config;
    const body = config.bodies.find((candidate: any) => candidate.id === "proxima-b");
    const base = { ...state.pad, target: body.id, systemId: body.systemId, stationVisit: undefined,
      landedBody: undefined, referenceFrame: { kind: "system" }, velocity: [0, 0, 0],
      orientation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
    const orbit = scene.restoreFlight({ ...base,
      position: [body.position[0], body.position[1], body.position[2] - body.radius - 1100 / config.unitsKm] });
    const proximaSky = scene.galaxySky.mesh.material.uniforms.skyMap.value === scene.backgrounds.get(body.systemId);
    const height = terrainHeightKm(body.id, [0, 0, -1]) + LANDING_CLEARANCE_KM;
    const landed = scene.restoreFlight({ ...base, landedBody: body.id,
      position: [body.position[0], body.position[1], body.position[2] - body.radius - height / config.unitsKm] });
    const surfaceMode = scene.renderPolicy.mode;
    const restored = scene.restoreFlight(state.window);
    return { orbit, proximaSky, landed, surfaceMode, restored, stationMode: scene.renderPolicy.mode,
      solarSkyRestored: scene.galaxySky.mesh.material.uniforms.skyMap.value === state.solarSky };
  });
  expect(fixture).toEqual({ orbit: true, proximaSky: true, landed: true, surfaceMode: "surface",
    restored: true, stationMode: "space", solarSkyRestored: true });
  await expect(canvas).toHaveAttribute("data-station-zone", "观测舱");
  await expect(canvas).toHaveAttribute("data-surface-frame-idle", "true");
  const shared = await page.evaluate(() => {
    const state = (window as any).stationEarthTest;
    const scene = state.scene, earth = scene.flightModelById.get("earth");
    const resources = [earth.surface.geometry, earth.surface.material, earth.layers.clouds,
      earth.layers.clouds.material, earth.layers.atmosphere, earth.layers.atmosphere.material,
      ...["dayMap", "nightMap", "terrainMap", "cloudMap"].map(name => earth.surface.material.uniforms[name].value)];
    return {
      sameEarth: earth === state.orbitalEarth,
      detailCountUnchanged: scene.earthDetails.size === state.earthDetailCount,
      sameResources: resources.map((resource, i) => resource === state.orbitalResources[i]),
      maps: ["dayMap", "nightMap", "terrainMap", "cloudMap"].map(name => {
        const image = earth.surface.material.uniforms[name].value.image;
        return [image.width, image.height];
      }),
      cloudTextureShared: earth.layers.clouds.material.uniforms.cloudMap.value === earth.surface.material.uniforms.cloudMap.value,
      atmosphereVisible: earth.layers.atmosphere.visible,
      cloudsRendered: earth.layers.clouds.visible || earth.surface.material.uniforms.flatClouds.value > 0,
      skyShared: scene.galaxySky.mesh.parent === scene.spaceScene && scene.galaxySky.mesh.visible,
      passes: state.passes,
      expectedPasses: [{ type: "render", scene: scene.spaceScene.uuid, camera: scene.camera.uuid },
        { type: "clearDepth" }, { type: "render", scene: scene.stationInterior.scene.uuid, camera: scene.stationInterior.camera.uuid }],
      pose: { surface: earth.surface.quaternion.toArray(), clouds: earth.layers.clouds.quaternion.toArray(),
        sun: earth.surface.material.uniforms.sunDirection.value.toArray(),
        cloudSun: earth.layers.clouds.material.uniforms.sunDirection.value.toArray(),
        atmosphereSun: earth.layers.atmosphere.material.uniforms.sunDirection.value.toArray() },
    };
  });
  expect(shared.sameEarth).toBe(true);
  expect(shared.detailCountUnchanged).toBe(true);
  expect(shared.sameResources).toEqual(Array(10).fill(true));
  for (const [width, height] of shared.maps) {
    expect(width).toBeGreaterThanOrEqual(4096);
    expect(height).toBeGreaterThanOrEqual(2048);
  }
  expect(shared.cloudTextureShared).toBe(true);
  expect(shared.cloudsRendered).toBe(true);
  expect(shared.atmosphereVisible).toBe(true);
  expect(shared.skyShared).toBe(true);
  expect(shared.passes).toEqual(shared.expectedPasses);
  expect(shared.pose.cloudSun).toEqual(shared.pose.sun);
  expect(shared.pose.atmosphereSun).toEqual(shared.pose.sun);
  expect(Math.hypot(...shared.pose.sun)).toBeCloseTo(1, 8);
  await page.screenshot({ path: info.outputPath("station-shared-earth-window.png") });

  // Resolve the actual resident Earth in a small, fixed optical frame. The
  // camera and geographic orientation stay fixed for each layer comparison;
  // flipping sunlight only supplies a night-side fixture for the real night map.
  const pixels = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const scene = (window as any).stationEarthTest.scene;
    const earth = scene.flightModelById.get("earth"), renderer = scene.renderer;
    const group = earth.group, parent = group.parent;
    const original = { position: group.position.clone(), quaternion: group.quaternion.clone(), scale: group.scale.clone(),
      visible: group.visible, clouds: earth.layers.clouds.visible, atmosphere: earth.layers.atmosphere.visible,
      flat: earth.surface.material.uniforms.flatClouds.value, enabled: earth.surface.material.uniforms.cloudsEnabled.value,
      sun: earth.surface.material.uniforms.sunDirection.value.clone(), night: earth.surface.material.uniforms.nightMap.value,
      target: renderer.getRenderTarget(), autoClear: renderer.autoClear, clear: renderer.getClearColor(new THREE.Color()).clone(),
      alpha: renderer.getClearAlpha() };
    const local = new THREE.Scene();
    const size = 256, target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const windowHeight = 384, windowWidth = Math.max(96, Math.round(windowHeight * scene.camera.aspect));
    const windowTarget = new THREE.WebGLRenderTarget(windowWidth, windowHeight);
    windowTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const black = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat);
    black.needsUpdate = true;
    const shots: { name: string; image: string }[] = [];
    const changed = (a: Uint8Array, b: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < a.length; i += 4)
        if ([0, 1, 2].some(channel => Math.abs(a[i + channel] - b[i + channel]) > 3)) count++;
      return count;
    };
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    const shot = (name: string, data: Uint8Array, width: number, height: number) => {
      const output = document.createElement("canvas"); output.width = width; output.height = height;
      const context = output.getContext("2d")!, image = context.createImageData(width, height);
      for (let y = 0; y < height; y++) image.data.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
      context.putImageData(image, 0, 0);
      shots.push({ name, image: output.toDataURL("image/png").split(",")[1] });
    };
    const captureWindow = (name: string) => {
      renderer.setRenderTarget(windowTarget);
      scene.renderFlightWorld();
      const data = new Uint8Array(windowWidth * windowHeight * 4);
      renderer.readRenderTargetPixels(windowTarget, 0, 0, windowWidth, windowHeight, data);
      shot(name, data, windowWidth, windowHeight);
      return data;
    };
    const capture = (name: string) => {
      renderer.setRenderTarget(target);
      renderer.render(local, camera);
      const data = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, data);
      shot(name, data, size, size);
      return data;
    };
    try {
      const windowClouds = captureWindow("station-window-clouds");
      earth.layers.clouds.visible = false;
      earth.surface.material.uniforms.flatClouds.value = 0;
      earth.surface.material.uniforms.cloudsEnabled.value = 0;
      const windowClear = captureWindow("station-window-no-clouds");
      earth.layers.clouds.visible = original.clouds;
      earth.surface.material.uniforms.flatClouds.value = original.flat;
      earth.surface.material.uniforms.cloudsEnabled.value = original.enabled;
      group.updateWorldMatrix(true, true);
      local.attach(group);
      const center = group.getWorldPosition(new THREE.Vector3());
      const radius = group.getWorldScale(new THREE.Vector3()).x;
      camera.position.copy(center).addScaledVector(original.sun.clone().normalize(), radius * 4);
      camera.lookAt(center); camera.updateMatrixWorld(true);
      group.visible = true;
      renderer.autoClear = true; renderer.setClearColor(0, 0);
      earth.layers.clouds.visible = true;
      earth.layers.atmosphere.visible = true;
      earth.surface.material.uniforms.flatClouds.value = 0;
      earth.surface.material.uniforms.cloudsEnabled.value = 1;
      const day = capture("shared-earth-day-clouds");
      earth.layers.clouds.visible = false;
      earth.surface.material.uniforms.cloudsEnabled.value = 0;
      const clear = capture("shared-earth-day-clear");
      earth.layers.atmosphere.visible = false;
      const noAtmosphere = capture("shared-earth-day-no-atmosphere");
      earth.surface.material.uniforms.sunDirection.value.copy(original.sun).negate();
      const night = capture("shared-earth-night");
      earth.surface.material.uniforms.nightMap.value = black;
      const noCities = capture("shared-earth-night-no-cities");
      let blue = 0, lit = 0, cities = 0;
      for (let i = 0; i < day.length; i += 4) {
        if (day[i + 2] > day[i] * 1.3 && day[i + 2] > 35) blue++;
        if (day[i] + day[i + 1] + day[i + 2] > 100) lit++;
        if (night[i] > 40 && night[i] > night[i + 1] * 1.12 && night[i + 1] > night[i + 2] * 1.2
          && night[i] - noCities[i] > 4) cities++;
      }
      return { windowCloudPixels: changed(windowClouds, windowClear), cloudPixels: changed(day, clear), atmospherePixels: changed(clear, noAtmosphere),
        cityPixels: cities, nightPixels: changed(night, noCities), blue, lit, shots, glError: renderer.getContext().getError() };
    } finally {
      parent.add(group);
      group.position.copy(original.position); group.quaternion.copy(original.quaternion); group.scale.copy(original.scale);
      group.visible = original.visible;
      earth.layers.clouds.visible = original.clouds; earth.layers.atmosphere.visible = original.atmosphere;
      earth.surface.material.uniforms.flatClouds.value = original.flat;
      earth.surface.material.uniforms.cloudsEnabled.value = original.enabled;
      earth.surface.material.uniforms.sunDirection.value.copy(original.sun);
      earth.surface.material.uniforms.nightMap.value = original.night;
      renderer.setRenderTarget(original.target); renderer.autoClear = original.autoClear;
      renderer.setClearColor(original.clear, original.alpha);
      target.dispose(); windowTarget.dispose(); black.dispose(); scene.flightFrameDirty = true;
    }
  });
  for (const shot of pixels.shots) await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  await writeFile(info.outputPath("station-earth-metrics.json"), JSON.stringify({ shared, ...pixels, shots: undefined }, null, 2));
  expect(pixels.glError).toBe(0);
  expect(pixels.blue, "共享地球需要真实海洋/大气像素").toBeGreaterThan(100);
  expect(pixels.lit, "共享地球需要可见地表").toBeGreaterThan(1000);
  expect(pixels.windowCloudPixels, "真实窗相机的背景+舱内双 pass 必须显示云层").toBeGreaterThan(20);
  expect(pixels.cloudPixels, "关闭真实云层必须改变画面").toBeGreaterThan(500);
  expect(pixels.atmospherePixels, "关闭真实大气壳必须改变地球边缘").toBeGreaterThan(20);
  expect(pixels.cityPixels, "真实夜景贴图必须产生暖色城市光").toBeGreaterThan(10);
  expect(pixels.nightPixels).toBeGreaterThan(20);

  const cloudBefore = await page.evaluate(() => (window as any).stationEarthTest.scene.flightModelById.get("earth").layers.clouds.rotation.y);
  await page.evaluate(() => (window as any).stationEarthTest.scene.setPaused(false));
  await page.locator("#flight-pause").click();
  await expect.poll(() => page.evaluate(() => (window as any).stationEarthTest.scene.flightModelById.get("earth").layers.clouds.rotation.y))
    .not.toBe(cloudBefore);
  await page.locator("#flight-pause").click();
  const frozen = await page.evaluate(() => {
    const earth = (window as any).stationEarthTest.scene.flightModelById.get("earth");
    return { surface: earth.surface.quaternion.toArray(), clouds: earth.layers.clouds.quaternion.toArray(),
      sun: earth.surface.material.uniforms.sunDirection.value.toArray() };
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => {
    const earth = (window as any).stationEarthTest.scene.flightModelById.get("earth");
    return { surface: earth.surface.quaternion.toArray(), clouds: earth.layers.clouds.quaternion.toArray(),
      sun: earth.surface.material.uniforms.sunDirection.value.toArray() };
  })).toEqual(frozen);
  expect(await page.evaluate(() => {
    const state = (window as any).stationEarthTest;
    return state.scene.restoreFlight({ ...state.pad, stationVisit: { ...state.pad.stationVisit, vessel: true, positionM: [0, 0, -36] } });
  })).toBe(true);
  await expect(canvas).toHaveAttribute("data-station-zone", "驾驶室");
  await page.locator("#flight-pause").click();
  await page.locator("#flight-land").click();
  await expect(canvas).toHaveAttribute("data-exploration", "starship");
  expect(await page.evaluate(() => {
    const state = (window as any).stationEarthTest;
    const earth = state.scene.flightModelById.get("earth");
    return earth === state.orbitalEarth && earth.surface.material === state.orbitalResources[1]
      && earth.layers.clouds.material.uniforms.cloudMap.value === state.orbitalResources[9];
  })).toBe(true);
  if (info.project.name === "desktop") {
    // Keep the real station paused while 8K globals and native 16K tiles arrive.
    // The cached frame must redraw uploads and every fade, then return to idle.
    expect(await page.evaluate(() => {
      const state = (window as any).stationEarthTest;
      return state.scene.restoreFlight(state.window);
    })).toBe(true);
    await page.locator("#flight-pause").click();
    await expect(canvas).toHaveAttribute("data-surface-frame-idle", "true");
    const beforeUpload = Number(await canvas.getAttribute("data-world-render-count"));
    await page.locator("#flight-quality").selectOption("ultra");
    await expect(canvas).toHaveAttribute("data-earth-maps", "8k", { timeout: 90_000 });
    await expect.poll(async () => Number(await canvas.getAttribute("data-world-render-count"))).toBeGreaterThan(beforeUpload);
    const afterUpload = Number(await canvas.getAttribute("data-world-render-count"));
    await expect(canvas).toHaveAttribute("data-earth-detail-tiles", "4", { timeout: 90_000 });
    await expect.poll(() => page.evaluate(() => {
      const scene = (window as any).stationEarthTest.scene;
      return scene.flightModelById.get("earth").surface.material.uniforms.detailBlend.value.toArray();
    }), { timeout: 30_000 }).toEqual([1, 1, 1, 1]);
    await expect.poll(async () => Number(await canvas.getAttribute("data-world-render-count"))).toBeGreaterThan(afterUpload);
    await expect(canvas).toHaveAttribute("data-surface-frame-idle", "true");
    const upgraded = await page.evaluate(() => {
      const state = (window as any).stationEarthTest, scene = state.scene;
      const earth = scene.flightModelById.get("earth");
      return { sameModel: earth === state.orbitalEarth, sameMaterial: earth.surface.material === state.orbitalResources[1],
        detailCountUnchanged: scene.earthDetails.size === state.earthDetailCount,
        cloudMapShared: earth.layers.clouds.material.uniforms.cloudMap.value === scene.earthHighMaps[3]
          && earth.surface.material.uniforms.cloudMap.value === scene.earthHighMaps[3] };
    });
    expect(upgraded).toEqual({ sameModel: true, sameMaterial: true, detailCountUnchanged: true, cloudMapShared: true });
    await page.screenshot({ path: info.outputPath("station-shared-earth-ultra.png") });
    await writeFile(info.outputPath("station-earth-ultra-metrics.json"), JSON.stringify({ beforeUpload, afterUpload,
      afterFade: Number(await canvas.getAttribute("data-world-render-count")), ...upgraded }, null, 2));
  }
  expect(errors).toEqual([]);
});
