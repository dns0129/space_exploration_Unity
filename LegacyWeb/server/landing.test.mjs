import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { terrainHeightKm, surfaceProfile, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { mappedMountainNormal } from "./terrain-fixtures.mjs";
import { propulsionBand } from "../shared/propulsion.mjs";

function place(ship, id, clearanceKm, normal = new THREE.Vector3(0, 0, -1)) {
  ship.jump(id);
  const body = world.bodies.find((candidate) => candidate.id === id);
  const height = terrainHeightKm(id, normal.toArray()) + LANDING_CLEARANCE_KM;
  ship.position.fromArray(body.position).addScaledVector(normal, body.radius + (height + clearanceKm) / world.unitsKm);
  return body;
}
test("Earth's 100 km entry uses the same kilometre shell as the sky, with thin aerodynamic density", () => {
  const ship = new ShipDynamics();
  const earth = world.bodies.find(body => body.id === "earth");
  ship.jump("earth");
  for (const altitude of [20, 100, 159.9, 160.1, 500]) {
    ship.position.fromArray(earth.position).add(new THREE.Vector3(0, 0, -earth.radius - altitude / world.unitsKm));
    assert(Math.abs(ship.environment.altitudeKm - altitude) < 0.000001);
    assert.equal(ship.environment.atmospheric, altitude < 160);
    if (altitude === 100) {
      assert(ship.environment.density > 0 && ship.environment.density < 0.001);
      ship.target = "mars";
      assert.equal(ship.startWarp(), null, "visual atmosphere entry must not impose a warp altitude restriction");
      ship.cancelWarp();
    }
  }
});
test("all solid worlds descend continuously, touch terrain, stay landed and restore a valid surface save", () => {
  for (const body of world.bodies.filter((candidate) => surfaceProfile(candidate.id).solid)) {
    const ship = new ShipDynamics();
    place(ship, body.id, 1);
    assert.equal(ship.startLanding(), null, body.id);
    let previous = ship.position.clone();
    let altitude = ship.environment.groundAltitudeKm;
    for (let i = 0; i < 1600 && ship.landingPhase !== "landed"; i++) {
      ship.step(0.05, emptyInput());
      const env = ship.environment;
      assert(env.groundAltitudeKm <= altitude + 1e-6);
      assert(ship.position.distanceTo(previous) * world.unitsKm <= 0.04);
      altitude = env.groundAltitudeKm;
      previous.copy(ship.position);
    }
    assert.equal(ship.landedBody, body.id);
    assert(ship.environment.groundAltitudeKm < 1e-6);
    assert.equal(ship.velocity.length(), 0);
    const saved = ship.snapshot();
    assert(validateFlightState(saved));
    assert.equal(saved.worldLayoutVersion, world.layoutVersion ?? 1);
    ship.step(0.25, { ...emptyInput(), throttle: 1, roll: 1 });
    assert.deepEqual(ship.position.toArray(), saved.position);
    const restored = new ShipDynamics();
    assert(restored.restore(saved));
    assert.equal(restored.landingPhase, "landed");
    assert.deepEqual(restored.snapshot(), saved);
    assert.equal(restored.takeOff(), null);
    for (let i = 0; i < 1000 && restored.landingPhase === "ascending"; i++) restored.step(0.05, emptyInput());
    assert.equal(restored.landingPhase, "manual");
    assert(restored.environment.groundAltitudeKm >= 2);
    assert.equal(restored.landedBody, null);
    const takeoffHeight = restored.environment.groundAltitudeKm;
    const takeoffSpeedKm = restored.velocity.length() * world.unitsKm;
    restored.step(0.05, emptyInput());
    assert(restored.environment.groundAltitudeKm - takeoffHeight <= takeoffSpeedKm * 0.05 + 1e-6,
      "takeoff must continue from its actual velocity instead of jumping to the old shield radius");
  }
});
test("automatic descent uses space speed through the atmosphere, then low-altitude speed above actual terrain", () => {
  const ship = new ShipDynamics();
  place(ship, "earth", 200);
  ship.setCruiseSpeed(250);
  ship.setLowFlightSpeed(1000);
  ship.orientation.setFromEuler(new THREE.Euler(0.7, -0.4, 0.9));
  assert(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.orientation).dot(ship.environment.outward) < 0.99);
  assert.equal(ship.startLanding(), null);
  let previous = ship.position.clone(), enteredAtmosphere = false, fastAtmosphericSteps = 0, slowApproach = false;
  for (let i = 0; i < 1200 && ship.landingPhase !== "landed"; i++) {
    const before = ship.environment;
    ship.step(0.05, emptyInput());
    const after = ship.environment;
    const speedKm = ship.velocity.length() * world.unitsKm;
    const travelledKm = ship.position.distanceTo(previous) * world.unitsKm;
    if (before.groundAltitudeKm <= 10 + 1e-6) {
      assert(speedKm <= 1 + 1e-8);
      assert(travelledKm <= 0.05 + 1e-6);
    } else if (after.groundAltitudeKm <= 10 + 1e-6) {
      assert(speedKm <= 1 + 1e-8);
      assert(travelledKm <= before.groundAltitudeKm - 10 + 0.05 + 1e-6,
        "only the part above 10 km may use the faster space preset");
    } else {
      assert(speedKm <= 250 + 1e-8);
      assert(travelledKm <= 250 * 0.05 + 1e-6);
    }
    assert(Math.abs(travelledKm - (before.groundAltitudeKm - after.groundAltitudeKm)) < 1e-6);
    assert.equal(ship.engineMode, propulsionBand(250).id);
    assert.equal(ship.cruiseSpeedKm, 250);
    assert(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.orientation).dot(after.outward) > 0.999,
      "automatic landing must retain surface alignment");
    if (!before.atmospheric && after.atmospheric) {
      enteredAtmosphere = true;
      assert(travelledKm > 1, "entering the atmosphere must not apply the former 1 km/s cap");
    }
    if (after.atmospheric && speedKm > 100) fastAtmosphericSteps++;
    if (after.groundAltitudeKm < 1 && ship.landingPhase !== "landed") {
      slowApproach = true;
      assert(speedKm > 0 && speedKm < 1, "landing safety may decelerate below the selectable cruise minimum");
    }
    assert(after.groundAltitudeKm <= before.groundAltitudeKm + 1e-6);
    previous.copy(ship.position);
  }
  assert(enteredAtmosphere);
  assert(fastAtmosphericSteps > 1, "descent must sustain speeds above 100 km/s inside the atmosphere");
  assert(slowApproach);
  assert.equal(ship.landingPhase, "landed");
  assert.equal(ship.landedBody, "earth");
  assert.equal(ship.velocity.length(), 0);
  assert(ship.environment.groundAltitudeKm < 1e-6);
});

test("automatic descent above 10 km obeys the selected space speed and preserves both speed presets in saves", () => {
  for (const id of ["earth", "moon"]) {
    for (const selectedKm of [1, 100, 1000, 150000]) {
      const ship = new ShipDynamics();
      place(ship, id, 4000);
      ship.setCruiseSpeed(selectedKm);
      ship.setLowFlightSpeed(133);
      assert.equal(ship.startLanding(), null);
      for (let i = 0; i < 3; i++) {
        const previous = ship.position.clone();
        ship.step(0.05, emptyInput());
        const speedKm = ship.velocity.length() * world.unitsKm;
        assert(speedKm <= selectedKm + 1e-8);
        assert(ship.position.distanceTo(previous) * world.unitsKm <= selectedKm * 0.05 + 1e-6);
        assert.equal(ship.engineMode, propulsionBand(selectedKm).id);
        if (selectedKm <= 1000) {
          assert(Math.abs(speedKm - selectedKm) < 1e-8,
            `${id}: a distant descent must actually reach the selected ${selectedKm} km/s ceiling`);
        } else {
          assert(speedKm > 1000, "the low-altitude preset must not apply above 10 km");
          if (i === 0) assert(speedKm > 2500, "automatic descent must not retain the former 2500 km/s engineering ceiling");
        }
      }
      const saved = ship.snapshot();
      assert(validateFlightState(saved));
      assert.equal(saved.cruiseSpeedKm, selectedKm);
      assert.equal(saved.lowFlightSpeedMps, 133);
      const restored = new ShipDynamics();
      assert(restored.restore(saved));
      assert.deepEqual(restored.snapshot(), saved);
      assert.equal(restored.engineMode, propulsionBand(selectedKm).id);
    }
  }
});

test("automatic low-altitude descent and takeoff use the selected 1, 133 and 1000 m/s speeds in air and vacuum", () => {
  for (const id of ["earth", "moon"]) {
    for (const selectedMps of [1, 133, 1000]) {
      const ship = new ShipDynamics();
      place(ship, id, 5);
      ship.setCruiseSpeed(150000);
      ship.setLowFlightSpeed(selectedMps);
      const startAltitude = ship.environment.groundAltitudeKm;
      assert.equal(ship.startLanding(), null);
      for (let i = 0; i < 20; i++) {
        const previous = ship.position.clone();
        ship.step(0.05, emptyInput());
        assert(Math.abs(ship.velocity.length() * world.unitsKm * 1000 - selectedMps) < 1e-6);
        assert(Math.abs(ship.position.distanceTo(previous) * world.unitsKm * 1000 - selectedMps * 0.05) < 0.001,
          `${id}: each low-altitude descent step must actually move at the selected ${selectedMps} m/s`);
      }
      assert(Math.abs((startAltitude - ship.environment.groundAltitudeKm) * 1000 - selectedMps) < 0.001);
      ship.cancelLanding();
      place(ship, id, 0.02);
      assert.equal(ship.startLanding(), null);
      let previousSpeedKm = selectedMps / 1000, approaching = false;
      for (let i = 0; i < 1000 && ship.landingPhase !== "landed"; i++) {
        const before = ship.environment;
        const previous = ship.position.clone();
        ship.step(0.05, emptyInput());
        const speedKm = ship.velocity.length() * world.unitsKm;
        const after = ship.environment;
        assert(speedKm <= selectedMps / 1000 + 1e-8);
        assert(speedKm <= previousSpeedKm + 1e-8);
        assert(ship.position.distanceTo(previous) * world.unitsKm <= previousSpeedKm * 0.05 + 1e-6);
        assert(after.groundAltitudeKm <= before.groundAltitudeKm + 1e-6);
        if (speedKm > 0 && speedKm < 0.05) approaching = true;
        previousSpeedKm = speedKm;
      }
      assert(approaching, `${id}: approach must remain slow before contact`);
      assert.equal(ship.landedBody, id);
      assert.equal(ship.velocity.length(), 0);
      assert(ship.environment.groundAltitudeKm < 1e-6);
      const saved = ship.snapshot();
      const restored = new ShipDynamics();
      assert(restored.restore(saved));
      assert.deepEqual(restored.snapshot(), saved);
      assert.equal(restored.lowFlightSpeedMps, selectedMps);
      assert.equal(restored.takeOff(), null);
      const takeoffAltitude = restored.environment.groundAltitudeKm;
      for (let i = 0; i < 20; i++) {
        const previous = restored.position.clone();
        restored.step(0.05, emptyInput());
        const speedKm = restored.velocity.length() * world.unitsKm;
        assert(speedKm > 0 && speedKm <= selectedMps / 1000 + 1e-8);
        assert(restored.position.distanceTo(previous) * world.unitsKm <= selectedMps / 1000 * 0.05 + 1e-6);
        assert.equal(restored.engineMode, propulsionBand(150000).id);
        assert.equal(restored.cruiseSpeedKm, 150000);
      }
      const climbMetres = (restored.environment.groundAltitudeKm - takeoffAltitude) * 1000;
      assert(climbMetres > 0 && climbMetres <= selectedMps + 0.001);
      if (selectedMps === 1) {
        assert(Math.abs(climbMetres - 1) < 0.001,
          `${id}: minimum-speed takeoff must actually climb 1 m in 1 s`);
        assert.equal(restored.landingPhase, "ascending");
      } else {
        for (let i = 0; i < 1000 && restored.landingPhase === "ascending"; i++) {
          const previous = restored.position.clone();
          restored.step(0.05, emptyInput());
          assert(restored.velocity.length() * world.unitsKm <= selectedMps / 1000 + 1e-8);
          assert(restored.position.distanceTo(previous) * world.unitsKm <= selectedMps / 1000 * 0.05 + 1e-6);
        }
        assert.equal(restored.landingPhase, "manual");
        assert(restored.environment.groundAltitudeKm >= 2);
      }
    }
  }
});

test("a long automatic descent step splits travel at 10 km above actual terrain and finishes at the low-altitude speed", () => {
  // The existing centimetre margin handles subtraction at AU-scale coordinates.
  const boundaryKm = 10 + 1e-5;
  const normal = mappedMountainNormal();
  assert(terrainHeightKm("earth", normal.toArray()) > 4,
    "the mountain's ground boundary must lie above the old reference-sphere shell");
  for (const id of ["earth", "moon"]) {
    for (const selectedMps of [1, 133, 1000]) {
      const ship = new ShipDynamics();
      place(ship, id, 10.025, normal);
      ship.setCruiseSpeed(1);
      ship.setLowFlightSpeed(selectedMps);
      assert.equal(ship.startLanding(), null);
      ship.velocity.copy(normal).multiplyScalar(-1 / world.unitsKm);
      const beforeAltitude = ship.environment.groundAltitudeKm;
      const previous = ship.position.clone();
      const outsideKm = beforeAltitude - boundaryKm;
      const outsideSeconds = outsideKm / 1;
      assert(outsideSeconds > 0 && outsideSeconds < 0.05);
      const expectedTravelKm = outsideKm + selectedMps / 1000 * (0.25 - outsideSeconds);
      ship.step(0.25, emptyInput());
      const after = ship.environment;
      const travelledKm = ship.position.distanceTo(previous) * world.unitsKm;
      assert.equal(after.atmospheric, id === "earth");
      assert(after.groundAltitudeKm < 10);
      assert(Math.abs(travelledKm - expectedTravelKm) < 1e-6,
        `${id}: the long step must use space speed up to the centimetre-safe boundary and low speed for the remaining time`);
      assert(Math.abs(after.groundAltitudeKm - (beforeAltitude - expectedTravelKm)) < 1e-6,
        "the landing position must match the integrated travel across both speed zones");
      assert(Math.abs(ship.velocity.length() * world.unitsKm * 1000 - selectedMps) < 1e-6,
        "the endpoint velocity must use the low-altitude preset");
      assert.equal(ship.engineMode, propulsionBand(1).id);
      if (id === "earth") {
        assert(after.altitudeKm > 14, "mountain terrain must activate low speed above the old radial shell");
      }
      const lowStartAltitude = after.groundAltitudeKm;
      for (let i = 0; i < 20; i++) ship.step(0.05, emptyInput());
      assert(Math.abs((lowStartAltitude - ship.environment.groundAltitudeKm) * 1000 - selectedMps) < 0.001,
        "sustained descent below the boundary must actually use the selected low-altitude speed");
    }
  }
});

test("landed legacy saves migrate low-altitude speed and clamp space presets without moving the terrain anchor", () => {
  for (const [legacyCruiseKm, expectedCruiseKm] of [[-30, 1], [0.5, 1], [170000, 150000]]) {
    const ship = new ShipDynamics();
    place(ship, "earth", 0.00001);
    assert.equal(ship.startLanding(), null);
    ship.step(0.05, emptyInput());
    assert.equal(ship.landedBody, "earth");
    const saved = ship.snapshot();
    const legacy = { ...saved, cruiseSpeedKm: legacyCruiseKm, atmosphericSpeedMps: 133 };
    delete legacy.lowFlightSpeedMps;
    const restored = new ShipDynamics();
    assert(restored.restore(legacy));
    assert.equal(restored.cruiseSpeedKm, expectedCruiseKm);
    assert.equal(restored.lowFlightSpeedMps, 133);
    assert.equal(restored.engineMode, propulsionBand(expectedCruiseKm).id);
    assert.equal(restored.landingPhase, "landed");
    assert.equal(restored.velocity.length(), 0);
    assert.deepEqual(restored.position.toArray(), saved.position);
    assert.deepEqual(restored.orientation.toArray(), saved.orientation);
    const migrated = restored.snapshot();
    assert.equal(migrated.worldLayoutVersion, saved.worldLayoutVersion);
    assert.equal(migrated.lowFlightSpeedMps, 133);
    assert.equal("atmosphericSpeedMps" in migrated, false);
    assert(validateFlightState(migrated));
  }
});

test("landing rejects giant planets, the Sun, wrong targets and warp; manual input safely cancels descent", () => {
  const ship = new ShipDynamics();
  for (const id of ["sun", "jupiter", "saturn", "uranus", "neptune", "alpha-centauri-a", "alpha-centauri-b", "proxima-centauri", "betelgeuse", "echo-pulsar", "veyl", "ruin", "shard"]) {
    ship.jump(id);
    const before = ship.snapshot();
    assert(ship.startLanding());
    assert.deepEqual(ship.snapshot(), before);
  }
  place(ship, "earth", 1);
  ship.target = "mars";
  assert(ship.startLanding());
  ship.target = "earth";
  assert.equal(ship.startLanding(), null);
  assert(ship.startWarp());
  ship.step(0.05, { ...emptyInput(), brake: true });
  assert.equal(ship.landingPhase, "manual");
  assert.equal(ship.landedBody, null);
  assert(ship.environment.groundAltitudeKm > 0.9);
});
test("slow manual contact lands while fast contact still brakes without tunnelling", () => {
  const ship = new ShipDynamics();
  place(ship, "mars", 0.0002);
  ship.assist = false;
  ship.orientation.setFromEuler(new THREE.Euler(0.5, 0.2, 0.7));
  ship.velocity.set(0, 0, 0.01 / world.unitsKm);
  const previous = ship.position.clone();
  ship.step(0.05, emptyInput());
  assert.equal(ship.landedBody, "mars");
  assert(ship.environment.groundAltitudeKm < 1e-6);
  const normal = ship.environment.outward;
  assert(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.orientation).dot(normal) > 0.999);
  assert(ship.position.distanceTo(previous) * world.unitsKm <= 0.0002 + 1e-6);
  assert.equal(ship.velocity.length(), 0);
  const saved = ship.snapshot();
  const restored = new ShipDynamics();
  assert(restored.restore(saved));
  assert.deepEqual(restored.snapshot(), saved);
  ship.step(0.05, { ...emptyInput(), lift: 1 });
  assert.equal(ship.landingPhase, "ascending");
  const fast = new ShipDynamics();
  place(fast, "mars", 0.02);
  fast.assist = false;
  fast.velocity.set(0, 0, 50 / world.unitsKm);
  const fastPrevious = fast.position.clone();
  fast.step(0.05, emptyInput());
  assert.equal(fast.collision, "mars");
  assert.equal(fast.velocity.length(), 0);
  assert(fast.environment.groundAltitudeKm >= 0 && fast.environment.groundAltitudeKm < 0.002);
  assert(fast.position.distanceTo(fastPrevious) * world.unitsKm <= 0.02 + 1e-6,
    "a fast contact must stop at the terrain instead of tunnelling or jumping to a shield shell");
});
test("density changes drag; unassisted near-surface flight feels gravity; malformed landed saves fail", () => {
  const air = new ShipDynamics(), vacuum = new ShipDynamics();
  place(air, "earth", 1);
  place(vacuum, "moon", 1);
  for (const ship of [air, vacuum]) {
    ship.assist = false;
    ship.velocity.set(0.1 / world.unitsKm, 0, 0);
  }
  air.step(0.25, emptyInput()); vacuum.step(0.25, emptyInput());
  assert(air.velocity.x < vacuum.velocity.x);
  assert(air.velocity.z > 0, "gravity points down toward Earth");
  assert(air.environment.density > 0);
  assert.equal(vacuum.environment.density, 0);
  const base = new ShipDynamics().snapshot();
  assert.equal(validateFlightState({ ...base, landedBody: "earth" }), null);
  assert.equal(validateFlightState({ ...base, landedBody: "jupiter" }), null);
  assert.equal(validateFlightState({ ...base, landedBody: "unknown" }), null);
  const earth = world.bodies.find(body => body.id === "earth");
  assert.equal(validateFlightState({ ...base, position: earth.position, landedBody: "earth" }), null);
  const landed = new ShipDynamics();
  place(landed, "proxima-b", 0.00001);
  landed.startLanding();
  landed.step(0.05, emptyInput());
  assert.equal(landed.landedBody, "proxima-b");
  assert.equal(validateFlightState({ ...landed.snapshot(), systemId: "solar" }), null);
});

test("Earth has continuous kilometre-scale mountain ranges and collision follows their peaks", () => {
  const region = mappedMountainNormal();
  const east = new THREE.Vector3(0, 1, 0).cross(region).normalize();
  const north = region.clone().cross(east).normalize();
  let low = Infinity, high = -Infinity, summit;
  for (let x = -100; x <= 100; x += 4) for (let y = -100; y <= 100; y += 4) {
    const normal = region.clone().multiplyScalar(6371).addScaledVector(east, x).addScaledVector(north, y).normalize();
    const height = terrainHeightKm("earth", normal.toArray());
    assert(height >= 0 && height < 10);
    low = Math.min(low, height);
    if (height > high) { high = height; summit = normal; }
    const next = normal.clone().addScaledVector(east, 0.001 / 6371).normalize();
    assert(Math.abs(height - terrainHeightKm("earth", next.toArray())) < 0.005,
      "a metre of lateral travel must not produce a height discontinuity");
  }
  assert(high - low > 3, "a 200 km region must show mountains rather than metre-scale bumps");
  const ship = new ShipDynamics();
  place(ship, "earth", 0.02, summit);
  assert(Math.abs(ship.environment.groundAltitudeKm - 0.02) < 0.00001);
  assert.equal(ship.startLanding(), null);
  for (let i = 0; i < 1600 && ship.landingPhase !== "landed"; i++) ship.step(0.05, emptyInput());
  assert.equal(ship.landingPhase, "landed");
  assert(Math.abs(ship.environment.groundAltitudeKm) < 0.00001);
});
