import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("大气按光程消光、薄层连续衰减，晨昏变暖且不会给地表镀发光塑料壳", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Keep game startup, map downloads, weather and exposure out of the optical
  // measurements; the sampler compiles the actual shared production GLSL.
  await page.goto("/site.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/.vite/deps/three.js");
    const { atmosphereScattering, atmosphereStrength } = await import("/src/atmosphere.ts");
    const { createPlanetModel } = await import("/src/planet-models.ts");
    const { getBody } = await import("/src/solar-system.ts");
    const earth = getBody("earth");
    const radiusKm = earth.radiusKm;
    const heightKm = earth.atmosphereKm!;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(256, 256);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const sampleTarget = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const tint = new THREE.Color("#75a9ef");
    const uniforms = {
      originAltitude: { value: 0 },
      viewRay: { value: new THREE.Vector3(0, 0, 1) },
      sunlight: { value: new THREE.Vector3(0, 0, 1) },
      tint: { value: tint },
      height: { value: heightKm / radiusKm },
      strength: { value: atmosphereStrength("earth") },
    };
    const sampler = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `
        uniform float originAltitude;
        uniform float height;
        uniform float strength;
        uniform vec3 viewRay;
        uniform vec3 sunlight;
        uniform vec3 tint;
        ${atmosphereScattering}
        void main() {
          gl_FragColor = scatterAtmosphere(vec3(0.0, 0.0, 1.0), originAltitude,
            viewRay, 1.0, height, sunlight, tint, strength);
        }
      `,
      blending: THREE.NoBlending,
    }));
    const sampleScene = new THREE.Scene();
    sampleScene.add(sampler);
    const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    sampleCamera.position.z = 2;
    let finite = true;
    function sample(altitudeKm: number, ray: number[], sun: number[]) {
      uniforms.originAltitude.value = altitudeKm / radiusKm;
      uniforms.viewRay.value.fromArray(ray).normalize();
      uniforms.sunlight.value.fromArray(sun).normalize();
      renderer.setRenderTarget(sampleTarget);
      renderer.render(sampleScene, sampleCamera);
      const values = new Float32Array(16);
      renderer.readRenderTargetPixels(sampleTarget, 0, 0, 2, 2, values);
      finite &&= Array.from(values).every(Number.isFinite);
      const [r, g, b, alpha] = values;
      return { r, g, b, alpha, radiance: alpha * (0.2126 * r + 0.7152 * g + 0.0722 * b) };
    }
    function tangentRay(altitudeKm: number, tangentKm: number) {
      const tangentRadius = (radiusKm + tangentKm) / (radiusKm + altitudeKm);
      return [tangentRadius, 0, -Math.sqrt(Math.max(0, 1 - tangentRadius * tangentRadius))];
    }
    const daySun = [0, 0, 1];
    const nightSun = [0, 0, -1];
    const zenith = sample(100, [0, 0, 1], daySun);
    const grazingRay = tangentRay(100, 20);
    const limb = sample(100, grazingRay, daySun);
    const shadowedLimb = sample(100, grazingRay, nightSun);
    // Both views are above the ground and face the same low horizon. Only the
    // solar path changes, so a warmer dusk is not a hard-coded view-angle tint.
    const horizonRay = [1, 0, 0.035];
    const noonHorizon = sample(2, horizonRay, [0.7071, 0, 0.7071]);
    const duskAngle = 2 * Math.PI / 180;
    const duskHorizon = sample(2, horizonRay, [Math.cos(duskAngle), 0, Math.sin(duskAngle)]);
    const tangentProfile = [];
    for (let altitude = 4; altitude <= heightKm; altitude += 4) {
      const value = sample(500, tangentRay(500, altitude), daySun);
      tangentProfile.push({ altitude, ...value });
    }
    const beyondAtmosphere = sample(500, tangentRay(500, heightKm + 1), daySun);

    // A photographic Earth model is not required to test shell compositing.
    // Give the production Mars shell Earth's dimensions and optical uniforms,
    // and an evenly lit gray surface so attenuation is directly measurable.
    const light = new THREE.Vector3(...nightSun);
    const model = createPlanetModel({ ...getBody("mars"), axialTiltDeg: 0,
      radiusKm, atmosphereKm: heightKm, flattening: 1 }, light);
    const originalSurfaceMaterial = model.surface.material;
    model.surface.material = new THREE.MeshBasicMaterial({ color: 0xb0b0b0 });
    for (const [name, layer] of Object.entries(model.layers)) {
      if (name !== "atmosphere" && layer) layer.visible = false;
    }
    const atmosphere = model.layers.atmosphere!;
    const shell = atmosphere.children[0];
    shell.material.uniforms.atmosphereColor.value.copy(tint);
    shell.material.uniforms.strength.value = atmosphereStrength("earth");
    const planetBlending = shell.material.blending;
    const star = createPlanetModel(getBody("sun"), light);
    const coronaBlending = star.layers.atmosphere!.children[0].material.blending;
    const scene = new THREE.Scene();
    scene.add(model.group);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const size = 256;
    const imageTarget = new THREE.WebGLRenderTarget(size, size);
    imageTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const shots: { name: string; image: string }[] = [];
    function capture(name: string) {
      renderer.setRenderTarget(imageTarget);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(imageTarget, 0, 0, size, size, pixels);
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
    atmosphere.visible = false;
    const clearSurface = capture("atmosphere-surface-clear");
    atmosphere.visible = true;
    const nightSurface = capture("atmosphere-surface-shadowed");
    light.set(...daySun);
    capture("atmosphere-surface-day");
    let surfacePixels = 0, attenuatedPixels = 0, transmissionLoss = 0, maxAddedRadiance = 0;
    for (let i = 0; i < clearSurface.length; i += 4) {
      if (clearSurface[i + 3] < 250) continue;
      const clear = (clearSurface[i] + clearSurface[i + 1] + clearSurface[i + 2]) / 3;
      const shadowed = (nightSurface[i] + nightSurface[i + 1] + nightSurface[i + 2]) / 3;
      surfacePixels++;
      transmissionLoss += clear - shadowed;
      if (clear - shadowed > 1) attenuatedPixels++;
      maxAddedRadiance = Math.max(maxAddedRadiance, shadowed - clear);
    }
    // These planets place their cloud decks in the transparent render list.
    // An alpha-one deck must still receive extinction from the shell above it.
    const cloudAttenuation: { id: string; pixels: number; attenuatedPixels: number; meanTransmissionLoss: number }[] = [];
    const comparisonGroups = [model.group, star.group];
    const replacedCloudMaterials = [];
    scene.remove(model.group);
    light.set(...nightSun);
    for (const id of ["venus", "neptune"] as const) {
      const cloudModel = createPlanetModel({ ...getBody(id), axialTiltDeg: 0,
        radiusKm, atmosphereKm: heightKm, flattening: 1 }, light);
      cloudModel.surface.visible = false;
      const deck = cloudModel.layers.clouds!;
      replacedCloudMaterials.push(deck.material);
      deck.material = new THREE.MeshBasicMaterial({ color: 0xb0b0b0,
        transparent: true, opacity: 1, depthWrite: false });
      const halo = cloudModel.layers.atmosphere!;
      halo.children[0].material.uniforms.atmosphereColor.value.copy(tint);
      halo.children[0].material.uniforms.strength.value = atmosphereStrength("earth");
      scene.add(cloudModel.group);
      comparisonGroups.push(cloudModel.group);
      halo.visible = false;
      const clearCloud = capture(`atmosphere-${id}-cloud-clear`);
      halo.visible = true;
      const shadowedCloud = capture(`atmosphere-${id}-cloud-shadowed`);
      let pixels = 0, attenuated = 0, loss = 0;
      for (let i = 0; i < clearCloud.length; i += 4) {
        if (clearCloud[i + 3] < 250) continue;
        const clear = (clearCloud[i] + clearCloud[i + 1] + clearCloud[i + 2]) / 3;
        const shadowed = (shadowedCloud[i] + shadowedCloud[i + 1] + shadowedCloud[i + 2]) / 3;
        pixels++;
        loss += clear - shadowed;
        if (clear - shadowed > 1) attenuated++;
      }
      cloudAttenuation.push({ id, pixels, attenuatedPixels: attenuated, meanTransmissionLoss: loss / pixels });
      scene.remove(cloudModel.group);
    }
    const glError = renderer.getContext().getError();
    sampleTarget.dispose();
    imageTarget.dispose();
    sampler.geometry.dispose();
    sampler.material.dispose();
    originalSurfaceMaterial.dispose();
    replacedCloudMaterials.forEach(material => material.dispose());
    for (const group of comparisonGroups) group.traverse((object: any) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose());
      else object.material?.dispose();
    });
    renderer.dispose();
    return { zenith, limb, shadowedLimb, noonHorizon, duskHorizon, tangentProfile,
      beyondAtmosphere, finite, planetBlending, coronaBlending,
      normalBlending: THREE.NormalBlending, additiveBlending: THREE.AdditiveBlending,
      surfacePixels, attenuatedPixels, meanTransmissionLoss: transmissionLoss / surfacePixels,
      maxAddedRadiance, cloudAttenuation, glError, shots };
  });
  for (const shot of result.shots) {
    await writeFile(info.outputPath(`${shot.name}.png`), Buffer.from(shot.image, "base64"));
  }
  const { shots: _shots, ...metrics } = result;
  await writeFile(info.outputPath("atmosphere-optics.json"), JSON.stringify(metrics, null, 2));
  expect(errors, "The production atmosphere shaders must compile without browser errors").toEqual([]);
  expect(result.glError).toBe(0);
  expect(result.finite, "Float render-target samples must not contain NaN or infinity").toBe(true);
  const samples = [result.zenith, result.limb, result.shadowedLimb,
    result.noonHorizon, result.duskHorizon, ...result.tangentProfile];
  for (const sample of samples) {
    expect(sample.alpha).toBeGreaterThanOrEqual(0);
    expect(sample.alpha).toBeLessThanOrEqual(1);
    expect(Math.min(sample.r, sample.g, sample.b)).toBeGreaterThanOrEqual(0);
  }
  expect(result.zenith.alpha, "The upper atmosphere must stay transparent in a short outward view").toBeLessThan(0.08);
  expect(result.limb.alpha, "A grazing view traverses more atmosphere than the zenith").toBeGreaterThan(result.zenith.alpha * 8);
  expect(result.limb.radiance).toBeGreaterThan(0.001);
  expect(result.shadowedLimb.radiance, "Planetary shadow must remove the daylight blue shell").toBeLessThan(result.limb.radiance * 0.15);
  expect(result.duskHorizon.r / Math.max(result.duskHorizon.b, 0.000001),
    "A long solar path removes blue light and reddens the dusk horizon")
    .toBeGreaterThan(result.noonHorizon.r / Math.max(result.noonHorizon.b, 0.000001) * 1.25);
  const profile = result.tangentProfile;
  const totalDecay = profile[0].alpha - profile.at(-1)!.alpha;
  const adjacentChanges = profile.slice(1).map((sample, index) => sample.alpha - profile[index].alpha);
  expect(totalDecay).toBeGreaterThan(0.1);
  expect(Math.max(...adjacentChanges), "Density must decay with increasing tangent altitude").toBeLessThan(0.003);
  expect(Math.max(...adjacentChanges.map(Math.abs)), "The limb must fade over a layer, without a hard bright shell band")
    .toBeLessThan(totalDecay * 0.25);
  expect(profile.find(sample => sample.altitude === 100)!.alpha,
    "The 100 km layer must be much thinner than the lower atmospheric limb")
    .toBeLessThan(profile.find(sample => sample.altitude === 20)!.alpha * 0.2);
  expect(result.beyondAtmosphere.alpha).toBe(0);
  expect(result.planetBlending).toBe(result.normalBlending);
  expect(result.coronaBlending, "Stellar coronae remain emissive").toBe(result.additiveBlending);
  expect(result.surfacePixels).toBeGreaterThan(1_000);
  expect(result.attenuatedPixels, "A non-emissive night atmosphere must attenuate the surface beneath it")
    .toBeGreaterThan(result.surfacePixels * 0.1);
  expect(result.meanTransmissionLoss).toBeGreaterThan(0.5);
  expect(result.maxAddedRadiance, "The night shell must not add a luminous coat to the planet").toBeLessThanOrEqual(1);
  for (const cloud of result.cloudAttenuation) {
    expect(cloud.pixels, `${cloud.id} must render a resolved cloud deck`).toBeGreaterThan(1_000);
    expect(cloud.attenuatedPixels, `${cloud.id}'s transparent cloud deck must receive atmospheric extinction`)
      .toBeGreaterThan(cloud.pixels * 0.1);
    expect(cloud.meanTransmissionLoss, `${cloud.id}'s cloud deck must not overwrite atmospheric attenuation`)
      .toBeGreaterThan(0.5);
  }
});
