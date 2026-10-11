import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FloatingOriginFrame, SpatialScale, sampleSurface, surfaceRadiusM } from '../shared/spatial-frame.mjs';
import { world, validateFlightState } from '../shared/flight-state.mjs';
import { terrainHeightKm } from '../shared/surface.mjs';
import { ShipDynamics, emptyInput } from '../src/ship-dynamics.ts';

const scale = new SpatialScale(world.unitsKm);
const close = (actual, expected, epsilon = 1e-8) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert(Math.abs(actual[i] - expected[i]) <= epsilon,
    `component ${i}: ${actual[i]} != ${expected[i]} (tolerance ${epsilon})`);
};

test('central scale and the canonical metre surface agree with the shipped terrain', () => {
  assert.equal(scale.metresPerUnit, world.unitsKm * 1000);
  for (const id of ['earth', 'moon', 'mars', 'triton', 'echo-thalassa']) {
    const body = world.bodies.find(candidate => candidate.id === id);
    if (!body) continue;
    const normal = new THREE.Vector3(.2, .8, -.4).normalize().toArray();
    const expected = body.radius * scale.metresPerUnit + terrainHeightKm(id, normal) * 1000;
    assert(Math.abs(surfaceRadiusM(world, body, normal) - expected) < 1e-6);
    const sample = sampleSurface(world, body, normal.map(n => n * (expected + 1.75)));
    assert(Math.abs(sample.clearanceM - 1.75) < 1e-6);
    close(sample.normal, normal);
    close(sample.surfaceRadialM, normal.map(n => n * expected), 1e-6);
  }
});

test('moving and rotating frame conversions transport velocity exactly once', () => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(.4, -.7, .3)).toArray();
  const frame = new FloatingOriginFrame(scale, { originUniverse: [1000, -3000, 9000],
    orientation: quaternion, originVelocityMps: [310, -70, 11], angularVelocityRadps: [.001, .002, -.004] });
  const positionM = [152, -21, 62], velocityMps = [3.5, -1.5, 5.25];
  const universePosition = frame.localToUniverse(positionM);
  const universeVelocity = frame.localVelocityToUniverse(velocityMps, positionM);
  close(frame.universeToLocal(universePosition), positionM, 1e-5);
  close(frame.universeVelocityToLocal(universeVelocity, positionM), velocityMps);
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.1, .6, .3)).toArray();
  close(frame.orientationToUniverse(frame.orientationToLocal(orientation)), orientation);

  frame.rebaseDistanceM = 100;
  const shift = frame.rebase(positionM);
  assert(shift);
  const newPosition = positionM.map((n, i) => n - shift[i]);
  close(frame.localToUniverse(newPosition), universePosition);
  close(frame.localVelocityToUniverse(velocityMps, newPosition), universeVelocity);
  close(frame.universeVelocityToLocal(universeVelocity, newPosition), velocityMps);

  const inertial = new FloatingOriginFrame(scale, { originUniverse: [-4000, 2000, 7000] });
  const inertialPosition = inertial.universeToLocal(universePosition);
  const inertialVelocity = inertial.universeVelocityToLocal(universeVelocity, inertialPosition);
  close(frame.universeVelocityToLocal(inertial.localVelocityToUniverse(inertialVelocity, inertialPosition), newPosition), velocityMps);
});

test('thousands of floating-origin crossings preserve relative separation, velocity and rotation', () => {
  const frame = new FloatingOriginFrame(scale, { originUniverse: [750000, -43000, 118000] });
  let pilot = [0, 0, 0], ship = [-10, 2, 4];
  const displacement = [257, .125, -.25], relative = ship.map((n, i) => n - pilot[i]);
  const velocity = [5.5, .5, -.25], orientation = [0, 0, Math.sin(.3), Math.cos(.3)];
  for (let i = 0; i < 2000; i++) {
    pilot = pilot.map((n, axis) => n + displacement[axis]);
    ship = ship.map((n, axis) => n + displacement[axis]);
    const beforeVelocity = frame.localVelocityToUniverse(velocity, pilot);
    const shift = frame.rebase(pilot);
    assert(shift);
    pilot = pilot.map((n, axis) => n - shift[axis]);
    ship = ship.map((n, axis) => n - shift[axis]);
    close(ship.map((n, axis) => n - pilot[axis]), relative, 1e-10);
    close(frame.localVelocityToUniverse(velocity, pilot), beforeVelocity, 1e-15);
    close(frame.orientationToUniverse(orientation), orientation);
    assert(Math.hypot(...pilot) < 256);
  }
  assert.equal(frame.revision, 2000);
  close(frame.originOffsetM, displacement.map(n => n * 2000));
});

function positionAbove(ship, id, heightM) {
  ship.jump(id);
  const body = world.bodies.find(candidate => candidate.id === id);
  const radial = [0, 0, -(surfaceRadiusM(world, body, [0, 0, -1]) + heightM)];
  ship.position.fromArray(scale.metresOffsetToUniverse(radial, body.position));
  return body;
}

test('nearby ship integration retains millimetres after solar-system navigation', () => {
  const ship = new ShipDynamics();
  ship.position.set(1e12, -2e12, 3e12);
  ship.step(.25, emptyInput());
  assert.equal(ship.localFrame.bodyId, null);
  positionAbove(ship, 'triton', 20000);
  ship.assist = false;
  ship.velocity.fromArray(scale.metresVelocityToUniverse([.0001, 0, 0]));
  const start = ship.bodyRadialM;
  for (let i = 0; i < 120; i++) ship.step(.25, emptyInput());
  assert.equal(ship.localFrame.bodyId, 'triton');
  close(ship.bodyRadialM.sub(start).toArray(), [.003, 0, 0], 2e-9);
  close(ship.localVelocityMps.toArray(), [.0001, 0, 0], 1e-12);
  const saved = ship.snapshot();
  assert(validateFlightState(saved));
  assert.equal(saved.referenceFrame.kind, 'body-fixed');
  const restored = new ShipDynamics();
  assert(restored.restore(saved));
  close(restored.bodyRadialM.toArray(), ship.bodyRadialM.toArray(), 1e-9);
  assert.deepEqual(restored.snapshot(), saved);
});

test('nearby ship crosses floating origins continuously and takes off from a restored body frame', () => {
  const ship = new ShipDynamics();
  positionAbove(ship, 'moon', 20000);
  ship.assist = false;
  ship.velocity.fromArray(scale.metresVelocityToUniverse([1000, 0, 0]));
  ship.orientation.setFromEuler(new THREE.Euler(.1, .2, -.3));
  const start = ship.bodyRadialM, orientation = ship.orientation.toArray(), frame = ship.localFrame;
  for (let i = 0; i < 100; i++) {
    ship.step(.25, emptyInput());
    assert(ship.localPositionM.length() < 256);
    close(ship.localVelocityMps.toArray(), [1000, 0, 0]);
    close(ship.orientation.toArray(), orientation);
  }
  assert(frame.revision > 70);
  close(ship.bodyRadialM.sub(start).toArray(), [25000, 0, 0], 1e-7);

  for (const id of ['earth', 'moon', 'mars', 'triton']) {
    assert.equal(ship.placeOnSurface(id, [.2, .8, -.4]), null);
    const saved = ship.snapshot(), restored = new ShipDynamics();
    assert(restored.restore(saved));
    close(restored.bodyRadialM.toArray(), ship.bodyRadialM.toArray(), 1e-7);
    assert.equal(restored.takeOff(), null);
    restored.step(.25, emptyInput());
    assert(restored.environment.groundAltitudeKm > 0);
    assert(restored.localVelocityMps.dot(restored.environment.outward) > 0);
    assert(restored.localPositionM.length() < 256);
  }
});
