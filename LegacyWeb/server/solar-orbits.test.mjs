import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { orbitPosition } from "../shared/solar-orbits.mjs";
import { world, validateFlightState, WALKING_GROUNDED_CLEARANCE_M } from "../shared/flight-state.mjs";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import moons from "../shared/moons.json" with { type: "json" };
import { createAsteroidBelt } from "../src/orbital-structures.ts";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics, initializeWalkingPhysics } from "../src/walking-dynamics.ts";

await initializeWalkingPhysics();

// J2000 mean ecliptic references, independently fixed here to catch data drift.
const references = {
  mercury: [7.00487, 48.33167], venus: [3.39471, 76.68069], earth: [0, 0],
  mars: [1.85061, 49.57854], jupiter: [1.30530, 100.55615], saturn: [2.48446, 113.71504],
  uranus: [0.76986, 74.22988], neptune: [1.76917, 131.72169], ceres: [10.594, 80.305],
};
const radians = Math.PI / 180;
const bodyById = id => world.bodies.find(body => body.id === id);
const vec = position => new THREE.Vector3().fromArray(position);
const closeVector = (actual, expected, message, tolerance = 1e-8) =>
  assert(vec(actual).distanceTo(vec(expected)) < tolerance, message);
const stateAt = (position, target = "earth", extra = {}) => ({
  version: 2, systemId: "solar", position, velocity: [0, 0, 0],
  orientation: [0, 0, 0, 1], target, camera: "cockpit", assist: true, elapsed: 42,
  ...extra,
});
const oldWorld = structuredClone(world);
oldWorld.layoutVersion = 1;
for (const body of oldWorld.bodies) body.position = [...(body.previousPosition ?? body.position)];

test("orbit samples cross the ascending node northwards and recover the reference plane tilt", () => {
  for (const [id, [inclination, node]] of Object.entries(references)) {
    const radius = 17;
    const atNode = vec(orbitPosition(radius, node, inclination, node));
    closeVector(atNode.toArray(), [radius * Math.cos(node * radians), 0, radius * Math.sin(node * radians)], id);
    const opposite = vec(orbitPosition(radius, node + 180, inclination, node));
    closeVector(opposite.toArray(), atNode.clone().negate().toArray(), `${id} opposite node`);
    const northmost = vec(orbitPosition(radius, node + 90, inclination, node));
    const normal = atNode.clone().cross(northmost).normalize();
    const measuredTilt = Math.acos(Math.min(1, Math.abs(normal.y))) / radians;
    assert(Math.abs(measuredTilt - inclination) < 1e-9, `${id} measured orbital plane tilt`);
    assert(Math.abs(northmost.y / radius - Math.sin(inclination * radians)) < 1e-12);
    if (inclination) {
      assert(orbitPosition(radius, node - 0.1, inclination, node)[1] < 0, `${id} below before node`);
      assert(orbitPosition(radius, node + 0.1, inclination, node)[1] > 0, `${id} above after node`);
    }
    for (const longitude of [-400, -90, 0, 35, 145, 360, 721]) {
      const position = vec(orbitPosition(radius, longitude, inclination, node));
      assert(Math.abs(position.length() - radius) < 1e-12, `${id} radius`);
      assert(Math.abs(position.dot(normal)) < 1e-12, `${id} lies in one plane`);
    }
  }
});

test("world planets retain their heliocentric radii and occupy the specified distinct orbital planes", () => {
  assert.equal(world.layoutVersion, 3);
  for (const [id, [inclination, node]] of Object.entries(references)) {
    const body = bodyById(id);
    assert.equal(body.orbit.inclinationDeg, inclination, `${id} reference inclination`);
    assert.equal(body.orbit.ascendingNodeDeg, node, `${id} reference ascending node`);
    const position = vec(body.position), previous = vec(body.previousPosition ?? body.position);
    assert(Math.abs(position.length() - previous.length()) < 1e-8, `${id} original mean distance`);
    const upwardNormal = new THREE.Vector3(
      Math.sin(node * radians) * Math.sin(inclination * radians),
      Math.cos(inclination * radians),
      -Math.cos(node * radians) * Math.sin(inclination * radians),
    );
    assert(Math.abs(position.clone().normalize().dot(upwardNormal)) < 1e-12, `${id} reference orbit plane`);
    if (inclination) assert(Math.abs(position.y) > 100, `${id} visible physical departure from ecliptic`);
    else assert.equal(position.y, 0, "Earth defines the ecliptic reference");
  }
  const earth = vec(bodyById("earth").position).normalize();
  const mercury = vec(bodyById("mercury").position).normalize();
  const venus = vec(bodyById("venus").position).normalize();
  assert(Math.abs(earth.dot(mercury.cross(venus))) > 0.01, "planets do not all share a plane through the Sun");
});

test("moving parent planets preserves every satellite's local offset and station has its sunlit 2400 km orbit", () => {
  for (const moon of moons) {
    const body = bodyById(moon.id), parent = bodyById(moon.parentId);
    const offset = vec(body.position).sub(vec(parent.position));
    const previous = vec(body.previousPosition ?? body.position).sub(vec(parent.previousPosition ?? parent.position));
    closeVector(offset.toArray(), previous.toArray(), `${moon.id} local orbital offset`);
    assert(Math.abs(offset.length() * world.unitsKm - moon.orbitRadiusKm) < 1e-5, `${moon.id} orbital radius`);
    if (parent.previousPosition) assert(body.previousPosition, `${moon.id} carries a migration anchor`);
  }
  const earth = bodyById("earth"), station = bodyById("earth-station");
  assert(Math.abs((vec(station.position).distanceTo(vec(earth.position)) - earth.radius) * world.unitsKm - 2400) < 1e-5);
});

test("belt spans independent orbital planes while keeping the main belt bounds and Kirkwood gaps", () => {
  const ceres = bodyById("ceres"), belt = createAsteroidBelt(world.unitsKm, world.auKm);
  const positions = belt.children[0].geometry.getAttribute("position");
  let north = 0, south = 0, beyondFiveDegrees = 0, beyondFifteenDegrees = 0, crossingGap = 0;
  try {
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const radius = Math.hypot(x, y, z), au = radius * world.unitsKm / world.auKm;
      const { semimajorAxes, eccentricities } = belt.children[0].geometry.userData.orbits;
      const a = semimajorAxes[i], e = eccentricities[i];
      assert(a >= 2.1 && a <= 3.3);
      assert(e >= 0.03 && e <= 0.28);
      assert(au >= a * (1 - e) - 1e-6 && au <= a * (1 + e) + 1e-6, "elliptical radial bounds");
      for (const [gap, width] of [[2.5, 0.025], [2.82, 0.018], [2.96, 0.014], [3.27, 0.025]])
        assert(Math.abs(a - gap) >= width - 1e-6, `semimajor-axis Kirkwood gap at ${gap} AU`);
      if (Math.abs(au - 2.5) < 0.025) crossingGap++;
      const latitude = Math.asin(Math.abs(y) / radius) / radians;
      assert(latitude <= 30.001, "sparse high-inclination particles remain bounded");
      if (y > 0) north++; else if (y < 0) south++;
      if (latitude > 5) beyondFiveDegrees++;
      if (latitude > 15) beyondFifteenDegrees++;
    }
    assert(north > positions.count * 0.35 && south > positions.count * 0.35, "both sides of the ecliptic are populated");
    assert(beyondFiveDegrees > positions.count * 0.2, "belt is a three-dimensional distribution");
    assert(beyondFifteenDegrees > positions.count * 0.002 && beyondFifteenDegrees < positions.count * 0.05, "high latitudes form a sparse tail");
    assert(crossingGap > 100, "eccentric orbits cross resonance radii without artificial empty rings");
    assert.equal(belt.children.length, 1, "no local swarm around Ceres");
  } finally {
    for (const object of belt.children) {
      object.geometry.dispose();
      object.material.dispose();
    }
  }
});

test("old local flight saves migrate around their nearest body independently of the navigation target", () => {
  const normal = new THREE.Vector3(0.4, 0.7, -0.5).normalize();
  for (const body of world.bodies.filter(candidate => candidate.previousPosition && candidate.kind !== "station")) {
    const offset = normal.clone().multiplyScalar(body.radius + 2000 / world.unitsKm);
    const oldPosition = vec(body.previousPosition).add(offset).toArray();
    for (const layoutMarker of [undefined, 1]) {
      const input = stateAt(oldPosition, "proxima-b", {
        velocity: [0.02, -0.01, 0.03],
        ...(layoutMarker ? { worldLayoutVersion: layoutMarker } : {}),
      });
      const original = structuredClone(input), migrated = validateFlightState(input);
      assert(migrated, `${body.id} old local save is valid`);
      assert.equal(migrated.worldLayoutVersion, 3);
      closeVector(migrated.position, vec(body.position).add(offset).toArray(), `${body.id} preserves ship offset`);
      assert.deepEqual(migrated.velocity, input.velocity);
      assert.deepEqual(migrated.orientation, input.orientation);
      assert.equal(migrated.target, "proxima-b");
      assert.deepEqual(input, original, "validation leaves the source save intact");
      assert.deepEqual(validateFlightState(migrated), migrated, `${body.id} migration is idempotent`);
    }
  }
});

function oldSurfaceSave(id, walking) {
  const ship = new ShipDynamics(oldWorld), body = oldWorld.bodies.find(candidate => candidate.id === id);
  ship.jump(id);
  const normal = new THREE.Vector3(0.4, 0.7, -0.5).normalize();
  const height = terrainHeightKm(id, normal.toArray()) + LANDING_CLEARANCE_KM;
  ship.position.fromArray(body.position).addScaledVector(normal, body.radius + height / world.unitsKm);
  assert.equal(ship.startLanding(), null, `${id} lands in the old layout`);
  ship.step(0.05, emptyInput());
  assert.equal(ship.landingPhase, "landed");
  if (!walking) return ship.snapshot();
  const walker = new WalkingDynamics(oldWorld);
  assert.equal(walker.disembark(ship), null);
  for (let i = 0; i < 20; i++) walker.step(0.05, { ...emptyInput(), throttle: 1, strafe: 0.3 });
  assert(walker.distanceToShipM > 10, "old walking save contains a real local character offset");
  return { ...ship.snapshot(), walking: { ...walker.snapshot(), camera: "first" } };
}

test("old landed and walking saves restore on moved terrain without changing local poses or migrating twice", () => {
  for (const id of ["mercury", "venus", "mars", "ceres", "io", "titan", "titania", "triton", "nereid"]) {
    const body = bodyById(id);
    for (const walking of [false, true]) {
      const old = oldSurfaceSave(id, walking);
      delete old.worldLayoutVersion; // Historical version 2 saves did not carry this field.
      const saved = validateFlightState(old);
      assert(saved, `${id} ${walking ? "walking" : "landed"} save survives layout migration`);
      closeVector(vec(saved.position).sub(vec(body.position)).toArray(),
        vec(old.position).sub(vec(body.previousPosition)).toArray(), `${id} unchanged surface anchor`);
      assert.equal(saved.landedBody, id);
      assert.deepEqual(saved.walking, old.walking, `${id} retains metre-scale walker state`);
      assert.deepEqual(validateFlightState(saved), saved, `${id} idempotent surface migration`);
      const restored = new ShipDynamics();
      assert(restored.restore(saved), `${id} migrated flight restores`);
      assert.equal(restored.landingPhase, "landed");
      assert.equal(restored.environment.body.id, id);
      assert(restored.environment.groundAltitudeKm < 1e-6);
      closeVector(restored.position.toArray(), saved.position, `${id} restore retains the migrated anchor`);
      if (walking) {
        const walker = new WalkingDynamics();
        walker.restore(saved.walking, restored);
        assert(walker.active, `${id} migrated walker restores`);
        closeVector(walker.offsetM.toArray(), old.walking.offsetM, `${id} walking local offset`, 1e-7);
        assert(walker.groundClearanceM >= -0.015 && walker.groundClearanceM <= WALKING_GROUNDED_CLEARANCE_M,
          `${id} rounded capsule remains above the analytic terrain within its slope contact allowance`);
        assert(walker.collisionGroundClearanceM >= -0.015
          && walker.collisionGroundClearanceM <= WALKING_GROUNDED_CLEARANCE_M,
        `${id} restored feet remain supported above the actual Rapier terrain`);
        assert.equal(walker.grounded, saved.walking.grounded, `${id} restore retains ground contact state`);
      }
    }
  }
});

test("deep-space, unchanged systems and saves already using the new layout keep their absolute coordinates", () => {
  for (const position of [[1e6, 7e5, -3e5], [0, 0, 0], [1e9, -1e9, 1e9]]) {
    const old = stateAt(position, "neptune"), normalized = validateFlightState(old);
    assert(normalized);
    assert.deepEqual(normalized.position, position, "deep-space coordinates do not follow any moved body");
    assert.deepEqual(validateFlightState(normalized), normalized);
  }
  const proxima = bodyById("proxima-b");
  const exoplanetPosition = vec(proxima.position).add(new THREE.Vector3(0, 0, 3)).toArray();
  assert.deepEqual(validateFlightState(stateAt(exoplanetPosition, "proxima-b", { systemId: "proxima-centauri" })).position, exoplanetPosition);
  for (const body of world.bodies.filter(candidate => candidate.previousPosition)) {
    const currentPosition = vec(body.position).add(new THREE.Vector3(0, body.radius + 3000 / world.unitsKm, 0)).toArray();
    const unmarkedCurrent = validateFlightState(stateAt(currentPosition));
    assert.deepEqual(unmarkedCurrent.position, currentPosition, `${body.id} current local coordinates win over the old anchor`);
    const markedOldPosition = stateAt([...body.previousPosition], "earth", { worldLayoutVersion: world.layoutVersion });
    assert.deepEqual(validateFlightState(markedOldPosition).position, body.previousPosition, `${body.id} explicit new layout does not migrate`);
  }
  const snapshot = new ShipDynamics().snapshot();
  assert.equal(snapshot.worldLayoutVersion, 3, "fresh gameplay saves identify their layout");
  assert.deepEqual(validateFlightState(snapshot).position, snapshot.position);
  for (const marker of [0, -1, 4, "2", null])
    assert.equal(validateFlightState(stateAt([1e6, 0, 0], "earth", { worldLayoutVersion: marker })), null, "invalid layout markers are rejected");
});
