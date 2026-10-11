import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("土星冰粒环随受光面与视角改变散射、透过率，并产生相互遮挡", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  // The homepage does not start the game renderer or download planetary maps.
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const size = 256;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(size, size);
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2.55, 2.55, 2.55, -2.55, 0.1, 100);
    // A shallow solar elevation makes the dense B ring absorb most transmitted
    // sunlight while the sparse C ring remains illuminated from its back side.
    const solarElevation = 8 * Math.PI / 180;
    const light = new THREE.Vector3(Math.cos(solarElevation), Math.sin(solarElevation), 0);
    // Removing the display tilt makes the sampled ring radii explicit; the actual
    // production geometries and materials, including both shadows, are unchanged.
    const body = { ...getBody("saturn"), axialTiltDeg: 0 };
    const model = createPlanetModel(body, light);
    scene.add(model.group);
    const rings = model.layers.rings;
    model.surface.visible = false;
    for (const [layer, object] of Object.entries(model.layers)) {
      if (layer !== "rings" && object) object.visible = false;
    }
    const shots: { name: string; image: string }[] = [];
    function cameraElevation(degrees: number) {
      const angle = degrees * Math.PI / 180;
      camera.position.set(0, Math.sin(angle) * 30, Math.cos(angle) * 30);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    }
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
      // Render-target RGB already contains the radiance over black. PNG uses
      // straight alpha, so displaying that RGB with its original alpha would
      // attenuate translucent rings a second time. Keep the raw alpha for the
      // measurements and flatten only these diagnostic images onto black.
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      context.putImageData(image, 0, 0);
      shots.push({ name, image: canvas.toDataURL("image/png").split(",")[1] });
      return pixels;
    }
    function sample(pixels: Uint8Array, radius: number, side = 1) {
      const point = new THREE.Vector3(radius * side, 0, 0).project(camera);
      const px = Math.round((point.x * 0.5 + 0.5) * size);
      const py = Math.round((point.y * 0.5 + 0.5) * size);
      let alpha = 0, luminance = 0, count = 0;
      for (let y = py - 2; y <= py + 2; y++) {
        for (let x = px - 2; x <= px + 2; x++) {
          const offset = (y * size + x) * 4;
          alpha += pixels[offset + 3];
          luminance += 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
          count++;
        }
      }
      return { alpha: alpha / count, luminance: luminance / count };
    }
    cameraElevation(60);
    const reflected = capture("rings-sunlit");
    const frontB = sample(reflected, 1.8);
    const frontC = sample(reflected, 1.42);
    const shadowB = sample(reflected, 1.8, -1);
    cameraElevation(-60);
    const transmitted = capture("rings-transmitted");
    const backB = sample(transmitted, 1.8);
    const backC = sample(transmitted, 1.42);
    cameraElevation(12);
    const grazing = capture("rings-grazing");
    const grazingC = sample(grazing, 1.42);
    // Reverse the light while retaining the camera and ring geometry: the former
    // shadowed ring point becomes exposed to sunlight.
    light.x *= -1;
    cameraElevation(60);
    const reversed = capture("rings-shadow-reversed");
    const exposedB = sample(reversed, 1.8, -1);
    light.x *= -1;
    rings.visible = false;
    model.surface.visible = true;
    camera.position.set(25, -12, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    model.ringsEnabled.value = 1;
    const surfaceShadowed = capture("saturn-ring-shadow");
    model.ringsEnabled.value = 0;
    const surfaceClear = capture("saturn-shadow-disabled");
    let changedSurfacePixels = 0, surfacePixels = 0, shadowLoss = 0;
    for (let i = 0; i < surfaceClear.length; i += 4) {
      if (surfaceClear[i + 3] < 250) continue;
      surfacePixels++;
      const clear = surfaceClear[i] + surfaceClear[i + 1] + surfaceClear[i + 2];
      const shadowed = surfaceShadowed[i] + surfaceShadowed[i + 1] + surfaceShadowed[i + 2];
      const loss = clear - shadowed;
      if (loss > 15) changedSurfacePixels++;
      shadowLoss += Math.max(0, loss) / 3;
    }
    const glError = renderer.getContext().getError();
    target.dispose();
    model.group.traverse((object: any) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose());
      else object.material?.dispose();
    });
    renderer.dispose();
    return {
      frontB, frontC, backB, backC, grazingC, shadowB, exposedB,
      changedSurfacePixels, surfacePixels, meanShadowLoss: shadowLoss / surfacePixels,
      glError, shots,
    };
  });
  for (const shot of result.shots) {
    await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  }
  const { shots: _shots, ...metrics } = result;
  await writeFile(info.outputPath("ring-pixels.json"), JSON.stringify(metrics, null, 2));
  expect(errors, "The real ring and surface shaders must compile without browser errors").toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.frontB.alpha, "The dense B ring should hide at least 80% of the background").toBeGreaterThan(204);
  expect(result.frontB.alpha).toBeGreaterThan(result.frontC.alpha * 3);
  expect(result.frontB.luminance).toBeGreaterThan(result.frontC.luminance * 1.15);
  expect(result.backB.luminance, "Dense rings should be darker than thin rings in transmitted light").toBeLessThan(result.backC.luminance * 0.85);
  expect(result.backB.luminance / result.frontB.luminance).toBeLessThan(result.backC.luminance / result.frontC.luminance);
  expect(result.grazingC.alpha, "A longer path through the particle layer increases extinction").toBeGreaterThan(result.frontC.alpha + 35);
  expect(result.shadowB.luminance).toBeLessThan(result.exposedB.luminance * 0.3);
  expect(result.changedSurfacePixels, "The rings should cast a visible shadow on Saturn").toBeGreaterThan(100);
  expect(result.meanShadowLoss).toBeGreaterThan(3);
});
