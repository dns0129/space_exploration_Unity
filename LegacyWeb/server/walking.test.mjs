import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics, BOARD_DISTANCE_M, SUIT_MIN_FALL_ACCELERATION_MPS2, initializeWalkingPhysics } from "../src/walking-dynamics.ts";
import { world, validateFlightState, WALKING_GROUNDED_CLEARANCE_M } from "../shared/flight-state.mjs";
import { surfaceProfile, terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

await initializeWalkingPhysics();

function landed(id, normal = new THREE.Vector3(0, 0, -1)) {
  const ship = new ShipDynamics();
  ship.jump(id);
  const body = world.bodies.find(candidate => candidate.id === id);
  const height = terrainHeightKm(id, normal.toArray()) + LANDING_CLEARANCE_KM;
  ship.position.fromArray(body.position).addScaledVector(normal, body.radius + height / world.unitsKm);
  assert.equal(ship.startLanding(), null, id);
  ship.step(0.05, emptyInput());
  assert.equal(ship.landingPhase, "landed", id);
  return ship;
}
function outside(id, normal) {
  const ship = landed(id, normal);
  const walker = new WalkingDynamics();
  assert.equal(walker.disembark(ship), null);
  return { ship, walker };
}
function step(walker, seconds, input = emptyInput()) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.01)
    walker.step(Math.min(0.01, seconds - elapsed), input);
}
function save(ship, walker) { return { ...ship.snapshot(), walking: walker.snapshot() }; }
function assertSupported(walker, id = walker.bodyId) {
  // A real capsule rests slightly above radial terrain on slopes. Both mesh
  // error and the Rapier contact gap are bounded, without allowing penetration.
  assert(walker.groundClearanceM >= -0.015, id);
  assert(walker.groundClearanceM <= WALKING_GROUNDED_CLEARANCE_M, id);
  assert(Math.abs(walker.groundClearanceM - walker.collisionGroundClearanceM) < 0.015, id);
}

test("disembarking requires a landed solid world; boarding requires ground contact and a nearby unchanged ship", () => {
  const walker = new WalkingDynamics(), ship = new ShipDynamics();
  assert(walker.disembark(ship));
  assert.equal(walker.active, false);
  const landedShip = landed("earth");
  const parked = landedShip.snapshot();
  assert.equal(walker.disembark(landedShip), null);
  assert.equal(walker.active, true);
  assert(walker.distanceToShipM < BOARD_DISTANCE_M);
  assertSupported(walker);
  assert.deepEqual(landedShip.snapshot(), parked, "exit must not move or reorient the ship");
  assert(walker.disembark(landedShip));
  walker.step(0.01, { ...emptyInput(), brake: true });
  assert(walker.board(landedShip), "cannot board from the air");
  step(walker, 1.1);
  assert.equal(walker.board(landedShip), null);
  assert.equal(walker.active, false);
  assert.equal(walker.snapshot(), undefined);
  walker.disembark(landedShip);
  step(walker, 12, { ...emptyInput(), throttle: 1 });
  assert(walker.distanceToShipM > BOARD_DISTANCE_M);
  assert(walker.board(landedShip), "cannot board remotely");
  assert.deepEqual(landedShip.snapshot(), parked, "walking leaves the parked ship fixed");
});

test("all solid worlds walk over the shared curved terrain with radial orientation and valid saves", () => {
  for (const body of world.bodies.filter(candidate => surfaceProfile(candidate.id).solid)) {
    const { ship, walker } = outside(body.id, new THREE.Vector3(0.4, 0.7, -0.5).normalize());
    for (let i = 0; i < 30; i++) {
      walker.step(0.05, { ...emptyInput(), throttle: 1, strafe: 0.7, yaw: 0.2, boost: true });
      assert(walker.groundClearanceM >= -0.015, body.id);
      if (walker.grounded) assertSupported(walker, body.id);
      assert(new THREE.Vector3(0, 1, 0).applyQuaternion(walker.orientation).dot(walker.outward) > 0.999999, body.id);
      assert(validateFlightState(save(ship, walker)), body.id);
    }
  }
});

test("equal jump impulse gives Earth and Moon ballistic heights and flight times based on local gravity", () => {
  const sample = id => {
    const { walker } = outside(id);
    let peak = 0, duration = 0;
    walker.step(0.01, { ...emptyInput(), brake: true });
    do {
      peak = Math.max(peak, walker.groundClearanceM);
      walker.step(0.01, emptyInput());
      duration += 0.01;
    } while (!walker.grounded && duration < 10);
    return { peak, duration };
  };
  const earth = sample("earth"), moon = sample("moon");
  // h = v₀²/(2g), t = 2v₀/g. Small tolerances cover the fixed-step integrator.
  assert(Math.abs(earth.peak - 4.5 ** 2 / (2 * 9.81)) < 0.04);
  assert(Math.abs(moon.peak - 4.5 ** 2 / (2 * 1.62)) < 0.04);
  assert(Math.abs(earth.duration - 9 / 9.81) < 0.03);
  assert(Math.abs(moon.duration - 9 / 1.62) < 0.04);
  assert(moon.peak > earth.peak * 5);
  assert(moon.duration > earth.duration * 5);
});

test("holding jump never repeats at touchdown and releasing permits a new jump", () => {
  const { walker } = outside("earth");
  step(walker, 3, { ...emptyInput(), brake: true });
  assert(walker.grounded);
  assert.equal(walker.speedMps, 0);
  walker.step(0.01, emptyInput());
  walker.step(0.01, { ...emptyInput(), brake: true });
  assert.equal(walker.grounded, false);
  assert(walker.velocity.dot(walker.outward) > 4.3);
});

test("low gravity changes horizontal acceleration, braking and airborne steering", () => {
  const earth = outside("earth").walker, moon = outside("moon").walker;
  for (const walker of [earth, moon]) step(walker, 0.1, { ...emptyInput(), throttle: 1 });
  assert(earth.speedMps > moon.speedMps * 1.6, "low gravity reduces available ground traction");
  for (const walker of [earth, moon]) step(walker, 1, { ...emptyInput(), throttle: 1 });
  const eBefore = earth.speedMps, mBefore = moon.speedMps;
  for (const walker of [earth, moon]) step(walker, 0.5);
  assert(moon.speedMps / mBefore > earth.speedMps / eBefore * 10, "Moon retains more sliding motion");
  const grounded = outside("moon").walker, airborne = outside("moon").walker;
  airborne.step(0.01, { ...emptyInput(), brake: true });
  for (const walker of [grounded, airborne]) step(walker, 0.2, { ...emptyInput(), strafe: 1 });
  const horizontalAir = airborne.velocity.clone().projectOnPlane(airborne.outward).length();
  assert(horizontalAir < grounded.speedMps * 0.2, "air steering cannot cancel inertia as quickly as grounded walking");
});

test("steep slopes block uphill walking and allow gravity-driven downhill motion", () => {
  let sample;
  const body = world.bodies.find(candidate => candidate.id === "naiad");
  for (let i = 0; i < 100 && !sample; i++) {
    const normal = new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * 0.7), Math.cos(i * 2.4)).normalize();
    const state = outside(body.id, normal);
    const up = state.walker.outward;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.walker.orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(state.walker.orientation);
    const radius = body.radius * world.unitsKm * 1000;
    const height = terrainHeightKm(body.id, up.toArray()) * 1000;
    const slope = direction => (terrainHeightKm(body.id, up.clone().multiplyScalar(radius)
      .addScaledVector(direction, 0.1).normalize().toArray()) * 1000 - height) / 0.1;
    const direction = forward.clone().multiplyScalar(slope(forward)).addScaledVector(right, slope(right)).normalize();
    if (slope(direction) > 2) sample = { ...state, direction };
  }
  assert(sample, "terrain includes a reproducible steep edge");
  const { ship, walker, direction } = sample;
  walker.orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, walker.outward));
  const initial = walker.offsetM.clone();
  step(walker, 0.5, { ...emptyInput(), throttle: 1 });
  assert(walker.offsetM.clone().sub(initial).dot(direction) < 0.001, "cannot climb a slope over 50 degrees");
  assert(walker.groundClearanceM >= -0.015, "slope collision prevents terrain penetration");
  walker.restore({ ...walker.snapshot(), orientation: new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), direction.clone().negate(), walker.outward)).toArray() }, ship);
  walker.step(0.01, { ...emptyInput(), throttle: 1 });
  assert.equal(walker.grounded, false, "walking off a steep edge must not snap feet downward to the new floor");
  step(walker, 0.2, { ...emptyInput(), throttle: 1 });
  assert(walker.groundClearanceM > 0);
  assert(walker.velocity.dot(walker.outward) < 0, "radial gravity pulls the airborne character down");
});

test("tiny-moon return assist prevents a jump from drifting away while reporting the moon's actual gravity", () => {
  const { walker } = outside("naiad");
  assert.equal(walker.gravity, 0.012);
  assert(walker.gravity < SUIT_MIN_FALL_ACCELERATION_MPS2);
  assert(walker.suitAssisted);
  walker.step(0.01, { ...emptyInput(), brake: true });
  let peak = 0;
  for (let i = 0; i < 3000 && !walker.grounded; i++) {
    walker.step(0.01, emptyInput());
    peak = Math.max(peak, walker.groundClearanceM);
  }
  assert(walker.grounded, "suit assist returns the character within 30 seconds");
  assert(peak > 20 && peak < 30, "assist caps practical jump height without changing the displayed astronomical gravity");
});

test("metre-scale walking stays precise on distant moons and frame subdivision prevents terrain penetration", () => {
  const { walker } = outside("nereid");
  const before = walker.offsetM.clone();
  walker.step(0.25, { ...emptyInput(), throttle: 1 });
  assert(walker.offsetM.distanceTo(before) > 0.01, "small movement must survive AU-scale coordinates");
  assertSupported(walker);
  for (let i = 0; i < 20; i++) walker.step(0.25, { ...emptyInput(), throttle: 1, yaw: 1, boost: true });
  assert(walker.groundClearanceM >= -0.015);
  assert(Math.abs(walker.groundClearanceM - walker.collisionGroundClearanceM) < 0.015);
  if (walker.grounded) assertSupported(walker);
  else assert(walker.velocity.dot(walker.outward) < 0, "low-gravity motion over an edge falls back toward the terrain");
  assert(walker.position.toArray().every(Number.isFinite));
  const offset = walker.offsetM.toArray();
  walker.step(Number.NaN, emptyInput());
  assert.deepEqual(walker.offsetM.toArray(), offset);
});

test("walking saves round-trip on ground and in air; pre-walking saves still restore inside the ship", () => {
  const { ship, walker } = outside("proxima-b");
  for (const airborne of [false, true]) {
    if (airborne) walker.step(0.05, { ...emptyInput(), brake: true });
    const saved = validateFlightState(save(ship, walker));
    assert(saved);
    assert(saved.walking);
    const restoredShip = new ShipDynamics();
    assert(restoredShip.restore(saved));
    const restored = new WalkingDynamics();
    restored.restore(saved.walking, restoredShip);
    assert(restored.active);
    assert.equal(restored.grounded, !airborne);
    assert(restored.offsetM.distanceTo(walker.offsetM) < 1e-7);
    assert(restored.velocity.distanceTo(walker.velocity) < 1e-10);
    assert(validateFlightState(save(restoredShip, restored)));
  }
  const restored = new WalkingDynamics();
  restored.restore(undefined, ship);
  assert.equal(restored.active, false);
  assert(validateFlightState(ship.snapshot()));
});

test("save validation rejects cross-body/system, unlanded, nonfinite, out-of-bounds and underground walking states", () => {
  const { ship, walker } = outside("earth");
  const base = save(ship, walker), state = base.walking;
  const invalid = [
    { ...base, landedBody: undefined },
    { ...base, systemId: "proxima-centauri" },
    { ...base, walking: { ...state, bodyId: "moon" } },
    { ...base, walking: { ...state, bodyId: "jupiter" } },
    { ...base, walking: { ...state, offsetM: [Infinity, 0, 0] } },
    { ...base, walking: { ...state, offsetM: [1e7, 0, 0] } },
    { ...base, walking: { ...state, velocityMps: [61, 0, 0] } },
    { ...base, walking: { ...state, orientation: [0, 0, 0, 0] } },
    { ...base, walking: { ...state, pitch: NaN } },
    { ...base, walking: { ...state, grounded: "true" } },
    { ...base, walking: { ...state, camera: "cockpit" } },
    { ...base, walking: { ...state, offsetM: walker.offsetM.clone().addScaledVector(walker.outward, -2).toArray() } },
    { ...base, walking: { ...state, offsetM: walker.offsetM.clone().addScaledVector(walker.outward, 2).toArray(), grounded: true } },
  ];
  for (const value of invalid) assert.equal(validateFlightState(value), null);
  const high = { ...base, walking: { ...state,
    offsetM: walker.offsetM.clone().addScaledVector(walker.outward, 100).toArray(), grounded: false } };
  assert(validateFlightState(high), "legitimate airborne saves remain valid");
  assert.equal(validateFlightState({ ...base, walking: { ...state, camera: "first" } }).walking.camera, "first");
  assert.equal(validateFlightState(base).walking.camera, undefined, "older walking saves do not gain an invented camera value");
});

test("surface profiles distinguish major-moon gravities and explicitly label exoplanet estimates", () => {
  assert.equal(surfaceProfile("io").gravity, 1.796);
  assert.equal(surfaceProfile("triton").gravity, 0.779);
  assert.equal(surfaceProfile("hyperion").gravity, 0.02);
  assert.equal(surfaceProfile("earth-station").solid, false);
  for (const id of ["proxima-b", "proxima-c", "proxima-d"]) assert(surfaceProfile(id).gravityEstimated);
  for (const body of world.bodies.filter(candidate => surfaceProfile(candidate.id).solid))
    assert(surfaceProfile(body.id).gravity > 0, body.id);
});
