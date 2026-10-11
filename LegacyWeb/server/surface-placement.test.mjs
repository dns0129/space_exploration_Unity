import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics, initializeWalkingPhysics } from "../src/walking-dynamics.ts";
import { world, validateFlightState, WALKING_GROUNDED_CLEARANCE_M } from "../shared/flight-state.mjs";
import { surfaceProfile, terrainMapNormal, terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

await initializeWalkingPhysics();

test("direct placement on every solid body uses the chosen terrain and creates restorable ship and walking saves", () => {
  const bodies = world.bodies.filter(body => surfaceProfile(body.id).solid);
  assert.equal(bodies.length, 40);
  for (const body of bodies) {
    for (const uv of [[0.17, 0.61], [0.995, 0.32], [0.4, 1]]) {
      const normal = new THREE.Vector3().fromArray(terrainMapNormal(body.id, uv));
      const ship = new ShipDynamics();
      ship.velocity.set(1, 2, 3);
      ship.angularVelocity.set(0.2, 0.3, 0.4);
      ship.bank = 0.8;
      assert.equal(ship.placeOnSurface(body.id, normal.clone().multiplyScalar(3).toArray()), null, body.id);
      assert.equal(ship.landingPhase, "landed", body.id);
      assert.equal(ship.warpPhase, "ready", body.id);
      assert.equal(ship.landedBody, body.id);
      assert.equal(ship.target, body.id);
      assert.equal(ship.systemId, body.systemId ?? "solar");
      assert.equal(ship.camera, "chase");
      assert.equal(ship.velocity.length(), 0);
      assert.equal(ship.angularVelocity.length(), 0);
      assert.equal(ship.bank, 0);
      const radial = ship.position.clone().sub(new THREE.Vector3().fromArray(body.position));
      const radialErrorM = radial.clone().normalize().distanceTo(normal) * body.radius * world.unitsKm * 1000;
      assert(radialErrorM < 0.01, `${body.id} keeps the chosen radial within AU-coordinate precision`);
      const expectedHeight = terrainHeightKm(body.id, radial.clone().normalize().toArray()) + LANDING_CLEARANCE_KM;
      const actualHeight = (radial.length() - body.radius) * world.unitsKm;
      assert(Math.abs(actualHeight - expectedHeight) < 1e-5, `${body.id} sits on collision terrain`);
      assert(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.orientation).dot(normal) > 1 - 1e-8);
      const saved = ship.snapshot();
      assert(validateFlightState(saved), `${body.id} ship save is valid`);
      ship.step(0.25, { ...emptyInput(), throttle: 1, yaw: 1, roll: 1 });
      assert.deepEqual(ship.position.toArray(), saved.position, `${body.id} stays parked`);
      const walker = new WalkingDynamics();
      assert.equal(walker.disembark(ship), null, body.id);
      assert(walker.active, `${body.id} starts exploration`);
      assert.equal(walker.bodyId, body.id);
      assert(walker.groundClearanceM >= -0.015, `${body.id} capsule feet do not penetrate terrain`);
      if (walker.grounded) assert(walker.groundClearanceM <= WALKING_GROUNDED_CLEARANCE_M,
        `${body.id} walkable slopes support the capsule within its contact margin`);
      assert(Math.abs(walker.groundClearanceM - walker.collisionGroundClearanceM) < 0.015,
        `${body.id} collision mesh matches the displayed terrain sample`);
      const walking = { ...walker.snapshot(), camera: "third" };
      assert(validateFlightState({ ...saved, walking }), `${body.id} walking save is valid`);
      const restoredShip = new ShipDynamics();
      assert(restoredShip.restore(saved));
      assert.equal(restoredShip.landedBody, body.id);
      const restoredWalker = new WalkingDynamics();
      restoredWalker.restore(walking, restoredShip);
      assert(restoredWalker.active, `${body.id} restores exploration`);
      assert.equal(restoredWalker.grounded, walker.grounded, `${body.id} preserves contact state, including unwalkable cliffs`);
      assert.equal(restoredWalker.bodyId, body.id);
      assert(restoredWalker.groundClearanceM >= -0.015);
      assert(restoredWalker.offsetM.distanceTo(walker.offsetM) < 1e-7);
      walker.reset();
      restoredWalker.reset();
      assert.equal(restoredShip.takeOff(), null, body.id);
      restoredShip.step(0.25, emptyInput());
      assert.equal(restoredShip.landingPhase, "ascending", body.id);
      assert.equal(restoredShip.landedBody, null);
      assert(restoredShip.environment.groundAltitudeKm > 0, `${body.id} takes off without an orbital jump`);
    }
  }
});

test("unsupported bodies and malformed surface locations do not mutate the flight", () => {
  const ship = new ShipDynamics();
  ship.velocity.set(0.1, 0.2, 0.3);
  ship.angularVelocity.set(0.2, 0.3, 0.4);
  ship.bank = 0.6;
  const unchanged = (id, radial) => {
    const state = ship.snapshot();
    const angularVelocity = ship.angularVelocity.toArray();
    const bank = ship.bank;
    assert(ship.placeOnSurface(id, radial), `${id} rejects invalid placement`);
    assert.deepEqual(ship.snapshot(), state);
    assert.deepEqual(ship.angularVelocity.toArray(), angularVelocity);
    assert.equal(ship.bank, bank);
  };
  for (const body of world.bodies.filter(body => !surfaceProfile(body.id).solid)) unchanged(body.id, [0, 1, 0]);
  unchanged("missing-body", [0, 1, 0]);
  for (const radial of [null, undefined, [], [1, 2], [1, 2, 3, 4], [0, 0, 0],
    [NaN, 1, 0], [Infinity, 0, 0], [1, "2", 3], [Number.MAX_VALUE, Number.MAX_VALUE, 0]])
    unchanged("earth", radial);
});
