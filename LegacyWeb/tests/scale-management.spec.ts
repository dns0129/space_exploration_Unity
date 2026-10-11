import { test, expect } from "@playwright/test";

// Exercise the production scene adapters, including the exact arrays handed to Rapier.
test("米制地面网格、人物和相机在远处卫星与重定位后共用同一原点", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.locator("#canvas-host")).toHaveAttribute("data-ready", "true");
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { ShipDynamics, emptyInput } = await import("/src/ship-dynamics.ts");
    const { WalkingDynamics } = await import("/src/walking-dynamics.ts");
    const { initializeWalkingPhysics } = await import("/src/walking-physics.ts");
    const { SurfaceScene } = await import("/src/surface-scene.ts");
    const { ExplorerView } = await import("/src/explorer-view.ts");
    await initializeWalkingPhysics();
    const checks = [];
    for (const id of ["earth", "nereid", "echo-thalassa"] as const) {
      const ship = new ShipDynamics();
      if (ship.placeOnSurface(id, [0, 0, -1])) throw new Error(`place ${id}`);
      const walker = new WalkingDynamics();
      if (walker.disembark(ship)) throw new Error(`exit ${id}`);
      const ground = new SurfaceScene(), explorer = new ExplorerView();
      const camera = new THREE.PerspectiveCamera(65, 1, 0.03, 1e8);
      const sun = new THREE.PointLight(); sun.position.set(1, 1, -1);
      const update = (immediate = false) => {
        explorer.update(walker, ship, camera, "third", 0.05, false, immediate);
        ground.update(ship, camera, sun, walker);
        ground.group.updateMatrixWorld(true);
      };
      update(true);
      // Render straight down with a known green map: a hidden/inward collider
      // mesh must not leave a hole exposing the sky beneath the explorer.
      const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
      renderer.setSize(64, 64);
      const visibleScene = new THREE.Scene(); visibleScene.add(ground.group, ground.sky);
      const texture = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
      texture.needsUpdate = true;
      ground.setHorizonMap(id, texture, new THREE.Matrix3());
      const downCamera = camera.clone();
      downCamera.position.copy(walker.localPositionM).addScaledVector(walker.outward, 1.65);
      downCamera.up.copy(new THREE.Vector3(1, 0, 0).projectOnPlane(walker.outward).normalize());
      downCamera.lookAt(walker.localPositionM); downCamera.updateMatrixWorld();
      const overheadSun = new THREE.PointLight(); overheadSun.position.copy(walker.outward);
      ground.update(ship, downCamera, overheadSun, walker);
      renderer.render(visibleScene, downCamera);
      const pixel = new Uint8Array(4);
      renderer.getContext().readPixels(32, 32, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixel);
      const groundVisible = pixel[1] > 50 && pixel[1] > pixel[0] * 1.5 && pixel[1] > pixel[2] * 1.5;
      renderer.dispose(); renderer.forceContextLoss(); texture.dispose();
      // A restored Rapier world restarts its patch revision at 1. Reuse the
      // same SurfaceScene and require its displayed mesh to follow the new
      // patch object even when the numerical revision is unchanged.
      for (let i = 0; i < 8; i++) walker.step(0.25, { ...emptyInput(), throttle: 1 });
      const checkpoint = walker.snapshot();
      walker.restore(checkpoint, ship);
      if (!walker.active) throw new Error(`restore ${id}`);
      update(true);
      const restoredMesh = ground.group.getObjectByName("rapier-collision-ground") as THREE.Mesh;
      const restoredPositions = restoredMesh.geometry.getAttribute("position");
      let restoredVertexError = 0;
      for (const index of [0, Math.floor(restoredPositions.count / 2), restoredPositions.count - 1]) {
        const visible = new THREE.Vector3().fromBufferAttribute(restoredPositions, index).applyMatrix4(restoredMesh.matrixWorld);
        const physics = new THREE.Vector3().fromArray(walker.terrainPatch!.vertices, index * 3);
        restoredVertexError = Math.max(restoredVertexError, visible.distanceTo(physics));
      }
      let previousOrigin = JSON.stringify(walker.localFrame.originUniverse), rebases = 0;
      let cameraDiscontinuity = 0, maxVertexError = 0;
      let priorRelative = camera.position.clone().sub(walker.localPositionM);
      for (let i = 0; i < (id === "nereid" ? 1000 : 10); i++) {
        walker.step(0.25, { ...emptyInput(), throttle: 1, boost: true });
        update();
        const origin = JSON.stringify(walker.localFrame.originUniverse);
        const relative = camera.position.clone().sub(walker.localPositionM);
        if (origin !== previousOrigin) {
          rebases++;
          cameraDiscontinuity = Math.max(cameraDiscontinuity, relative.distanceTo(priorRelative));
        }
        priorRelative.copy(relative); previousOrigin = origin;
        const mesh = ground.group.getObjectByName("rapier-collision-ground") as THREE.Mesh;
        if (!mesh) throw new Error("missing collision ground mesh");
        const positions = mesh.geometry.getAttribute("position"), patch = walker.terrainPatch!;
        // Compare displayed geometry and collider vertices in the SAME shifted metre frame.
        for (const index of [0, Math.floor(positions.count / 2), positions.count - 1]) {
          const visible = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          const physics = new THREE.Vector3().fromArray(patch.vertices, index * 3);
          maxVertexError = Math.max(maxVertexError, visible.distanceTo(physics));
        }
      }
      checks.push({ id, groundVisible, rebases, cameraDiscontinuity, maxVertexError, restoredVertexError,
        outwardWinding: new THREE.Vector3().fromArray(walker.terrainPatch!.vertices, walker.terrainPatch!.indices[1] * 3)
          .sub(new THREE.Vector3().fromArray(walker.terrainPatch!.vertices, walker.terrainPatch!.indices[0] * 3))
          .cross(new THREE.Vector3().fromArray(walker.terrainPatch!.vertices, walker.terrainPatch!.indices[2] * 3)
            .sub(new THREE.Vector3().fromArray(walker.terrainPatch!.vertices, walker.terrainPatch!.indices[0] * 3)))
          .dot(walker.outward),
        localLength: walker.localPositionM.length(), clearance: walker.groundClearanceM,
        near: camera.near, groundScale: ground.group.scale.toArray() });
      walker.reset(); ground.dispose();
    }
    return checks;
  });
  for (const check of result) {
    expect(check.groundVisible, "actual ground must draw beneath the feet").toBe(true);
    expect(check.maxVertexError, check.id).toBeLessThan(0.0001);
    expect(check.restoredVertexError, `restored mesh ${check.id}`).toBeLessThan(0.0001);
    expect(check.cameraDiscontinuity, check.id).toBeLessThan(0.5);
    expect(check.clearance, check.id).toBeGreaterThanOrEqual(-0.015);
    expect(check.outwardWinding, "visible triangles must face above ground").toBeGreaterThan(0);
    expect(check.near).toBe(0.03);
    expect(check.groundScale).toEqual([1, 1, 1]);
  }
  expect(result.find(check => check.id === "nereid")!.rebases).toBeGreaterThanOrEqual(2);
});
