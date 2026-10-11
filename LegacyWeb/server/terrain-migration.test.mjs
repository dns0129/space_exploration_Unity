import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { surfaceProfile, terrainHeightKm, legacyTerrainHeightKm, TERRAIN_VERSION, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { propulsionBand } from "../shared/propulsion.mjs";
import { WalkingDynamics, initializeWalkingPhysics } from "../src/walking-dynamics.ts";

await initializeWalkingPhysics();

const vector = value => new THREE.Vector3().fromArray(value);
const meters = world.unitsKm * 1000;

function historicalSave(body, { walking = false, airborne = false, oldLayout = false } = {}) {
  const center = vector(oldLayout ? body.previousPosition ?? body.position : body.position);
  const normal = new THREE.Vector3(0.4, 0.7, -0.5).normalize();
  const radius = body.radius * meters + (legacyTerrainHeightKm(body.id, normal.toArray()) + LANDING_CLEARANCE_KM) * 1000;
  const anchor = normal.clone().multiplyScalar(radius);
  const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal).toArray();
  const state = { version: 2, worldLayoutVersion: oldLayout ? 1 : world.layoutVersion,
    systemId: body.systemId ?? "solar", position: anchor.clone().divideScalar(meters).add(center).toArray(),
    velocity: [0, 0, 0], orientation, target: body.id, camera: "chase", assist: true, elapsed: 42,
    landedBody: body.id, atmosphericSpeedMps: 133, engineMode: "standard" };
  if (walking) {
    const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const feetNormal = anchor.clone().addScaledVector(tangent, 220).normalize();
    const floor = body.radius * meters + legacyTerrainHeightKm(body.id, feetNormal.toArray()) * 1000;
    const feet = feetNormal.clone().multiplyScalar(floor + (airborne ? 17 : 0));
    state.walking = { bodyId: body.id, offsetM: feet.sub(anchor).toArray(),
      velocityMps: airborne ? feetNormal.clone().multiplyScalar(4).toArray() : [0, 0, 0],
      orientation, pitch: 0.4, grounded: !airborne, camera: "first" };
  }
  return state;
}

function radialFeet(state, body) {
  return vector(state.position).sub(vector(body.position)).multiplyScalar(meters).add(vector(state.walking.offsetM));
}

test("historical landed and walking saves retain their surface location and clearance on the shared map height", () => {
  for (const body of world.bodies.filter(body => body.kind !== "station" && surfaceProfile(body.id).solid)) {
    for (const airborne of [false, true]) {
      const original = historicalSave(body, { walking: true, airborne });
      const snapshot = structuredClone(original);
      const migrated = validateFlightState(original);
      assert(migrated, `${body.id} valid historical save migrates`);
      assert.equal(migrated.terrainVersion, TERRAIN_VERSION);
      assert.equal(migrated.engineMode, propulsionBand(migrated.cruiseSpeedKm).id);
      assert.equal(migrated.lowFlightSpeedMps, 133);
      assert.deepEqual(original, snapshot, "normalization must not mutate the stored save");
      assert.deepEqual(validateFlightState(migrated), migrated, `${body.id} migration is idempotent`);
      const oldFeet = radialFeet(original, body), feet = radialFeet(migrated, body);
      const normal = feet.clone().normalize();
      const coordinateTolerance = Math.max(1e-9, Number.EPSILON * vector(body.position).length() * meters / feet.length() * 8);
      assert(oldFeet.normalize().distanceTo(normal) < coordinateTolerance, `${body.id} retains the walking location`);
      const clearance = feet.length() - body.radius * meters - terrainHeightKm(body.id, normal.toArray()) * 1000;
      assert(Math.abs(clearance - (airborne ? 17 : 0)) < 0.015, `${body.id} retains feet clearance`);
      assert.deepEqual(migrated.orientation, original.orientation);
      assert.deepEqual(migrated.walking.velocityMps, original.walking.velocityMps);
      assert.equal(migrated.walking.grounded, !airborne);
      assert.equal(migrated.walking.pitch, original.walking.pitch);
      assert.equal(migrated.walking.camera, "first");
      const ship = new ShipDynamics();
      assert(ship.restore(migrated), `${body.id} migrated ship restores`);
      assert.equal(ship.landingPhase, "landed");
      assert(ship.environment.groundAltitudeKm < 1e-6);
      const walker = new WalkingDynamics();
      walker.restore(migrated.walking, ship);
      assert(walker.active, `${body.id} migrated walker restores`);
      assert(Math.abs(walker.groundClearanceM - (airborne ? 17 : 0)) < 0.015);
    }
  }
});

test("orbital-layout and terrain migrations compose once without changing the old radial direction", () => {
  for (const id of ["mercury", "mars", "ceres", "io", "titan", "triton", "nereid"]) {
    const body = world.bodies.find(body => body.id === id);
    const original = historicalSave(body, { walking: true, oldLayout: true });
    delete original.worldLayoutVersion;
    const migrated = validateFlightState(original);
    assert(migrated, id);
    assert.equal(migrated.worldLayoutVersion, world.layoutVersion);
    assert.equal(migrated.terrainVersion, TERRAIN_VERSION);
    const oldDirection = vector(original.position).sub(vector(body.previousPosition ?? body.position)).normalize();
    const direction = vector(migrated.position).sub(vector(body.position)).normalize();
    assert(oldDirection.distanceTo(direction) < 1e-9, `${id} keeps its landing latitude and longitude`);
    assert.deepEqual(validateFlightState(migrated), migrated);
  }
});

test("terrain migration only accepts a valid old floor and rejects damaged old walking state", () => {
  const body = world.bodies.find(body => body.id === "earth");
  const original = { ...historicalSave(body, { walking: true }), terrainVersion: 1 };
  assert(validateFlightState(original));
  const damagedAnchor = structuredClone(original);
  const normal = vector(original.position).sub(vector(body.position)).normalize();
  damagedAnchor.position = vector(damagedAnchor.position).addScaledVector(normal, 1 / meters).toArray();
  assert.equal(validateFlightState(damagedAnchor), null, "a one-metre invalid old anchor must not be snapped to valid ground");
  const buriedWalker = structuredClone(original);
  const feetNormal = radialFeet(original, body).normalize();
  buriedWalker.walking.offsetM = vector(buriedWalker.walking.offsetM).addScaledVector(feetNormal, -1).toArray();
  assert.equal(validateFlightState(buriedWalker), null, "an invalid old character remains invalid");
  const current = validateFlightState(original);
  assert(Math.abs(vector(current.position).distanceTo(vector(original.position)) * meters) > 1,
    "this fixture actually exercises a changed elevation");
  assert.equal(validateFlightState({ ...original, terrainVersion: TERRAIN_VERSION }), null,
    "a marked current save must not silently accept a historical floor");
  for (const terrainVersion of [0, -1, TERRAIN_VERSION + 1, null, "1"])
    assert.equal(validateFlightState({ ...original, terrainVersion }), null);
});

test("unmarked saves already at the current floor normalize without moving the ship or walker", () => {
  const body = world.bodies.find(body => body.id === "mars");
  const current = validateFlightState(historicalSave(body, { walking: true }));
  const unmarked = structuredClone(current);
  delete unmarked.terrainVersion;
  const normalized = validateFlightState(unmarked);
  assert.deepEqual(normalized.position, current.position);
  assert.deepEqual(normalized.walking, current.walking);
  assert.equal(normalized.terrainVersion, TERRAIN_VERSION);
  const ship = new ShipDynamics();
  assert.equal(ship.snapshot().terrainVersion, TERRAIN_VERSION);
});

test("swept physical contact follows a mapped mountain above the old 125-metre envelope", () => {
  const body = world.bodies.find(body => body.id === "moon");
  let normal, peak = -Infinity;
  for (let latitude = -75; latitude <= 75; latitude += 15) for (let longitude = 0; longitude < 360; longitude += 15) {
    const angle = longitude * Math.PI / 180, elevation = latitude * Math.PI / 180;
    const candidate = new THREE.Vector3(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation));
    const height = terrainHeightKm(body.id, candidate.toArray());
    if (height > peak) { peak = height; normal = candidate; }
  }
  assert(peak > 0.125, "this fixture must exceed the obsolete terrain envelope");
  const ship = new ShipDynamics();
  ship.jump(body.id);
  ship.assist = false;
  ship.setCruiseSpeed(100);
  ship.position.fromArray(body.position).addScaledVector(normal,
    body.radius + (peak + LANDING_CLEARANCE_KM + 0.025) / world.unitsKm);
  ship.velocity.copy(normal).multiplyScalar(-1 / world.unitsKm);
  ship.step(0.05, emptyInput());
  assert.equal(ship.collision, body.id, "physical contact must include terrain above the obsolete envelope");
  assert(ship.environment.groundAltitudeKm < 0.001, "contact stops at the mapped mountain surface");
  assert.equal(ship.velocity.length(), 0);
});
