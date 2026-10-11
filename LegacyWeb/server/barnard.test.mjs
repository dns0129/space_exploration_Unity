import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { orbitPosition } from "../shared/solar-orbits.mjs";
import { surfaceProfile, terrainHeightField, terrainMapNormal } from "../shared/surface.mjs";
import { BARNARD_BODIES, getBody } from "../src/solar-system.ts";
import { SURFACE_MAPS } from "../src/body-textures.ts";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import { WalkingDynamics, initializeWalkingPhysics } from "../src/walking-dynamics.ts";
import { createVoyagerServer } from "./server.mjs";

await initializeWalkingPhysics();

const ids = ["barnard-star", "barnard-d", "barnard-b", "barnard-c", "barnard-e"];
// Basant et al. (2025), Table 3: https://arxiv.org/html/2503.08095v1
const planets = [
  { id: "barnard-d", period: 2.3402, au: .0188, minimumMass: .263 },
  { id: "barnard-b", period: 3.1542, au: .0229, minimumMass: .299 },
  { id: "barnard-c", period: 4.1244, au: .0274, minimumMass: .335 },
  { id: "barnard-e", period: 6.7392, au: .0381, minimumMass: .193 },
];
const byId = id => world.bodies.find(body => body.id === id);
function completeWarp(ship) {
  for (let frame = 0; frame < 1600 && ship.warpPhase !== "ready"; frame++) {
    ship.step(.025, emptyInput());
    assert(validateFlightState(ship.snapshot()), `${ship.target}: every transit/arrival save is valid`);
    for (const obstacle of ship.activeBodies) {
      assert(ship.position.distanceTo(new THREE.Vector3(...obstacle.position)) > obstacle.radius,
        `${ship.target}: route stays outside ${obstacle.id}`);
    }
  }
  assert.equal(ship.warpPhase, "ready");
}

test("Barnard shares one red dwarf and the four confirmed short-period planets with exact scaled orbits", () => {
  const system = world.systems.find(system => system.id === "barnard");
  assert.equal(system.groupId, "barnard");
  assert.equal(system.primaryStar, "barnard-star");
  assert.deepEqual(world.bodies.filter(body => body.systemId === "barnard").map(body => body.id), ids);
  assert.deepEqual(BARNARD_BODIES.map(body => body.id), ids);
  assert.equal(new Set(world.bodies.map(body => body.id)).size, world.bodies.length);
  assert(Math.abs(Math.hypot(...system.positionLy) - 5.96) < .02);
  const star = getBody("barnard-star");
  assert.equal(star.kind, "star");
  assert(star.temperatureK >= 3100 && star.temperatureK <= 3300);
  assert(star.radiusKm > 125000 && star.radiusKm < 140000);
  for (const reference of planets) {
    const body = byId(reference.id), visible = getBody(reference.id);
    assert.equal(body.hostStarId, "barnard-star");
    assert.equal(visible.hostStarId, "barnard-star");
    assert.equal(visible.systemId, "barnard");
    assert(Math.abs(visible.orbitalPeriodDays - reference.period) < .005, `${body.id}: confirmed period`);
    assert.equal(visible.minimumMassEarth, reference.minimumMass);
    assert.equal(visible.radiusConceptual, true, "RV planets have no measured transit radius");
    assert(visible.orbitalPeriodDays < 7, "the disproven 233-day planet is absent");
    assert(Math.abs(body.radius * world.unitsKm - visible.radiusKm) < 1e-8);
    const relative = new THREE.Vector3(...body.position).sub(new THREE.Vector3(...byId("barnard-star").position));
    assert(Math.abs(relative.length() * world.unitsKm / world.auKm - reference.au) < 1e-9, body.id);
    assert(relative.distanceTo(new THREE.Vector3(...orbitPosition(reference.au * world.auKm / world.unitsKm,
      body.orbit.longitudeDeg, body.orbit.inclinationDeg, body.orbit.ascendingNodeDeg))) < 1e-9);
    assert(relative.length() > body.radius + byId("barnard-star").radius);
  }
});

test("Barnard appearances, radii and terrain are conceptual, with no invented measured atmosphere", () => {
  const files = new Set();
  for (const id of ids) {
    const map = SURFACE_MAPS[id];
    assert(map?.concept, `${id}: illustration cannot be labelled measured imagery`);
    assert.equal(map.width, 8192);
    assert(map.compactFile, `${id}: native compact fallback is available`);
    files.add(map.file);
  }
  assert.equal(files.size, 5, "each body has its own detailed illustration");
  for (const { id } of planets) {
    const body = getBody(id), profile = surfaceProfile(id);
    assert.match(body.description, /示意|概念/);
    assert.match(body.description, /大气.*未知|未知.*大气|大气.*未测/);
    assert.equal(body.atmosphereKm, undefined);
    assert.equal(byId(id).atmosphereKm, undefined);
    assert(!body.layers.includes("clouds"));
    assert(!body.layers.includes("atmosphere"));
    assert.equal(profile.density, 0);
    assert.equal(profile.solid, true, "conceptual rocky surfaces remain playable");
    assert.equal(profile.gravityEstimated, true);
    assert(profile.gravity > 0);
    const terrain = terrainHeightField(id);
    assert(terrain, `${id}: rendering and collision use a canonical field`);
    assert.equal(terrainHeightField(id), terrain);
    assert.equal(terrain.data.length, 512 * 256);
  }
  assert.equal(surfaceProfile("barnard-star").solid, false);
  assert.equal(terrainHeightField("barnard-star"), undefined);
});

test("all Barnard destinations warp from Earth and inside the system, preserve approach side and restore locally", () => {
  for (const origin of ["earth", "barnard-star"]) {
    for (const id of ids.filter(id => id !== origin)) {
      const ship = new ShipDynamics();
      ship.jump(origin);
      ship.target = id;
      const approach = ship.targetRelative.clone().negate().normalize();
      assert.equal(ship.startWarp(), null, `${origin} → ${id}`);
      completeWarp(ship);
      assert.equal(ship.systemId, "barnard");
      assert.equal(ship.environment.body.id, id);
      const radial = ship.position.clone().sub(new THREE.Vector3(...byId(id).position));
      assert(radial.clone().normalize().dot(approach) > 1 - 1e-9, `${id}: approach side is retained`);
      if (id !== "barnard-star") assert(Math.abs(ship.environment.altitudeKm - 1100) < 1e-6);
      const saved = ship.snapshot(), restored = new ShipDynamics();
      assert(restored.restore(saved));
      assert.equal(restored.systemId, "barnard");
      assert.equal(restored.target, id);
      assert(restored.position.equals(ship.position));
      if (id === "barnard-star") {
        assert(ship.startLanding());
        assert(ship.placeOnSurface(id, [0, 1, 0]));
        assert.equal(validateFlightState({ ...saved, landedBody: id }), null);
      }
    }
  }
  const ship = new ShipDynamics();
  ship.jump("barnard-e");
  ship.target = "earth";
  assert.equal(ship.startWarp(), null);
  completeWarp(ship);
  assert.equal(ship.systemId, "solar");
  assert.equal(ship.environment.body.id, "earth");
});

test("HTTP Barnard world and all four landed walking saves persist across server restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "voyager-barnard-"));
  const server = createVoyagerServer({ dataDir });
  const listen = () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  await listen();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = () => `http://127.0.0.1:${server.address().port}`;
  const exposed = await (await fetch(url() + "/api/world")).json();
  assert.deepEqual(exposed.bodies.filter(body => body.systemId === "barnard").map(body => body.id), ids);
  const cookie = (await fetch(url() + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  for (const { id } of planets) {
    const ship = new ShipDynamics(), walker = new WalkingDynamics();
    assert.equal(ship.placeOnSurface(id, terrainMapNormal(id, [.17, .61])), null);
    assert.equal(walker.disembark(ship), null);
    const start = walker.offsetM.clone();
    for (let frame = 0; frame < 20; frame++) walker.step(.05, { ...emptyInput(), throttle: 1 });
    assert(walker.offsetM.distanceTo(start) > .1, `${id}: astronaut actually walks`);
    const saved = { ...ship.snapshot(), walking: walker.snapshot() };
    assert(validateFlightState(saved));
    const response = await fetch(url() + "/api/flight/save", { method: "POST",
      headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(saved) });
    assert.equal(response.status, 200);
    await new Promise(resolve => server.close(resolve));
    await listen();
    const stored = (await (await fetch(url() + "/api/flight/save", { headers: { cookie } })).json()).state;
    assert.deepEqual(stored, saved);
    const restoredShip = new ShipDynamics(), restoredWalker = new WalkingDynamics();
    assert(restoredShip.restore(stored));
    restoredWalker.restore(stored.walking, restoredShip);
    assert.equal(restoredShip.systemId, "barnard");
    assert.equal(restoredShip.landedBody, id);
    assert.equal(restoredWalker.bodyId, id);
    assert.equal(restoredWalker.gravity, surfaceProfile(id).gravity);
    assert(restoredWalker.offsetM.distanceTo(walker.offsetM) < 1e-7);
    assert(restoredWalker.groundClearanceM >= -.015);
    walker.reset();
    restoredWalker.reset();
  }
});
