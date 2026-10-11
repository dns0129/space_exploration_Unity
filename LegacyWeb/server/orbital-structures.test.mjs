import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { surfaceProfile } from "../shared/surface.mjs";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { createAsteroidBelt, createStationModel } from "../src/orbital-structures.ts";

test("belt particles occupy the main belt and enlarged station sits 2400 km above sunlit Earth", () => {
  const earth = world.bodies.find(b => b.id === "earth");
  const station = world.bodies.find(b => b.id === "earth-station");
  const ceres = world.bodies.find(b => b.id === "ceres");
  const offset = new THREE.Vector3(...station.position).sub(new THREE.Vector3(...earth.position));
  assert(Math.abs((offset.length() - earth.radius) * world.unitsKm - 2400) < 1e-5);
  assert(Math.abs(station.radius * world.unitsKm - 180) < 1e-8);
  const sun = world.bodies.find(b => b.id === "sun");
  const sunDirection = new THREE.Vector3(...sun.position).sub(new THREE.Vector3(...earth.position)).normalize();
  assert(offset.clone().normalize().dot(sunDirection) > .98, "station is on the sun-facing side");
  assert(offset.y > 0 && offset.x > 0, "station view has a small inclined offset");
  assert(offset.length() - earth.radius - station.radius > 2000 / world.unitsKm, "entire envelope clears Earth");
  for (const normal of [new THREE.Vector3(0, 0, 0), ...Array.from({ length: 32 }, (_, i) => {
    const z = 1 - 2 * (i + .5) / 32, a = i * Math.PI * (3 - Math.sqrt(5));
    return new THREE.Vector3(Math.sqrt(1 - z * z) * Math.cos(a), Math.sqrt(1 - z * z) * Math.sin(a), z);
  })]) {
    const point = new THREE.Vector3(...station.position).addScaledVector(normal, station.radius);
    const lightDirection = new THREE.Vector3(...sun.position).sub(point).normalize();
    assert(new THREE.Vector3(...earth.position).sub(point).dot(lightDirection) < 0,
      "Earth remains behind the light ray across the whole station envelope");
  }
  assert.equal(surfaceProfile(station.id).solid, false);
  assert(Math.abs(Math.hypot(...ceres.position) * world.unitsKm / world.auKm - 2.77) < 1e-8);
  const belt = createAsteroidBelt(world.unitsKm, world.auKm);
  const positions = belt.children[0].geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const au = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)) * world.unitsKm / world.auKm;
    const { semimajorAxes, eccentricities } = belt.children[0].geometry.userData.orbits;
    const a = semimajorAxes[i], e = eccentricities[i];
    assert(a >= 2.1 && a <= 3.3);
    assert(au >= a * (1 - e) - 1e-6 && au <= a * (1 + e) + 1e-6);
    const diameterKm = belt.children[0].geometry.getAttribute("diameter").getX(i) * world.unitsKm;
    assert(diameterKm >= 1.999 && diameterKm <= 200.001);
  }
  assert.equal(belt.children.length, 1, "no artificial Ceres rock swarm");
  const model = createStationModel({ id: station.id });
  const bounds = new THREE.Box3().setFromObject(model.group, true);
  assert(bounds.min.x >= -1 && bounds.max.x <= 1);
  assert(Number.isFinite(bounds.min.y) && bounds.max.y > bounds.min.y, "station has a finite three-dimensional hull");
  let emissive = false;
  model.group.traverse(object => {
    if (object.isMesh) emissive ||= [object.material].flat().some(material => material.emissive?.getHex() > 0);
  });
  assert(emissive, "station architecture contains sci-fi emissive lighting");
});

test("new destinations warp safely, persist and leave the Earth's gravity rules intact", () => {
  for (const from of ["earth", "jupiter", "proxima-b"]) {
    for (const target of ["ceres", "earth-station"]) {
      const ship = new ShipDynamics();
      ship.jump(from); ship.target = target;
      assert.equal(ship.startWarp(), null, `${from} → ${target}`);
      for (let i = 0; i < 2500 && ship.warpPhase !== "ready"; i++) {
        ship.step(0.025, emptyInput());
        for (const body of ship.activeBodies) {
          assert(ship.position.distanceTo(new THREE.Vector3(...body.position)) > body.radius * (body.kind === "star" ? 1.24 : 1.002), `${from} → ${target} intersects ${body.id}`);
        }
      }
      assert.equal(ship.warpPhase, "ready");
      assert(validateFlightState(ship.snapshot()));
      const restored = new ShipDynamics();
      assert(restored.restore(ship.snapshot()));
      assert.equal(restored.target, target);
      if (target === "earth-station") {
        assert.equal(ship.environment.body.id, "earth");
        assert(ship.environment.altitudeKm > 1000);
        assert.match(ship.landingBlockReason, /不支持自动对接/);
        assert.match(ship.startLanding(), /不支持自动对接/);
      } else assert.equal(ship.environment.body.id, "ceres");
    }
  }
});
