import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { surfaceRadiusM, sampleSurface, SpatialScale } from "../shared/spatial-frame.mjs";
import { WalkingPhysics, initializeWalkingPhysics } from "../src/walking-physics.ts";
import { WalkingDynamics } from "../src/walking-dynamics.ts";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { terrainHeightKm, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";

await initializeWalkingPhysics();

function landed(id) {
  const ship = new ShipDynamics();
  ship.jump(id);
  const body = world.bodies.find(candidate => candidate.id === id);
  const up = new THREE.Vector3(0, 0, -1);
  ship.position.fromArray(body.position).addScaledVector(up,
    body.radius + (terrainHeightKm(id, up.toArray()) + LANDING_CLEARANCE_KM) / world.unitsKm);
  assert.equal(ship.startLanding(), null);
  ship.step(0.05, emptyInput());
  assert.equal(ship.landingPhase, "landed");
  return ship;
}

test("Rapier terrain vertices and rendered patch share metres; swept capsule cannot tunnel through the ground", () => {
  const body = world.bodies.find(candidate => candidate.id === "moon");
  const up = new THREE.Vector3(0.4, 0.7, -0.5).normalize();
  const radial = up.clone().multiplyScalar(surfaceRadiusM(world, body, up.toArray()));
  const physics = new WalkingPhysics(world, body.id);
  try {
    physics.ensureTerrain(radial, radial, true);
    const patch = physics.terrainPatch;
    assert(patch.vertices.every(Number.isFinite));
    assert(patch.vertices.length > 1000);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < patch.indices.length; i += 3) {
      a.fromArray(patch.vertices, patch.indices[i] * 3);
      b.fromArray(patch.vertices, patch.indices[i + 1] * 3);
      c.fromArray(patch.vertices, patch.indices[i + 2] * 3);
      assert(b.sub(a).cross(c.sub(a)).dot(patch.centerRadialM) > 0,
        "terrain triangles face away from the body center for visible rendering and collision normals");
    }
    assert(Math.abs(physics.groundDistanceM(new THREE.Vector3(), up)) < 0.002);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const feet = up.clone().multiplyScalar(10);
    const result = physics.move(feet, up, orientation, up.clone().multiplyScalar(-100), 1 / 120);
    feet.add(result.movement);
    assert(result.grounded);
    assert(physics.collisionCount > 0, "motion is resolved by Rapier, not a radial floor clamp");
    assert(physics.groundDistanceM(feet, up) >= -0.002);
    assert(feet.dot(up) < 0.2);
  } finally { physics.dispose(); }
});

test("floating origin translates every rigid body and standalone collider without changing distances, rotations or velocities", () => {
  const body = world.bodies.find(candidate => candidate.id === "earth");
  const up = new THREE.Vector3(0, 0, -1);
  const radial = up.clone().multiplyScalar(surfaceRadiusM(world, body, up.toArray()));
  const physics = new WalkingPhysics(world, body.id);
  try {
    physics.ensureTerrain(radial, radial, true);
    physics.setFeet(new THREE.Vector3(2, 0, 3), up, new THREE.Quaternion());
    const dynamic = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(7, 4, 9));
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.5), dynamic);
    dynamic.setLinvel({ x: 1.25, y: 2.5, z: -3 }, false);
    dynamic.setAngvel({ x: 0.1, y: 0.2, z: 0.3 }, false);
    const obstacle = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(14, 6, 4));
    const poses = [];
    physics.world.forEachRigidBody(candidate => poses.push({ body: candidate,
      position: { ...candidate.translation() }, rotation: { ...candidate.rotation() },
      linear: { ...candidate.linvel() }, angular: { ...candidate.angvel() } }));
    const obstaclePosition = { ...obstacle.translation() };
    const initialDistance = new THREE.Vector3().copy(physics.character.translation()).distanceTo(dynamic.translation());
    const initialGround = physics.groundDistanceM(new THREE.Vector3(), up);
    const revision = physics.terrainPatch.revision;
    const shift = new THREE.Vector3(300, -120, 90);
    physics.shiftOrigin(shift);
    for (const pose of poses) {
      const expected = new THREE.Vector3().copy(pose.position).sub(shift);
      assert(expected.distanceTo(pose.body.translation()) < 0.0001);
      assert.deepEqual({ ...pose.body.rotation() }, pose.rotation);
      assert.deepEqual({ ...pose.body.linvel() }, pose.linear);
      assert.deepEqual({ ...pose.body.angvel() }, pose.angular);
    }
    assert(new THREE.Vector3().copy(obstaclePosition).sub(shift).distanceTo(obstacle.translation()) < 0.0001);
    assert(Math.abs(new THREE.Vector3().copy(physics.character.translation()).distanceTo(dynamic.translation()) - initialDistance) < 0.0001);
    assert(Math.abs(physics.groundDistanceM(shift.clone().negate(), up) - initialGround) < 0.0001);
    assert(physics.terrainPatch.revision > revision);
    physics.world.forEachCollider(candidate => {
      if (candidate.shapeType() !== RAPIER.ShapeType.TriMesh) return;
      const colliderVertices = candidate.vertices(), origin = candidate.translation();
      const renderVertices = physics.terrainPatch.vertices;
      const colliderIndices = candidate.indices(), renderIndices = physics.terrainPatch.indices;
      for (let j = 0; j < colliderIndices.length; j++) {
        // Rapier may merge/reorder vertices while retaining triangle topology.
        const i = colliderIndices[j] * 3, r = renderIndices[j] * 3;
        assert(Math.abs(colliderVertices[i] + origin.x - renderVertices[r]) < 0.0001);
        assert(Math.abs(colliderVertices[i + 1] + origin.y - renderVertices[r + 1]) < 0.0001);
        assert(Math.abs(colliderVertices[i + 2] + origin.z - renderVertices[r + 2]) < 0.0001);
      }
    });
  } finally { physics.dispose(); }
});

test("repeated walking rebases keep metre motion and save restoration independent of the temporary origin", () => {
  const ship = landed("earth");
  const walker = new WalkingDynamics();
  assert.equal(walker.disembark(ship), null);
  // Lower the production 256 m threshold to cross it repeatedly in a bounded test.
  walker.localFrame.rebaseDistanceM = 12;
  let previousOffset = walker.offsetM.clone();
  let previousRevision = walker.rebaseRevision;
  for (let i = 0; i < 600; i++) {
    const oldVelocity = walker.velocity.clone();
    walker.step(0.02, { ...emptyInput(), throttle: 1, boost: true });
    assert(walker.offsetM.distanceTo(previousOffset) < 0.13, "rebase cannot create a visible movement jump");
    assert(walker.groundClearanceM >= -0.015);
    if (walker.rebaseRevision !== previousRevision) {
      assert(walker.localPositionM.length() < 0.13);
      assert(walker.velocity.distanceTo(oldVelocity) < 0.2, "rebase does not inject an impulse");
    }
    assert(walker.localPositionM.clone().sub(walker.localShipPositionM).distanceTo(walker.offsetM) < 1e-7);
    previousOffset.copy(walker.offsetM);
    previousRevision = walker.rebaseRevision;
  }
  assert(walker.rebaseRevision >= 3);
  const state = walker.snapshot();
  assert(!("localOriginOffsetM" in state));
  const restored = new WalkingDynamics();
  restored.restore(state, ship);
  assert(restored.active);
  assert(restored.offsetM.distanceTo(walker.offsetM) < 1e-7);
  assert(restored.velocity.distanceTo(walker.velocity) < 1e-7);
  assert(restored.localPositionM.clone().sub(restored.localShipPositionM).distanceTo(walker.offsetM) < 1e-7);
  assert(restored.position.distanceTo(walker.position) * new SpatialScale(world.unitsKm).metersPerUniverseUnit < 0.001);
  walker.reset(); restored.reset();
});

test("migrated Triton walking saves have a finite mesh ground sample on the restore frame without taking a step", () => {
  const oldWorld = structuredClone(world);
  oldWorld.layoutVersion = 1;
  for (const body of oldWorld.bodies) body.position = [...(body.previousPosition ?? body.position)];
  const body = oldWorld.bodies.find(candidate => candidate.id === "triton");
  const normal = new THREE.Vector3(0.4, 0.7, -0.5).normalize();
  const ship = new ShipDynamics(oldWorld);
  ship.jump(body.id);
  ship.position.fromArray(body.position).addScaledVector(normal,
    body.radius + (terrainHeightKm(body.id, normal.toArray()) + LANDING_CLEARANCE_KM) / oldWorld.unitsKm);
  assert.equal(ship.startLanding(), null);
  ship.step(0.05, emptyInput());
  const walker = new WalkingDynamics(oldWorld);
  assert.equal(walker.disembark(ship), null);
  for (let i = 0; i < 20; i++) walker.step(0.05, { ...emptyInput(), throttle: 1, strafe: 0.3 });
  const old = { ...ship.snapshot(), walking: walker.snapshot() };
  delete old.worldLayoutVersion;
  const saved = validateFlightState(old);
  assert(saved);
  const restoredShip = new ShipDynamics();
  assert(restoredShip.restore(saved));
  const restored = new WalkingDynamics();
  restored.restore(saved.walking, restoredShip);
  assert(restored.active);
  assert(Number.isFinite(restored.collisionGroundClearanceM), "an exact shared mesh vertex must not hide the ground");
  assert(Math.abs(restored.collisionGroundClearanceM - restored.groundClearanceM) < 0.0001);
  assert.deepEqual(restored.snapshot().offsetM, saved.walking.offsetM);
  assert.deepEqual(restored.snapshot().velocityMps, saved.walking.velocityMps);
  assert.equal(restored.grounded, saved.walking.grounded);
  walker.reset(); restored.reset();
});

test("100 km and 700 km walking restores generate local collision vertices only after rebasing", () => {
  const ship = landed("earth"), body = world.bodies.find(candidate => candidate.id === "earth");
  const anchor = ship.bodyRadialM;
  for (const distance of [100000, 700000]) {
    const radial = anchor.clone().add(new THREE.Vector3(distance, 0, 0));
    radial.fromArray(sampleSurface(world, body, radial.toArray()).surfaceRadialM);
    const normal = radial.clone().normalize();
    const state = { bodyId: body.id, offsetM: radial.clone().sub(anchor).toArray(), velocityMps: [0, 0, 0],
      orientation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal).toArray(),
      pitch: 0, grounded: true };
    assert(validateFlightState({ ...ship.snapshot(), walking: state }));
    const restored = new WalkingDynamics();
    restored.restore(state, ship);
    assert(restored.active);
    assert(restored.localPositionM.length() < 0.000001);
    assert(restored.terrainPatch.vertices.every(value => Math.abs(value) < 100), "astronomical or ship-relative offsets never enter Float32 geometry");
    assert(Math.abs(restored.collisionGroundClearanceM - restored.groundClearanceM) < 0.0001,
      `${distance} m restore preserves sub-millimetre collision height on the first frame`);
    assert.deepEqual(restored.snapshot().offsetM, state.offsetM);
    assert.deepEqual(restored.snapshot().velocityMps, state.velocityMps);
    assert.equal(restored.grounded, state.grounded);
    restored.reset();
  }
});

function slopeCameraScene() {
  const body = world.bodies.find(candidate => candidate.id === "naiad");
  const up = new THREE.Vector3(Math.sin(4.8), Math.cos(1.4), Math.cos(4.8)).normalize();
  const radial = up.clone().multiplyScalar(surfaceRadiusM(world, body, up.toArray()));
  const physics = new WalkingPhysics(world, body.id);
  physics.ensureTerrain(radial, radial, true);
  const patch = physics.terrainPatch, side = Math.sqrt(patch.vertices.length / 3);
  const center = ((side - 1) / 2 * side + (side - 1) / 2) * 3;
  const slope = offset => new THREE.Vector3().fromArray(patch.vertices, center + offset)
    .sub(new THREE.Vector3().fromArray(patch.vertices, center - offset)).dot(up);
  const gradient = patch.right.clone().multiplyScalar(slope(3)).addScaledVector(patch.forward, slope(side * 3));
  assert(gradient.length() > 2, "fixture has an actual steep triangle mesh, rather than an analytic camera floor");
  const eye = up.clone().multiplyScalar(1.65);
  const target = eye.clone().addScaledVector(gradient.normalize(), 5).addScaledVector(up, 0.7);
  return { physics, eye, target, up };
}

test("camera sphere and boom retract before real sloping terrain and queries never step or change physical state", () => {
  const { physics, eye, target } = slopeCameraScene();
  try {
    const beforeEye = eye.toArray(), beforeTarget = target.toArray();
    const beforeWorld = physics.world.takeSnapshot(), beforeTimestep = physics.world.timestep;
    physics.world.step = () => { throw new Error("camera queries must not advance the physics world"); };
    const safe = physics.constrainCamera(eye, target);
    const boom = target.clone().sub(eye), safeBoom = safe.clone().sub(eye);
    assert(safeBoom.length() > 0.1 && safeBoom.length() < boom.length() - 1);
    assert(safeBoom.clone().cross(boom).length() < 0.00001, "retraction follows the eye-to-camera boom");
    let terrain;
    physics.world.forEachCollider(candidate => { if (candidate.shapeType() === RAPIER.ShapeType.TriMesh) terrain = candidate; });
    const closest = terrain.projectPoint(safe, false);
    assert(safe.distanceTo(closest.point) >= 0.219, "the camera sphere keeps a real mesh contact gap");
    assert.equal(physics.world.intersectionWithShape(safe, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(0.2),
      undefined, undefined, physics.collider), null);
    const clearBoom = physics.world.castShape(eye, { x: 0, y: 0, z: 0, w: 1 }, safeBoom,
      new RAPIER.Ball(0.2), 0, 1, true, undefined, undefined, physics.collider);
    assert.equal(clearBoom, null, "the complete camera boom stays outside terrain, not only its endpoint");
    assert.deepEqual(eye.toArray(), beforeEye);
    assert.deepEqual(target.toArray(), beforeTarget);
    assert.equal(physics.world.timestep, beforeTimestep);
    assert.deepEqual(physics.world.takeSnapshot(), beforeWorld, "pure scene queries preserve rigid-body pose and velocities");
  } finally { physics.dispose(); }
});

test("unobstructed camera targets remain exact, the suit is ignored, and zero-length near-ground cameras use the mesh", () => {
  const body = world.bodies.find(candidate => candidate.id === "earth"), up = new THREE.Vector3(0, 0, -1);
  const radial = up.clone().multiplyScalar(surfaceRadiusM(world, body, up.toArray()));
  const physics = new WalkingPhysics(world, body.id);
  try {
    physics.ensureTerrain(radial, radial, true);
    physics.setFeet(new THREE.Vector3(), up,
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));
    const eye = up.clone().multiplyScalar(1.65), target = eye.clone().add(new THREE.Vector3(5, 0, 0)).addScaledVector(up, 0.7);
    assert.deepEqual(physics.constrainCamera(eye, target).toArray(), target.toArray());
    assert.deepEqual(physics.constrainCamera(eye, eye).toArray(), eye.toArray(), "a first-person camera ignores its own capsule");
    const touching = up.clone().multiplyScalar(0.1);
    const repaired = physics.constrainCamera(touching, touching);
    assert(repaired.dot(up) >= 0.219 && repaired.dot(up) < 0.23,
      "a sphere initially intersecting ground is separated by actual mesh contact, without moving the player");
  } finally { physics.dispose(); }
});

test("camera collision results remain continuous across a floating-origin shift without stepping gameplay", () => {
  const { physics, eye, target } = slopeCameraScene();
  try {
    const before = physics.constrainCamera(eye, target);
    const shift = new THREE.Vector3(300, -120, 90);
    physics.shiftOrigin(shift);
    const afterWorld = physics.world.takeSnapshot();
    physics.world.step = () => { throw new Error("rebased camera queries must not step the world"); };
    const after = physics.constrainCamera(eye.clone().sub(shift), target.clone().sub(shift));
    assert(after.clone().add(shift).distanceTo(before) < 0.0001,
      "the same visible camera point survives a rebase within 0.1 mm");
    assert.deepEqual(physics.world.takeSnapshot(), afterWorld);
  } finally { physics.dispose(); }
});

test("walking camera wrapper queries restored Rapier terrain on the restore frame and preserves saved motion", () => {
  const ship = landed("earth"), walker = new WalkingDynamics();
  assert.equal(walker.disembark(ship), null);
  walker.step(0.02, { ...emptyInput(), brake: true, throttle: 1 });
  const state = walker.snapshot(), restored = new WalkingDynamics();
  restored.restore(state, ship);
  try {
    assert(restored.active && !restored.grounded);
    const eye = restored.localPositionM.clone().addScaledVector(restored.outward, 1.65);
    const target = restored.localPositionM.clone().addScaledVector(restored.outward, -3)
      .addScaledVector(restored.terrainPatch.right, 4);
    const before = restored.snapshot(), shipBefore = ship.snapshot(), frameBefore = restored.localFrame.revision;
    const safe = restored.constrainCamera(eye, target);
    assert(safe.distanceTo(target) > 1, "restored terrain blocks the camera before the first walking step");
    assert(safe.distanceTo(eye) > 0.1);
    assert.deepEqual(restored.snapshot(), before);
    assert.deepEqual(ship.snapshot(), shipBefore);
    assert.equal(restored.localFrame.revision, frameBefore);
    assert.deepEqual(before.offsetM, state.offsetM);
    assert.deepEqual(before.velocityMps, state.velocityMps);
  } finally { walker.reset(); restored.reset(); }
});
