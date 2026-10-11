import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { surfaceProfile, terrainHeightField, terrainHeightKm } from "../shared/surface.mjs";
import { BLACK_HOLE_BODIES, getBody } from "../src/solar-system.ts";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics } from "../src/walking-dynamics.ts";
import { createVoyagerServer } from "./server.mjs";

const id = "gargantua";
const blackHole = world.bodies.find(body => body.id === id);
const center = new THREE.Vector3(...blackHole.position);
const radius = ship => ship.position.distanceTo(center);
const completeWarp = ship => {
  for (let frame = 0; frame < 1000 && ship.warpPhase !== "ready"; frame++) {
    ship.step(.025, emptyInput());
    assert(validateFlightState(ship.snapshot()), "every transit/arrival snapshot is valid");
    for (const obstacle of ship.activeBodies) {
      const safeRadius = obstacle.radius * (obstacle.kind === "black-hole" ? 6 : 1);
      assert(ship.position.distanceTo(new THREE.Vector3(...obstacle.position)) >= safeRadius,
        `warp avoids ${obstacle.id}, including the black-hole gameplay barrier`);
    }
  }
  assert.equal(ship.warpPhase, "ready");
};

test("black-hole navigation shares exactly one non-solid body with the frontend and backend", () => {
  const system = world.systems.find(system => system.id === "black-hole");
  assert.equal(system.groupId, "black-hole");
  assert.equal(system.primaryStar, id);
  assert.deepEqual(world.bodies.filter(body => body.systemId === system.id).map(body => body.id), [id]);
  assert.deepEqual(BLACK_HOLE_BODIES.map(body => body.id), [id]);
  assert.equal(blackHole.kind, "black-hole");
  assert.equal(blackHole.atmosphereKm, undefined);
  assert.equal(getBody(id).kind, "black-hole");
  assert(Math.abs(blackHole.radius * world.unitsKm - getBody(id).radiusKm) < 1e-9);
  assert.match(getBody(id).description, /艺术近似/);
  assert.match(getBody(id).description, /未进行广义相对论/);
  assert.equal(surfaceProfile(id).solid, false);
  assert.equal(surfaceProfile(id).gravity, 0, "ordinary near-ground gravity is not a black-hole model");
  assert.equal(terrainHeightField(id), undefined);
  assert.equal(terrainHeightKm(id, [0, 1, 0]), 0);
});

test("black-hole jumps and warps arrive at 8R, remain outside 6R and can leave for existing systems", () => {
  const ship = new ShipDynamics();
  ship.jump(id);
  assert(Math.abs(radius(ship) / blackHole.radius - 8) < 1e-12);
  for (const origin of ["earth", "echo-thalassa", "betelgeuse"]) {
    ship.jump(origin);
    ship.target = id;
    const direction = ship.targetRelative.clone().negate().normalize();
    assert.equal(ship.startWarp(), null, `${origin} → black hole`);
    completeWarp(ship);
    assert.equal(ship.systemId, "black-hole");
    assert.equal(ship.environment.body.id, id);
    assert(Math.abs(radius(ship) / blackHole.radius - 8) < 1e-10);
    assert(ship.position.clone().sub(center).normalize().dot(direction) > 1 - 1e-10,
      "cross-system arrival retains the departure side");
    const saved = ship.snapshot(), restored = new ShipDynamics();
    assert.equal(saved.referenceFrame.kind, "system", "there is no solid-surface reference frame");
    assert(restored.restore(saved));
    assert.deepEqual(restored.snapshot(), saved);
    assert.equal(restored.landedBody, null);
    assert.equal(restored.landingPhase, "manual");
    ship.target = origin;
    assert.equal(ship.startWarp(), null, `black hole → ${origin}`);
    completeWarp(ship);
    assert.equal(ship.target, origin);
    assert.equal(ship.environment.body.id, origin);
  }
});

test("manual high-speed and gentle approaches stop at the gameplay barrier without landing", () => {
  for (const speedKm of [.1, 150000]) for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]) {
    const ship = new ShipDynamics();
    ship.jump(id);
    ship.assist = false;
    ship.cruiseSpeedKm = Math.max(1, speedKm);
    const clearanceKm = speedKm === .1 ? .001 : 1000;
    ship.position.copy(center).addScaledVector(normal, blackHole.radius * 6 + clearanceKm / world.unitsKm);
    ship.velocity.copy(normal).multiplyScalar(-speedKm / world.unitsKm);
    ship.step(.05, emptyInput());
    assert.equal(ship.collision, id);
    assert(Math.abs((radius(ship) - blackHole.radius * 6) * world.unitsKm) < .00002);
    assert.equal(ship.velocity.length(), 0);
    assert.equal(ship.landedBody, null);
    assert.equal(ship.landingPhase, "manual");
    assert.equal(ship.environment.lowFlight, false);
    assert.equal(ship.environment.atmospheric, false);
    assert(validateFlightState(ship.snapshot()));
  }
});

test("black-hole flight applies no surface gravity or low-flight throttle and restores inside-barrier saves safely", () => {
  const ship = new ShipDynamics();
  ship.jump(id);
  ship.assist = false;
  ship.cruiseSpeedKm = 50000;
  ship.lowFlightSpeedMps = 1;
  ship.position.copy(center).add(new THREE.Vector3(0, 0, blackHole.radius * 6.5));
  const initial = ship.position.clone();
  for (let frame = 0; frame < 20; frame++) ship.step(.05, emptyInput());
  assert(ship.position.equals(initial), "no artificial ordinary surface gravity pulls a stationary ship");
  assert.equal(ship.velocity.length(), 0);
  assert.equal(ship.environment.lowFlight, false);
  assert(Math.abs(ship.speedLimit * world.unitsKm - 50000) < 1e-8);
  const saved = ship.snapshot();
  for (const multiplier of [0, 1, 5.99]) {
    const restored = new ShipDynamics();
    assert(restored.restore({ ...saved, position: center.clone().add(new THREE.Vector3(0, 0, blackHole.radius * multiplier)).toArray() }));
    assert(radius(restored) >= blackHole.radius * 6);
    assert.equal(restored.landedBody, null);
    assert.equal(restored.landingPhase, "manual");
    assert.equal(restored.velocity.length(), 0);
  }
});

test("black-hole targeting, placement and manipulated surface/walking saves cannot enable landing", () => {
  const ship = new ShipDynamics();
  ship.target = id;
  assert.equal(ship.landingBlockReason, surfaceProfile(id).landingReason,
    "selecting a black hole near Earth must explain the actual target restriction");
  ship.jump(id);
  const saved = ship.snapshot();
  assert.equal(ship.startLanding(), surfaceProfile(id).landingReason);
  assert.equal(ship.placeOnSurface(id, [0, 1, 0]), surfaceProfile(id).landingReason);
  assert.deepEqual(ship.snapshot(), saved);
  assert.equal(validateFlightState({ ...saved, landedBody: id }), null);
  assert.equal(validateFlightState({ ...saved, landedBody: id, walking: {
    bodyId: id, offsetM: [0, 0, 0], velocityMps: [0, 0, 0], orientation: [0, 0, 0, 1],
    pitch: 0, grounded: true,
  } }), null);
  const walker = new WalkingDynamics();
  assert.match(walker.disembark(ship), /着陆/);
  assert.equal(walker.active, false);
});

test("cancelled black-hole arrival saves restore locally with manual controls and can warp outward", () => {
  const ship = new ShipDynamics();
  ship.target = id;
  assert.equal(ship.startWarp(), null);
  for (let frame = 0; frame < 1000 && ship.warpPhase !== "arrival"; frame++) ship.step(.025, emptyInput());
  assert.equal(ship.warpPhase, "arrival");
  ship.step(.25, emptyInput());
  const position = ship.position.clone(), orientation = ship.orientation.clone();
  ship.cancelWarp();
  assert(ship.position.equals(position));
  assert(ship.orientation.equals(orientation));
  assert(radius(ship) > blackHole.radius * 8);
  const restored = new ShipDynamics();
  assert(restored.restore(ship.snapshot()));
  assert(restored.position.equals(position));
  assert.equal(restored.systemId, "black-hole");
  assert.equal(restored.warpPhase, "ready", "restoring never resumes the old warp animation");
  restored.target = "earth";
  assert.equal(restored.startWarp(), null);
  completeWarp(restored);
  assert.equal(restored.systemId, "solar");
});

test("HTTP world and persistence retain black-hole saves across restart and reject fake surface saves", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "voyager-black-hole-"));
  const server = createVoyagerServer({ dataDir });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const serverUrl = () => `http://127.0.0.1:${server.address().port}`;
  const exposed = await (await fetch(serverUrl() + "/api/world")).json();
  assert.deepEqual(exposed.bodies.filter(body => body.systemId === "black-hole"), [blackHole]);
  const cookie = (await fetch(serverUrl() + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  const ship = new ShipDynamics();
  ship.jump(id);
  ship.cruiseSpeedKm = 700;
  ship.lowFlightSpeedMps = 17;
  ship.camera = "chase";
  const saved = ship.snapshot();
  const post = state => fetch(serverUrl() + "/api/flight/save", { method: "POST",
    headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(state) });
  assert.equal((await post(saved)).status, 200);
  assert.equal((await post({ ...saved, landedBody: id })).status, 400);
  assert.equal((await post({ ...saved, walking: { bodyId: id } })).status, 400);
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const stored = (await (await fetch(serverUrl() + "/api/flight/save", { headers: { cookie } })).json()).state;
  assert.deepEqual(stored, saved, "invalid saves never replace the last valid free-flight checkpoint");
  const restored = new ShipDynamics();
  assert(restored.restore(stored));
  assert.deepEqual(restored.snapshot(), saved);
});
