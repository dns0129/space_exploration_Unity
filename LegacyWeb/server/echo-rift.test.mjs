import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import * as THREE from "three";
import echoRift from "../shared/echo-rift.json" with { type: "json" };
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { orbitPosition } from "../shared/solar-orbits.mjs";
import { surfaceProfile, terrainHeightField, terrainHeightKm, terrainMapNormal } from "../shared/surface.mjs";
import { ECHO_RIFT_BODIES, getBody } from "../src/solar-system.ts";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics, initializeWalkingPhysics } from "../src/walking-dynamics.ts";
import { createVoyagerServer } from "./server.mjs";

await initializeWalkingPhysics();

const ids = ["echo-pulsar", "veyl", "echo-thalassa", "cinder", "ruin", "shard"];
const byId = id => world.bodies.find(body => body.id === id);
const apiRequest = (url, path, body, cookie) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = request(url + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
  }, response => {
    let data = "";
    response.setEncoding("utf8");
    response.on("data", chunk => { data += chunk; });
    response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, data: JSON.parse(data) }));
  });
  req.on("error", reject);
  req.end(payload);
});

test("Echo Rift shares six unique fictional bodies, nested inclined orbits and exact kilometre radii", () => {
  const system = world.systems.find(system => system.id === "echo-rift");
  assert.equal(system.groupId, "echo-rift");
  assert.equal(system.primaryStar, "echo-pulsar");
  assert.deepEqual(world.bodies.filter(body => body.systemId === system.id).map(body => body.id), ids);
  assert.deepEqual(ECHO_RIFT_BODIES.map(body => body.id), ids);
  assert.equal(new Set(world.bodies.map(body => body.id)).size, world.bodies.length);
  assert.equal(byId("thalassa").parentId, "neptune", "the existing Neptune moon and old saves keep their identity");
  for (const reference of echoRift) {
    const body = byId(reference.id), visible = getBody(reference.id);
    assert(Math.abs(body.radius * world.unitsKm - reference.radiusKm) < 1e-8, body.id);
    assert.equal(visible.radiusKm, reference.radiusKm);
    assert.equal(visible.systemId, "echo-rift");
    assert.match(visible.description, /虚构/);
    assert.deepEqual(body.position, reference.position);
    if (body.id === "echo-pulsar") {
      assert.equal(body.kind, "star");
      assert.equal(visible.radiusKm, 18000);
      assert.match(visible.description, /艺术放大/);
      continue;
    }
    assert.equal(body.hostStarId, "echo-pulsar");
    const parent = byId(reference.parentId ?? "echo-pulsar");
    const relative = new THREE.Vector3(...body.position).sub(new THREE.Vector3(...parent.position));
    assert(Math.abs(relative.length() * world.unitsKm - reference.orbitRadiusKm) < 1e-6, body.id);
    const orbit = reference.orbit;
    assert(relative.distanceTo(new THREE.Vector3(...orbitPosition(reference.orbitRadiusKm / world.unitsKm,
      orbit.longitudeDeg, orbit.inclinationDeg, orbit.ascendingNodeDeg))) < 1e-9, `${body.id} orbit geometry`);
    assert(relative.length() > body.radius + parent.radius, `${body.id} does not intersect its host`);
  }
  assert.equal(byId("echo-thalassa").parentId, "veyl");
  assert.equal(byId("cinder").parentId, "veyl");
  assert.equal(byId("shard").parentId, "ruin");
});

test("water and dry geology use stable shared height fields, while incomplete shells cannot land or accept surface saves", () => {
  const water = terrainHeightField("echo-thalassa"), dry = terrainHeightField("cinder");
  for (const field of [water, dry]) {
    assert.equal(field.width, 512);
    assert.equal(field.height, 256);
    assert.equal(field.data.length, 512 * 256);
    assert.equal(field.fineEnabled, false);
    assert.equal(terrainHeightField(field.id), field);
    assert(surfaceProfile(field.id).gravityEstimated);
    assert(surfaceProfile(field.id).gravity > 0);
  }
  assert(water.waterMask instanceof Uint8Array);
  let sea = 0, mountains = 0;
  for (let i = 0; i < water.data.length; i++) {
    assert.equal(water.waterMask[i], water.data[i] <= 4 ? 255 : 0);
    sea += Number(water.waterMask[i] === 255);
    mountains += Number(water.data[i] > 100);
  }
  assert(sea > water.data.length * .2 && sea < water.data.length * .85, "water world contains both broad seas and continents");
  assert(mountains > 1000, "the water world retains highland geology");
  assert.equal(dry.waterMask, undefined);
  for (const id of ["echo-pulsar", "veyl", "ruin", "shard"]) {
    assert.equal(surfaceProfile(id).solid, false);
    assert.equal(terrainHeightField(id), undefined);
    assert.equal(terrainHeightKm(id, [0, 0, 1]), 0);
    const ship = new ShipDynamics();
    ship.jump(id);
    assert.equal(ship.startLanding(), surfaceProfile(id).landingReason);
    const saved = ship.snapshot();
    assert.equal(ship.placeOnSurface(id, [0, 1, 0]), surfaceProfile(id).landingReason);
    assert.deepEqual(ship.snapshot(), saved);
    assert.equal(validateFlightState({ ...saved, landedBody: id }), null);
  }
});

test("all six destinations can warp from another system and within their own orbit group without crossing a body", () => {
  for (const from of ["earth", "echo-thalassa"]) {
    for (const target of ids.filter(id => id !== from)) {
      const ship = new ShipDynamics();
      ship.jump(from);
      ship.target = target;
      assert.equal(ship.startWarp(), null, `${from} → ${target}`);
      for (let frame = 0; frame < 800 && ship.warpPhase !== "ready"; frame++) {
        ship.step(.025, emptyInput());
        assert(validateFlightState(ship.snapshot()), `${target} transit save`);
        for (const obstacle of ship.activeBodies)
          assert(ship.position.distanceTo(new THREE.Vector3(...obstacle.position)) > obstacle.radius,
            `${from} → ${target} crosses ${obstacle.id}`);
      }
      assert.equal(ship.warpPhase, "ready");
      assert.equal(ship.systemId, "echo-rift");
      assert.equal(ship.environment.body.id, target);
      const restored = new ShipDynamics();
      assert(restored.restore(ship.snapshot()));
      assert.equal(restored.target, target);
      assert.equal(restored.systemId, "echo-rift");
      assert(restored.position.equals(ship.position));
    }
  }
});

test("both intact moons persist landed walking states through the HTTP backend and resume on the same terrain", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "voyager-echo-rift-"));
  const server = createVoyagerServer({ dataDir });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const exposedWorld = (await apiRequest(url, "/api/world")).data;
  assert.deepEqual(exposedWorld.bodies.filter(body => body.systemId === "echo-rift").map(body => body.id), ids);
  const cookie = (await apiRequest(url, "/api/flight/save")).headers["set-cookie"][0].split(";")[0];
  for (const id of ["echo-thalassa", "cinder"]) {
    const ship = new ShipDynamics(), walker = new WalkingDynamics();
    assert.equal(ship.placeOnSurface(id, terrainMapNormal(id, [.17, .61])), null);
    assert.equal(walker.disembark(ship), null);
    for (let i = 0; i < 20; i++) walker.step(.05, { ...emptyInput(), throttle: 1, strafe: .4 });
    const saved = { ...ship.snapshot(), walking: walker.snapshot() };
    assert(validateFlightState(saved));
    const response = await apiRequest(url, "/api/flight/save", saved, cookie);
    assert.equal(response.status, 200);
    const stored = (await apiRequest(url, "/api/flight/save", undefined, cookie)).data.state;
    assert.equal(stored.landedBody, id);
    assert.equal(stored.walking.bodyId, id);
    assert.equal(stored.systemId, "echo-rift");
    const restoredShip = new ShipDynamics(), restoredWalker = new WalkingDynamics();
    assert(restoredShip.restore(stored));
    restoredWalker.restore(stored.walking, restoredShip);
    assert(restoredWalker.active);
    assert.equal(restoredWalker.gravity, surfaceProfile(id).gravity);
    assert(Math.abs(restoredWalker.groundClearanceM) < .015);
    assert(restoredShip.position.equals(ship.position));
    const resumed = restoredWalker.snapshot(), original = walker.snapshot();
    assert.deepEqual(resumed.offsetM, original.offsetM);
    assert.deepEqual(resumed.velocityMps, original.velocityMps);
    assert.equal(resumed.grounded, original.grounded);
    assert.equal(resumed.pitch, original.pitch);
    assert(new THREE.Quaternion(...resumed.orientation).angleTo(new THREE.Quaternion(...original.orientation)) < 1e-7,
      "restoring the radial stance retains the same orientation within floating-point precision");
  }
});
