import { test, expect } from "@playwright/test";

test("徒步镜头使用真实三角地形处理山脊遮挡，并在重定位与存档恢复后保持对齐", async ({ page }) => {
  test.setTimeout(120_000);
  // Import the production adapters without starting the unrelated renderer or
  // downloading planet textures. All camera updates below use ExplorerView.
  await page.goto("/api/world");
  const checks = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { ShipDynamics } = await import("/src/ship-dynamics.ts");
    const { WalkingDynamics } = await import("/src/walking-dynamics.ts");
    const { initializeWalkingPhysics, CAMERA_COLLISION_RADIUS_M } = await import("/src/walking-physics.ts");
    const { ExplorerView } = await import("/src/explorer-view.ts");
    const { SurfaceScene } = await import("/src/surface-scene.ts");
    const { sampleSurface, surfaceRadiusM } = await import("/shared/spatial-frame.mjs");
    const { validateFlightState } = await import("/shared/flight-state.mjs");
    await initializeWalkingPhysics();
    const results = [];
    for (const fixture of [
      { id: "earth", normal: [0, 0, -1], azimuth: 0, blocked: false },
      // Natural Naiad ridge: the desired endpoint is clear of the ground, but
      // the eye-to-camera segment crosses a hill. Endpoint height clamps miss it.
      { id: "naiad", normal: [-0.12799769311254275, 0.87, 0.47614765625577465],
        azimuth: Math.PI / 9, blocked: true },
    ] as const) {
      const ship = new ShipDynamics();
      if (ship.placeOnSurface(fixture.id, [...fixture.normal])) throw new Error(`place ${fixture.id}`);
      const body = ship.config.bodies.find(candidate => candidate.id === fixture.id)!;
      const normal = new THREE.Vector3(...fixture.normal).normalize();
      const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
      const radial = normal.clone().multiplyScalar(surfaceRadiusM(ship.config, body, normal.toArray()))
        .addScaledVector(tangent, 100);
      radial.fromArray(sampleSurface(ship.config, body, radial.toArray()).surfaceRadialM);
      const up = radial.clone().normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const behind = up.clone().cross(right).multiplyScalar(Math.cos(fixture.azimuth))
        .addScaledVector(right, Math.sin(fixture.azimuth));
      const orientation = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(), behind.clone().negate(), up));
      const walker = new WalkingDynamics();
      // A valid airborne checkpoint avoids requiring steep terrain to support
      // a standing capsule. The parked ship is 100 m away and cannot occlude it.
      walker.restore({ bodyId: fixture.id, offsetM: radial.clone().sub(ship.bodyRadialM).toArray(),
        velocityMps: [0, 0, 0], orientation: orientation.toArray(), pitch: 0, grounded: false }, ship);
      if (!walker.active) throw new Error(`restore ${fixture.id}`);
      const explorer = new ExplorerView(), surface = new SurfaceScene();
      const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.03, 1e8);
      const sun = new THREE.PointLight(); sun.position.set(1, 1, -1);
      const eye = () => walker.localPositionM.clone().addScaledVector(walker.outward, 1.65);
      const forward = () => new THREE.Vector3(0, 0, -1).applyQuaternion(walker.orientation);
      const desired = () => eye().addScaledVector(forward(), -5).addScaledVector(walker.outward, 0.7);
      const update = (immediate: boolean, view: "first" | "third" = "third") => {
        explorer.update(walker, ship, camera, view, 0, true, immediate);
        surface.update(ship, camera, sun, walker);
        surface.group.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
      };
      // These independent checks use the actual displayed mesh, not the Rapier
      // camera method or the analytical height function used to select fixtures.
      const meshChecks = () => {
        const mesh = surface.group.getObjectByName("rapier-collision-ground") as THREE.Mesh;
        if (!mesh) throw new Error("missing visible collision terrain");
        const attribute = mesh.geometry.getAttribute("position"), index = mesh.geometry.getIndex()!;
        const vertices = new Float64Array(attribute.count * 3), point = new THREE.Vector3();
        for (let i = 0; i < attribute.count; i++)
          point.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld).toArray(vertices, i * 3);
        const triangle = new THREE.Triangle(), nearest = new THREE.Vector3();
        const distance = (position: THREE.Vector3) => {
          let minimum = Infinity;
          for (let i = 0; i < index.count; i += 3) {
            triangle.a.fromArray(vertices, index.getX(i) * 3);
            triangle.b.fromArray(vertices, index.getX(i + 1) * 3);
            triangle.c.fromArray(vertices, index.getX(i + 2) * 3);
            triangle.closestPointToPoint(position, nearest);
            minimum = Math.min(minimum, nearest.distanceTo(position));
          }
          return minimum;
        };
        const hitDistance = (end: THREE.Vector3) => {
          const boom = end.clone().sub(eye());
          return new THREE.Raycaster(eye(), boom.clone().normalize(), 0, boom.length())
            .intersectObject(mesh, false)[0]?.distance ?? null;
        };
        let nearPlaneClearance = Infinity;
        for (const x of [-1, 1]) for (const y of [-1, 1])
          nearPlaneClearance = Math.min(nearPlaneClearance, distance(new THREE.Vector3(x, y, -1).unproject(camera)));
        return { endpointClearance: distance(desired()), cameraClearance: distance(camera.position),
          nearPlaneClearance, desiredHit: hitDistance(desired()), actualHit: hitDistance(camera.position),
          boomLength: camera.position.distanceTo(eye()), desiredLength: desired().distanceTo(eye()),
          lookError: 1 - camera.getWorldDirection(new THREE.Vector3())
            .dot(eye().addScaledVector(forward(), 8).sub(camera.position).normalize()) };
      };
      try {
        const originalState = JSON.stringify(walker.snapshot());
        update(true);
        const initial = meshChecks(), relative = camera.position.clone().sub(eye());
        const originalRotation = camera.quaternion.clone();
        // Lower only the threshold to exercise a translation without moving the
        // person. The existing scale acceptance also crosses the normal 256 m.
        walker.localFrame!.rebaseDistanceM = 50;
        const rebased = walker.rebaseIfNeeded();
        update(false);
        const afterRebase = meshChecks();
        const rebasePositionError = camera.position.clone().sub(eye()).distanceTo(relative);
        const rebaseRotationError = camera.quaternion.angleTo(originalRotation);
        const stateUnchanged = JSON.stringify(walker.snapshot()) === originalState;
        const saved = validateFlightState({ ...ship.snapshot(), walking: walker.snapshot() });
        if (!saved?.walking) throw new Error("invalid camera checkpoint");
        const portable = !/localOrigin|originUniverse|rebaseRevision|terrainPatch/.test(JSON.stringify(saved));
        // Reuse the ExplorerView while restore recreates Rapier and chooses its
        // own temporary origin. Immediate restore must align on its first frame.
        walker.restore(JSON.parse(JSON.stringify(saved.walking)), ship);
        if (!walker.active) throw new Error("camera checkpoint failed to restore");
        const restoredState = JSON.stringify(walker.snapshot());
        update(true);
        const afterRestore = meshChecks();
        const restorePositionError = camera.position.clone().sub(eye()).distanceTo(relative);
        const restoreRotationError = camera.quaternion.angleTo(originalRotation);
        update(true, "first");
        const firstPersonError = camera.position.distanceTo(eye());
        results.push({ id: fixture.id, blocked: fixture.blocked, radius: CAMERA_COLLISION_RADIUS_M,
          initial, afterRebase, afterRestore, rebased, rebasePositionError, rebaseRotationError,
          restorePositionError, restoreRotationError, stateUnchanged, portable, firstPersonError,
          restoredStateUnchanged: JSON.stringify(walker.snapshot()) === restoredState });
      } finally {
        walker.reset(); surface.dispose();
        explorer.group.traverse(object => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
        });
      }
    }
    return results;
  });
  for (const check of checks) {
    expect(check.initial.endpointClearance, `${check.id}: the desired endpoint itself is unobstructed`).toBeGreaterThan(0.3);
    if (check.blocked) {
      expect(check.initial.desiredHit, "the natural ridge must cross the uncorrected camera boom").not.toBeNull();
      expect(check.initial.boomLength).toBeLessThan(check.initial.desiredHit!);
      expect(check.initial.boomLength).toBeLessThan(check.initial.desiredLength - 1);
    } else {
      expect(check.initial.desiredHit).toBeNull();
      expect(check.initial.boomLength).toBeCloseTo(check.initial.desiredLength, 6);
    }
    for (const frame of [check.initial, check.afterRebase, check.afterRestore]) {
      expect(frame.actualHit, `${check.id}: terrain must not hide the person along the corrected boom`).toBeNull();
      expect(frame.cameraClearance).toBeGreaterThan(check.radius - 0.002);
      expect(frame.nearPlaneClearance).toBeGreaterThan(0.1);
      expect(frame.lookError).toBeLessThan(1e-9);
    }
    expect(check.rebased).toBe(true);
    expect(check.rebasePositionError).toBeLessThan(0.0001);
    expect(check.rebaseRotationError).toBeLessThan(0.0001);
    expect(check.restorePositionError).toBeLessThan(0.002);
    expect(check.restoreRotationError).toBeLessThan(0.001);
    expect(check.firstPersonError, "the character capsule must not push its own camera away").toBeLessThan(0.0001);
    expect(check.stateUnchanged).toBe(true);
    expect(check.restoredStateUnchanged).toBe(true);
    expect(check.portable).toBe(true);
  }
});
