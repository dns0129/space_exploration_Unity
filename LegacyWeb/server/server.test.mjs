import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVoyagerServer } from "./server.mjs";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import { bodySystem } from "../shared/world-navigation.mjs";
import { terrainHeightKm, terrainMapNormal, surfaceProfile, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { PROPULSION_BANDS, propulsionBand, speedToSlider, sliderToSpeed } from "../shared/propulsion.mjs";
import { mappedMountainNormal } from "./terrain-fixtures.mjs";
import { ShipDynamics, emptyInput } from "../src/ship-dynamics.ts";
import * as THREE from "three";
import { RenderBudget } from "../src/render-budget.ts";
import { createShip, SHIP_LENGTH_KM } from "../src/ship-model.ts";
import { projectFlightTarget } from "../src/flight-target.ts";
const state = () => new ShipDynamics().snapshot();
const speedKm = ship => Math.hypot(...ship.velocity.toArray()) * world.unitsKm;
function placeAtAltitude(ship, id, altitudeKm, normal = new THREE.Vector3(0, 0, 1)) {
  const body = world.bodies.find(candidate => candidate.id === id);
  ship.systemId = bodySystem(body);
  ship.target = id;
  ship.position.fromArray(body.position).addScaledVector(normal, body.radius + altitudeKm / world.unitsKm);
  ship.velocity.set(0, 0, 0);
  return body;
}
function placeAboveGround(ship, id, groundAltitudeKm, normal = new THREE.Vector3(0, 0, 1)) {
  return placeAtAltitude(ship, id, terrainHeightKm(id, normal.toArray()) + LANDING_CLEARANCE_KM + groundAltitudeKm, normal);
}
function faceOutward(ship) {
  ship.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), ship.environment.outward);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "voyager-server-"));
  const staticRoot = join(root, "game"),
    dataDir = join(root, "saves");
  await mkdir(staticRoot);
  await writeFile(join(staticRoot, "index.html"), "<h1>Voyager flight</h1>");
  const server = createVoyagerServer({ staticRoot, dataDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return {
    server,
    staticRoot,
    dataDir,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}
test("backend serves the game and full solar world; blocks invalid files and methods", async (t) => {
  const { url } = await fixture(t);
  assert.equal(await (await fetch(url)).text(), "<h1>Voyager flight</h1>");
  assert.deepEqual(await (await fetch(url + "/api/world")).json(), world);
  assert.equal((await fetch(url + "/missing.jpg")).status, 404);
  assert.equal((await fetch(url + "/%2f..%2fsecret")).status, 403);
  assert.equal(
    (await fetch(url + "/api/flight/save", { method: "DELETE" })).status,
    405,
  );
});
test("flight saves persist across server restart and remain private to the pilot cookie", async (t) => {
  const f = await fixture(t);
  const initial = await fetch(f.url + "/api/flight/save");
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  assert.equal((await initial.json()).state, null);
  const ship = new ShipDynamics();
  ship.position.x += 10;
  ship.elapsed = 42;
  const saved = ship.snapshot();
  const result = await fetch(f.url + "/api/flight/save", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(saved),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    (
      await (
        await fetch(f.url + "/api/flight/save", { headers: { cookie } })
      ).json()
    ).state,
    saved,
  );
  assert.equal(
    (await (await fetch(f.url + "/api/flight/save")).json()).state,
    null,
  );
  await new Promise((resolve) => f.server.close(resolve));
  await new Promise((resolve) => f.server.listen(0, "127.0.0.1", resolve));
  assert.deepEqual(
    (
      await (
        await fetch(
          `http://127.0.0.1:${f.server.address().port}/api/flight/save`,
          { headers: { cookie } },
        )
      ).json()
    ).state,
    saved,
  );
});
test("backend preserves a Proxima coordinate frame and rejects unknown systems", async (t) => {
  const { url } = await fixture(t);
  const cookie = (await fetch(url + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  const ship = new ShipDynamics();
  ship.jump("proxima-b");
  const saved = ship.snapshot();
  const post = value => fetch(url + "/api/flight/save", { method: "POST", headers, body: JSON.stringify(value) });
  assert.equal((await post(saved)).status, 200);
  assert.equal((await post({ ...saved, systemId: "unknown" })).status, 400);
  const stored = (await (await fetch(url + "/api/flight/save", { headers: { cookie } })).json()).state;
  assert.deepEqual(stored, saved);
  const restored = new ShipDynamics();
  assert.equal(restored.restore(stored), true);
  assert.equal(restored.systemId, "proxima-centauri");
  assert.equal(restored.environment.body.id, "proxima-b");
});
test("malformed, oversized and cross-origin saves are rejected without replacing a valid save", async (t) => {
  const { url } = await fixture(t);
  const cookie = (await fetch(url + "/api/flight/save")).headers
    .get("set-cookie")
    .split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  const saved = state();
  assert.equal(
    (
      await fetch(url + "/api/flight/save", {
        method: "POST",
        headers,
        body: JSON.stringify(saved),
      })
    ).status,
    200,
  );
  for (const body of [
    "{bad",
    JSON.stringify({ ...saved, orientation: [0, 0, 0, 0] }),
    JSON.stringify({ ...saved, position: [null, 0, 0] }),
    JSON.stringify({ ...saved, target: "pluto" }),
  ])
    assert.equal(
      (await fetch(url + "/api/flight/save", { method: "POST", headers, body }))
        .status,
      400,
    );
  assert.equal(validateFlightState({ ...saved, position: [Infinity, 0, 0] }), null);
  assert.equal(
    (
      await fetch(url + "/api/flight/save", {
        method: "POST",
        headers,
        body: "x".repeat(9000),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await fetch(url + "/api/flight/save", {
        method: "POST",
        headers: { ...headers, origin: "https://elsewhere.example" },
        body: JSON.stringify(saved),
      })
    ).status,
    403,
  );
  assert.deepEqual(
    (
      await (
        await fetch(url + "/api/flight/save", { headers: { cookie } })
      ).json()
    ).state,
    saved,
  );
});
test("standalone server serves only the game document and API, never save files", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.staticRoot, "private.json"), "secret");
  await new Promise((resolve) => f.server.close(resolve));
  const server = createVoyagerServer({
    staticRoot: f.staticRoot,
    dataDir: f.dataDir,
    serveOnlyIndex: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + "/private.json")).status, 404);
});
test("thrust, six-axis orientation, inertia and braking change the actual ship state", () => {
  const ship = new ShipDynamics();
  const start = ship.position.clone();
  const input = {
    ...emptyInput(),
    throttle: 1,
    strafe: 1,
    lift: 1,
    yaw: 0.5,
    roll: 0.5,
  };
  for (let i = 0; i < 30; i++) ship.step(0.05, input);
  assert(ship.position.distanceTo(start) > 0.001);
  assert(speedKm(ship) > 0 && speedKm(ship) < ship.cruiseSpeedKm, "thrust must accelerate toward the selected speed smoothly");
  assert(ship.orientation.angleTo(new ShipDynamics().orientation) > 0.2);
  const speed = ship.velocity.length();
  for (let i = 0; i < 15; i++)
    ship.step(0.05, { ...emptyInput(), brake: true });
  assert(ship.velocity.length() < speed * 0.01);
  assert(validateFlightState(ship.snapshot()));
});
test("a radial high-speed approach reaches the real low-flight boundary before reducing speed", () => {
  const ship = new ShipDynamics();
  placeAboveGround(ship, "earth", 200, new THREE.Vector3(0, 0, -1));
  ship.setCruiseSpeed(10000);
  ship.setLowFlightSpeed(1000);
  ship.velocity.set(0, 0, 10000 / world.unitsKm);
  ship.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1));
  ship.assist = false;
  const start = ship.position.clone();
  ship.step(0.05, { ...emptyInput(), throttle: 1 });
  const movedKm = ship.position.distanceTo(start) * world.unitsKm;
  assert(Math.abs(movedKm - (190 + 0.031)) < 0.00002,
    "the first 190 km must use space speed, with only the remaining 31 ms using low-flight speed");
  assert(Math.abs(ship.environment.groundAltitudeKm - 9.969) < 0.00002);
  assert(Math.abs(speedKm(ship) - 1) < 1e-8);
  assert.equal(ship.collision, null);
  assert(validateFlightState(ship.snapshot()));
});

function mountainTraverse(heightKm) {
  // A mapped Antarctic ridge replaces the former arbitrary noise ridge. The
  // ten-kilometre route retains >200 m clearance at both valley endpoints and
  // a >200 m obstruction between them at this compact DEM's physical scale.
  const normal = new THREE.Vector3(...terrainMapNormal("earth", [0.96728515625, 0.0341796875]));
  const east = new THREE.Vector3(0, 1, 0).cross(normal).normalize();
  const north = normal.clone().cross(east).normalize();
  const direction = east.multiplyScalar(Math.cos(7 * Math.PI / 16)).addScaledVector(north, Math.sin(7 * Math.PI / 16));
  heightKm ??= terrainHeightKm("earth", normal.toArray()) - 0.25 + LANDING_CLEARANCE_KM;
  const fromKm = normal.multiplyScalar(6371 + heightKm).addScaledVector(direction, -5);
  const terrain = [], clearance = [];
  for (let i = 0; i <= 1000; i++) {
    const point = fromKm.clone().addScaledVector(direction, i / 100);
    const height = terrainHeightKm("earth", point.clone().normalize().toArray());
    terrain.push(height);
    clearance.push(point.length() - 6371 - height - LANDING_CLEARANCE_KM);
  }
  return { fromKm, direction, terrain, clearance, heightKm };
}
function placeOnTraverse(ship, fixture) {
  const earth = world.bodies.find(body => body.id === "earth");
  ship.position.fromArray(earth.position).addScaledVector(fixture.fromKm, 1 / world.unitsKm);
  ship.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fixture.direction);
  ship.setCruiseSpeed(200);
  ship.velocity.copy(fixture.direction).multiplyScalar(200 / world.unitsKm);
}

test("low-flight motion still collides with the first real mapped mountain ridge", () => {
  const fixture = mountainTraverse();
  assert(fixture.clearance[0] > 0.2 && fixture.clearance.at(-1) > 0.2);
  assert(Math.min(...fixture.clearance) < -0.2, "the intermediate mountain must intersect this valley-to-valley path");
  const ship = new ShipDynamics();
  placeOnTraverse(ship, fixture);
  const firstContactKm = fixture.clearance.findIndex(clearance => clearance < 0) / 100;
  assert(firstContactKm > 2 && firstContactKm < 3, "this path reaches an intermediate mapped ridge");
  ship.position.addScaledVector(fixture.direction, (firstContactKm - 0.02) / world.unitsKm);
  ship.velocity.copy(fixture.direction).multiplyScalar(1 / world.unitsKm);
  ship.setLowFlightSpeed(1000);
  ship.assist = false;
  const start = ship.position.clone();
  ship.step(0.05, { ...emptyInput(), throttle: 1 });
  assert.equal(ship.collision, "earth");
  assert.equal(ship.velocity.length(), 0);
  const movedKm = ship.position.distanceTo(start) * world.unitsKm;
  assert(movedKm > 0.005 && movedKm < 0.03,
    "the permitted low-flight segment must stop at intermediate terrain, not a conservative envelope");
  assert(ship.environment.groundAltitudeKm >= -0.00001 && ship.environment.groundAltitudeKm < 0.005);
});

test("the entire mapped valley-to-valley route above the highest ridge remains clear at the low-flight preset", () => {
  const low = mountainTraverse();
  const fixture = mountainTraverse(Math.max(...low.terrain) + 0.1 + LANDING_CLEARANCE_KM);
  assert(Math.min(...fixture.clearance) > 0.099);
  const ship = new ShipDynamics();
  placeOnTraverse(ship, fixture);
  ship.velocity.copy(fixture.direction).multiplyScalar(1 / world.unitsKm);
  ship.setLowFlightSpeed(1000);
  const start = ship.position.clone();
  for (let i = 0; i < 200; i++) {
    ship.step(0.05, { ...emptyInput(), throttle: 1 });
    assert.equal(ship.collision, null);
    assert(Math.abs(speedKm(ship) - 1) < 1e-8);
  }
  assert(Math.abs(ship.position.distanceTo(start) * world.unitsKm - 10) < 1e-6,
    "the envelope must not shorten an actually clear ten-kilometre path");
});

test("legacy maximum finite cruise migrates to the new ceiling while current controls reject it", () => {
  const ship = new ShipDynamics();
  ship.position.set(1e6, 0, 0);
  const legacy = { ...ship.snapshot(), cruiseSpeedKm: Number.MAX_VALUE,
    velocity: [Number.MAX_VALUE / world.unitsKm, 0, 0], engineMode: "atmospheric" };
  const migrated = validateFlightState(legacy);
  assert(migrated);
  assert.equal(migrated.cruiseSpeedKm, 150000);
  assert.equal(migrated.engineMode, "interstellar");
  assert(Math.abs(Math.hypot(...migrated.velocity) * world.unitsKm - 150000) < 1e-8);
  assert(ship.restore(migrated));
  const velocity = ship.velocity.clone();
  assert(ship.setCruiseSpeed(Number.MAX_VALUE));
  assert.equal(ship.cruiseSpeedKm, 150000);
  assert(ship.velocity.equals(velocity));
  for (let i = 0; i < 3; i++) {
    ship.step(0.01, { ...emptyInput(), throttle: 1 });
    assert(ship.position.toArray().every(Number.isFinite));
    assert(ship.velocity.toArray().every(Number.isFinite));
    assert(validateFlightState(ship.snapshot()));
  }
});

test("an injected extreme velocity is safely capped while its physical sweep still collides with the Sun", () => {
  const ship = new ShipDynamics();
  const sun = placeAtAltitude(ship, "sun", 5000, new THREE.Vector3(0, 0, -1));
  ship.assist = false;
  ship.setCruiseSpeed(150000);
  ship.velocity.set(0, 0, 1e160 / world.unitsKm);
  ship.step(0.05, emptyInput());
  assert.equal(ship.collision, "sun");
  assert.equal(ship.velocity.length(), 0);
  const clearanceKm = (ship.position.distanceTo(new THREE.Vector3().fromArray(sun.position)) - sun.radius) * world.unitsKm;
  assert(clearanceKm >= -0.00001 && clearanceKm < 0.005,
    "a maximum-speed frame must reach the physical surface without skipping the star");
  assert(ship.position.toArray().every(Number.isFinite));
  assert(validateFlightState(ship.snapshot()));
});

test("five propulsion bands occupy equal slider sections and derive only from the space preset", () => {
  assert.deepEqual(PROPULSION_BANDS.map(({ id, minKm, maxKm }) => [id, minKm, maxKm]), [
    ["maneuver", 1, 100], ["cruise", 100, 1000], ["transfer", 1000, 10000],
    ["planetary", 10000, 50000], ["interstellar", 50000, 150000],
  ]);
  assert(PROPULSION_BANDS.every(band => typeof band.name === "string" && band.name.length));
  const pairs = [[0, 1], [50, 50.5], [100, 100], [150, 550], [200, 1000],
    [250, 5500], [300, 10000], [350, 30000], [400, 50000], [450, 100000], [500, 150000]];
  for (const [slider, kmps] of pairs) {
    assert(Math.abs(sliderToSpeed(slider) - kmps) < 1e-9);
    assert(Math.abs(speedToSlider(kmps) - slider) < 1e-9);
  }
  for (let position = 0; position <= 500; position += 0.5)
    assert(Math.abs(speedToSlider(sliderToSpeed(position)) - position) < 1e-9);
  for (const [boundary, id] of [[100, "cruise"], [1000, "transfer"], [10000, "planetary"], [50000, "interstellar"]]) {
    assert.equal(propulsionBand(boundary).id, id, "shared endpoints belong to the higher band");
    assert.notEqual(propulsionBand(boundary - 0.001).id, id);
  }

  const ship = new ShipDynamics();
  assert.equal(ship.cruiseSpeedKm, 100);
  assert.equal(ship.lowFlightSpeedMps, 1000);
  assert.equal(ship.engineMode, "cruise");
  assert.throws(() => { ship.engineMode = "interstellar"; }, TypeError, "the active band is a read-only derivative of the space preset");
  for (const cruise of [1, 500, 5000, 30000, 150000]) {
    ship.setCruiseSpeed(cruise);
    for (const [id, altitude] of [["earth", 1], ["earth", 50], ["moon", 1], ["jupiter", 1500]]) {
      placeAboveGround(ship, id, altitude);
      assert.equal(ship.engineMode, propulsionBand(cruise).id);
      assert.equal(ship.snapshot().engineMode, propulsionBand(cruise).id);
      assert.equal(ship.cruiseSpeedKm, cruise);
    }
  }
});

test("six-axis thrust approaches each selected band smoothly, boost responds faster and unassisted space inertia persists", () => {
  for (const cruise of [1, 500, 5000, 30000, 150000]) {
    const normal = new ShipDynamics(), boosted = new ShipDynamics();
    for (const ship of [normal, boosted]) {
      ship.position.set(1e6, 0, 0);
      ship.setCruiseSpeed(cruise);
    }
    const thrust = { ...emptyInput(), throttle: 1, strafe: 1, lift: 1 };
    normal.step(0.05, thrust);
    boosted.step(0.05, { ...thrust, boost: true });
    assert(speedKm(normal) > 0 && speedKm(normal) < cruise * 0.1, "first thrust frame must not jump to the target");
    assert(speedKm(boosted) > speedKm(normal) && speedKm(boosted) < cruise);
    assert(normal.velocity.x && normal.velocity.y && normal.velocity.z);
    let previous = speedKm(normal);
    for (let i = 0; i < 280; i++) {
      normal.step(0.05, thrust);
      const speed = speedKm(normal);
      assert(speed >= previous - 1e-8 && speed <= cruise + 1e-8);
      previous = speed;
    }
    assert(Math.abs(speedKm(normal) / cruise - 1) < 0.0001);
    assert.equal(normal.engineMode, propulsionBand(cruise).id);
    assert(validateFlightState(normal.snapshot()));
    normal.assist = false;
    const velocity = normal.velocity.clone(), position = normal.position.clone();
    normal.step(0.05, emptyInput());
    assert(normal.velocity.distanceTo(velocity) < 1e-12);
    assert(normal.position.distanceTo(position.addScaledVector(velocity, 0.05)) < 1e-8);
  }
});

test("powered speed changes are continuous and frame-independent when the target rises or falls", () => {
  const ships = [0.01, 0.05, 0.25].map(dt => ({ ship: new ShipDynamics(), dt }));
  const thrust = { ...emptyInput(), throttle: 1 };
  for (const { ship, dt } of ships) {
    ship.position.set(1e6, 0, 0);
    ship.orientation.identity();
    for (const [target, seconds] of [[1000, 2], [10000, 2], [100, 2]]) {
      const before = ship.velocity.clone();
      assert.equal(ship.setCruiseSpeed(target), null);
      assert(ship.velocity.equals(before), "changing slider target or band must not change the current velocity");
      const rising = speedKm(ship) < target;
      let previous = speedKm(ship);
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        ship.step(dt, thrust);
        const speed = speedKm(ship);
        assert(Number.isFinite(speed));
        if (rising) assert(speed >= previous - 1e-8 && speed <= target + 1e-8);
        else assert(speed <= previous + 1e-8 && speed >= target - 1e-8);
        previous = speed;
      }
      assert(validateFlightState(ship.snapshot()), "a smooth slowdown may legitimately remain above its newly selected target");
    }
  }
  const reference = speedKm(ships[0].ship);
  for (const { ship } of ships.slice(1)) {
    assert(Math.abs(speedKm(ship) - reference) < 1e-7, "speed response must use elapsed time rather than frame count");
    assert(ship.position.distanceTo(ships[0].ship.position) * world.unitsKm < 0.001,
      "the exponential response must integrate the same physical trajectory at different frame sizes");
  }
});

test("Space brakes continuously and S brakes before reversing; idle may remain below the cruise minimum", () => {
  for (const brake of [true, false]) {
    const ship = new ShipDynamics();
    ship.position.set(1e6, 0, 0);
    ship.setCruiseSpeed(400);
    ship.velocity.set(0, 0, -400 / world.unitsKm);
    ship.orientation.identity();
    const slowing = { ...emptyInput(), throttle: brake ? 1 : -1, strafe: 1, lift: 1, boost: true, brake };
    let previous = speedKm(ship);
    for (let i = 0; i < 200; i++) {
      ship.step(0.05, slowing);
      assert(speedKm(ship) <= previous + 1e-8, "combined controls must not reset braking to the cruise value");
      previous = speedKm(ship);
      // S becomes reverse thrust after stopping; release it as soon as the ship reaches rest.
      if (!brake && ship.velocity.length() === 0) break;
    }
    assert.equal(ship.velocity.length(), 0);
    assert.equal(ship.engineMode, "cruise");
    ship.step(0.05, emptyInput());
    assert.equal(ship.velocity.length(), 0, "idle flight must not force a stationary ship to the selectable minimum");
    if (!brake) {
      ship.step(0.05, { ...emptyInput(), throttle: -1 });
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.orientation);
      assert(ship.velocity.dot(forward) < 0, "S remains reverse thrust when used from rest");
      assert(speedKm(ship) > 0 && speedKm(ship) < 400, "reverse thrust must accelerate smoothly from rest");
    }
  }
});

test("backend saves bounded presets, derives the band and migrates legacy speeds without disturbing layout fields", async (t) => {
  const { url } = await fixture(t);
  const cookie = (await fetch(url + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  const ship = new ShipDynamics();
  ship.position.set(1e6, 0, 0);
  ship.setCruiseSpeed(75000);
  ship.setLowFlightSpeed(133);
  ship.velocity.set(100000 / world.unitsKm, 0, 0);
  const saved = ship.snapshot();
  assert.equal(saved.cruiseSpeedKm, 75000);
  assert.equal(saved.lowFlightSpeedMps, 133);
  assert.equal(saved.engineMode, "interstellar");
  const headers = { cookie, "content-type": "application/json" };
  const post = value => fetch(url + "/api/flight/save", { method: "POST", headers, body: JSON.stringify(value) });
  assert.equal((await post(saved)).status, 200);
  for (const patch of [{ cruiseSpeedKm: "100" }, { cruiseSpeedKm: null },
    { lowFlightSpeedMps: "133" }, { lowFlightSpeedMps: null }])
    assert.equal((await post({ ...saved, ...patch })).status, 400);
  for (const field of ["cruiseSpeedKm", "lowFlightSpeedMps"])
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(validateFlightState({ ...saved, [field]: value }), null);
  const hugeVector = validateFlightState({ ...saved, velocity: [Number.MAX_VALUE, Number.MAX_VALUE, 0] });
  assert(hugeVector.velocity.every(Number.isFinite));
  assert(Math.abs(Math.hypot(...hugeVector.velocity) * world.unitsKm - 150000) < 1e-8,
    "legacy finite components whose hypotenuse overflows still normalize safely");
  assert(Math.abs(hugeVector.velocity[0] - hugeVector.velocity[1]) < 1e-8);
  const stored = (await (await fetch(url + "/api/flight/save", { headers: { cookie } })).json()).state;
  assert.deepEqual(stored, saved);
  const restored = new ShipDynamics();
  assert(restored.restore(stored));
  assert.equal(restored.cruiseSpeedKm, 75000);
  assert.equal(restored.lowFlightSpeedMps, 133);
  assert(Math.abs(speedKm(restored) - 100000) < 1e-8,
    "current velocity above a newly reduced target is valid during smooth convergence");
  for (const [cruise, low, expectedCruise, expectedLow] of [[Number.MAX_VALUE, 5000, 150000, 1000], [0, -2, 1, 1]]) {
    const legacy = { ...saved, cruiseSpeedKm: cruise, atmosphericSpeedMps: low,
      engineMode: "atmospheric", escapeBody: "unknown" };
    delete legacy.lowFlightSpeedMps;
    assert.equal((await post(legacy)).status, 200);
    const migrated = (await (await fetch(url + "/api/flight/save", { headers: { cookie } })).json()).state;
    assert.equal(migrated.cruiseSpeedKm, expectedCruise);
    assert.equal(migrated.lowFlightSpeedMps, expectedLow);
    assert.equal(migrated.engineMode, propulsionBand(expectedCruise).id);
    assert.equal(migrated.worldLayoutVersion, saved.worldLayoutVersion);
    assert(!("atmosphericSpeedMps" in migrated));
    assert(!("escapeBody" in migrated));
  }
  const old = { ...saved, engineMode: "standard" };
  delete old.cruiseSpeedKm; delete old.lowFlightSpeedMps;
  const defaults = validateFlightState(old);
  assert.equal(defaults.cruiseSpeedKm, 100);
  assert.equal(defaults.lowFlightSpeedMps, 1000);
  assert.equal(defaults.engineMode, "cruise");
});

test("finite far-space coordinates remain unbounded while saved velocity uses the global cruise ceiling", async (t) => {
  const { url } = await fixture(t);
  const cookie = (await fetch(url + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  const ship = new ShipDynamics();
  ship.position.set(1e18, -2e18, 3e18);
  ship.setCruiseSpeed(150000);
  ship.velocity.set(150000 / world.unitsKm, 0, 0);
  const saved = ship.snapshot();
  assert(validateFlightState(saved), "finite coordinates must not retain the former 1e12 bound");
  const headers = { cookie, "content-type": "application/json" };
  const response = await fetch(url + "/api/flight/save", { method: "POST", headers, body: JSON.stringify(saved) });
  assert.equal(response.status, 200);
  const stored = (await (await fetch(url + "/api/flight/save", { headers: { cookie } })).json()).state;
  assert.deepEqual(stored, saved);
  const restored = new ShipDynamics();
  assert(restored.restore(stored));
  assert.deepEqual(restored.snapshot(), saved);
  const normalized = validateFlightState({ ...saved, velocity: [1e18 / world.unitsKm, 0, 0] });
  assert(Math.abs(Math.hypot(...normalized.velocity) * world.unitsKm - 150000) < 1e-8);
});

test("world uses real solar radii and astronomical distances; compressed saves migrate safely", () => {
  const earth = world.bodies.find((b) => b.id === "earth");
  const sun = world.bodies.find((b) => b.id === "sun");
  const neptune = world.bodies.find((b) => b.id === "neptune");
  assert.equal(earth.radius * world.unitsKm, 6371);
  assert.equal(sun.radius * world.unitsKm, 695700);
  assert(Math.abs(Math.hypot(...earth.position) * world.unitsKm - world.auKm) < 1);
  assert(Math.abs(Math.hypot(...neptune.position) * world.unitsKm - 4495.1e6) < 1);
  const legacy = { ...state(), version: 1, position: [0, 0, 38.2], velocity: [0, 0, -30] };
  const migrated = validateFlightState(legacy);
  assert.equal(migrated.version, 2);
  assert(Math.abs(migrated.position[2] - earth.position[2] + 3.8) < 1e-8);
  assert.deepEqual(migrated.velocity, [0, 0, 0]);
});

test("warp charges, moves continuously, arrives safely and cools down at all nine bodies", () => {
  const ship = new ShipDynamics();
  for (const target of ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "sun", "earth"]) {
    ship.target = target;
    const departure = ship.position.clone();
    const departureSide = ship.targetRelative.negate().normalize();
    assert.equal(ship.startWarp(), null);
    assert.equal(ship.warpPhase, "charging");
    assert.equal(ship.startWarp(), "跃迁引擎正在工作或冷却");
    ship.step(0.05, emptyInput());
    assert(ship.position.equals(departure));
    let sawTransit = false, sawArrival = false, movedInTransit = false;
    for (let i = 0; i < 300 && ship.warpPhase !== "ready"; i++) {
      ship.step(0.05, emptyInput());
      if (ship.warpPhase === "transit") {
        sawTransit = true;
        if (ship.position.distanceTo(departure) > 1) movedInTransit = true;
      }
      if (ship.warpPhase === "arrival") sawArrival = true;
      for (const body of ship.activeBodies) {
        const distance = Math.hypot(...ship.position.toArray().map((n, axis) => n - body.position[axis]));
        assert(distance > body.radius, `route intersects ${body.id}`);
      }
      assert(validateFlightState(ship.snapshot()));
    }
    assert(sawTransit && movedInTransit && sawArrival);
    assert.equal(ship.warpPhase, "ready");
    assertNearbyArrival(ship, departureSide);
    assert.equal(ship.velocity.length(), 0);
  }
});

test("warp routes around the Sun and can be interrupted without losing the actual position", () => {
  const ship = new ShipDynamics();
  const mercury = world.bodies.find((b) => b.id === "mercury");
  ship.position.fromArray(mercury.position).normalize().multiplyScalar(-14000);
  ship.target = "mercury";
  assert.equal(ship.startWarp(), null);
  for (let i = 0; i < 100; i++) {
    ship.step(0.05, emptyInput());
    assert(ship.position.length() > world.bodies[0].radius);
  }
  assert.equal(ship.warpPhase, "transit");
  const midway = ship.position.clone();
  ship.cancelWarp();
  assert.equal(ship.warpPhase, "cooldown");
  assert(ship.position.equals(midway));
  const restored = new ShipDynamics();
  assert(restored.restore(ship.snapshot()));
  assert(restored.position.equals(midway));
});

test("warp may pass through a non-target atmosphere while its continuous route avoids physical bodies", () => {
  for (const source of world.bodies.filter(body => body.atmosphereKm > 1000)) {
    const giant = { ...source, systemId: "solar", position: [0, 0, 0] };
    const impactRadius = giant.radius + (1000 + giant.atmosphereKm) / 2 / world.unitsKm;
    const earth = { ...world.bodies.find(body => body.id === "earth"), position: [100, 0, impactRadius] };
    const ship = new ShipDynamics({ ...world, bodies: [giant, earth] });
    ship.position.set(-100, 0, impactRadius);
    ship.target = "earth";
    assert.equal(ship.startWarp(), null, source.id);
    let previous = ship.position.clone(), crossedAtmosphere = false;
    for (let i = 0; i < 300 && ship.warpPhase !== "ready"; i++) {
      ship.step(0.05, emptyInput());
      const segment = ship.position.clone().sub(previous);
      const center = new THREE.Vector3().fromArray(giant.position);
      const t = segment.lengthSq() ? THREE.MathUtils.clamp(center.clone().sub(previous).dot(segment) / segment.lengthSq(), 0, 1) : 0;
      const nearest = previous.clone().addScaledVector(segment, t).distanceTo(center);
      assert(nearest > giant.radius, `${source.id}: a warp route must avoid the physical giant`);
      if (nearest < giant.radius + giant.atmosphereKm / world.unitsKm) crossedAtmosphere = true;
      previous.copy(ship.position);
    }
    assert.equal(ship.warpPhase, "ready", source.id);
    assert(crossedAtmosphere, "a safe straight route through atmosphere must not detour around an obsolete safety bubble");
  }
});

test("warp can depart near terrain, inside atmospheres and beside its selected target while state gates still reject re-entry", () => {
  for (const [id, groundAltitude, target] of [["earth", 0.1, "mars"], ["earth", 50, "earth"],
    ["earth", 500, "earth"], ["moon", 1, "earth"], ["jupiter", 1500, "mars"]]) {
    const ship = new ShipDynamics();
    const body = world.bodies.find(candidate => candidate.id === id);
    const destination = world.bodies.find(candidate => candidate.id === target);
    const normal = id === "earth" && target === "mars"
      ? new THREE.Vector3().fromArray(body.position).sub(new THREE.Vector3().fromArray(destination.position)).normalize()
      : new THREE.Vector3(0, 0, 1);
    placeAboveGround(ship, id, groundAltitude, normal);
    ship.target = target;
    const before = ship.snapshot();
    assert.equal(ship.warpBlockReason, null);
    assert.equal(ship.startWarp(), null, `${id} ${groundAltitude} km toward ${target}`);
    assert.equal(ship.warpPhase, "charging");
    assert(ship.startWarp(), "charging remains mutually exclusive");
    ship.step(0.05, emptyInput());
    assert.deepEqual(ship.position.toArray(), before.position, "charging must not teleport the near-ground departure");
    for (let i = 0; i < 400 && ship.warpPhase !== "ready"; i++) {
      ship.step(0.05, emptyInput());
      for (const obstacle of ship.activeBodies) assertOutsideEntity(ship.position, obstacle);
      assert(validateFlightState(ship.snapshot()));
    }
    assert.equal(ship.warpPhase, "ready");
  }
  const cancelled = new ShipDynamics();
  assert.equal(cancelled.startWarp(), null);
  cancelled.cancelWarp();
  const checkpoint = cancelled.snapshot();
  assert(cancelled.startWarp(), "cooldown still blocks immediate reuse");
  assert.deepEqual(cancelled.snapshot(), checkpoint);
});

test("only solid terrain within ten kilometres uses the separate low-flight preset", () => {
  for (const [id, groundAltitude, low] of [["earth", 1, true], ["earth", 10, true],
    ["earth", 10.001, false], ["earth", 50, false], ["moon", 1, true],
    ["moon", 10.001, false], ["jupiter", 1, false], ["jupiter", 1500, false]]) {
    const ship = new ShipDynamics();
    placeAboveGround(ship, id, groundAltitude);
    faceOutward(ship);
    ship.setCruiseSpeed(5000);
    ship.setLowFlightSpeed(133);
    assert.equal(ship.environment.lowFlight, low, `${id}, true ground clearance ${groundAltitude}`);
    assert(Math.abs(ship.speedLimit * world.unitsKm - (low ? 0.133 : 5000)) < 1e-8);
    assert.equal(ship.engineMode, "transfer", "the space band stays tied to its preserved preset");
    ship.step(0.01, { ...emptyInput(), throttle: 1 });
    assert(speedKm(ship) > 0 && speedKm(ship) < (low ? 0.133 : 5000));
    assert.equal(ship.cruiseSpeedKm, 5000);
    assert.equal(ship.lowFlightSpeedMps, 133);
    assert.equal(ship.collision, null);
  }
});

test("space and low-flight controls enforce their ranges without changing current velocity", () => {
  const ship = new ShipDynamics();
  ship.position.set(1e6, 0, 0);
  ship.velocity.set(10000 / world.unitsKm, 0, 0);
  const original = ship.velocity.clone();
  for (const value of [1, 50.5, 100, 1000, 10000, 50000, 150000]) {
    assert.equal(ship.setCruiseSpeed(value), null);
    assert.equal(ship.cruiseSpeedKm, value);
    assert.equal(ship.engineMode, propulsionBand(value).id);
    assert(ship.velocity.equals(original));
  }
  for (const value of [0.999, 0, -100, 150000.001, Number.MAX_VALUE, NaN, Infinity, -Infinity, "100"]) {
    assert(ship.setCruiseSpeed(value));
    assert.equal(ship.cruiseSpeedKm, 150000);
    assert(ship.velocity.equals(original));
  }
  for (const value of [1, 133, 1000]) {
    assert.equal(ship.setLowFlightSpeed(value), null);
    assert.equal(ship.lowFlightSpeedMps, value);
    assert(ship.velocity.equals(original));
  }
  for (const value of [0.999, 0, -1, 1000.001, NaN, Infinity, "133"]) {
    assert(ship.setLowFlightSpeed(value));
    assert.equal(ship.lowFlightSpeedMps, 1000);
    assert(ship.velocity.equals(original));
  }
  for (const band of PROPULSION_BANDS) {
    assert.equal(ship.setEngineMode(band.id), null);
    assert.equal(ship.cruiseSpeedKm, band.minKm);
    assert.equal(ship.engineMode, band.id);
    assert(ship.velocity.equals(original), "compatibility band selection also changes only the target");
  }
});

test("one metre per second is reachable with total-vector thrust, responds smoothly to low-flight changes and can stop", () => {
  const ship = new ShipDynamics();
  placeAboveGround(ship, "earth", 1);
  ship.setLowFlightSpeed(1);
  const thrust = { ...emptyInput(), throttle: 1, strafe: 1, lift: 1 };
  let previous = 0;
  for (let i = 0; i < 300; i++) {
    ship.step(0.05, thrust);
    const speedMps = speedKm(ship) * 1000;
    assert(speedMps >= previous - 1e-7 && speedMps <= 1 + 1e-7);
    previous = speedMps;
  }
  assert(Math.abs(speedKm(ship) * 1000 - 1) < 0.0001);
  const before = ship.velocity.clone();
  ship.setLowFlightSpeed(133);
  assert(ship.velocity.equals(before));
  ship.step(0.05, thrust);
  assert(speedKm(ship) * 1000 > 1 && speedKm(ship) * 1000 < 133);
  const active = speedKm(ship);
  ship.step(0.05, emptyInput());
  assert(speedKm(ship) < active, "releasing thrust must restore assisted drag");
  for (let i = 0; i < 100; i++) ship.step(0.05, { ...thrust, brake: true });
  assert.equal(ship.velocity.length(), 0, "braking and standing still may be below the selected minimum");
  assert(validateFlightState(ship.snapshot()));
});

test("a long manual frame enters the true ten-kilometre layer before spending its remaining time at low speed", () => {
  for (const [id, normal] of [["earth", new THREE.Vector3(0, 0, 1)],
    ["earth", mappedMountainNormal()], ["moon", new THREE.Vector3(0, 0, 1)]]) {
    const ship = new ShipDynamics();
    placeAboveGround(ship, id, 10.2, normal);
    ship.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal.clone().negate());
    ship.setCruiseSpeed(100);
    ship.setLowFlightSpeed(1000);
    ship.velocity.copy(normal).multiplyScalar(-100 / world.unitsKm);
    const start = ship.position.clone();
    ship.step(0.25, { ...emptyInput(), throttle: 1 });
    assert(Math.abs(ship.position.distanceTo(start) * world.unitsKm - 0.448) < 0.00002,
      "200 m use the space preset; the other 248 ms use one kilometre per second");
    assert(Math.abs(ship.environment.groundAltitudeKm - 9.752) < 0.00002);
    assert(Math.abs(speedKm(ship) - 1) < 1e-8);
    assert.equal(ship.cruiseSpeedKm, 100);
    assert.equal(ship.lowFlightSpeedMps, 1000);
    assert.equal(ship.engineMode, "cruise");
    assert.equal(ship.collision, null);
  }
});

test("leaving the true ten-kilometre layer restores the space target with gradual acceleration during the remaining frame", () => {
  const long = new ShipDynamics(), short = new ShipDynamics();
  for (const ship of [long, short]) {
    placeAboveGround(ship, "moon", 9.9);
    faceOutward(ship);
    ship.setCruiseSpeed(100);
    ship.setLowFlightSpeed(1000);
    ship.velocity.copy(ship.environment.outward).multiplyScalar(1 / world.unitsKm);
  }
  const start = long.position.clone(), thrust = { ...emptyInput(), throttle: 1 };
  long.step(0.25, thrust);
  for (let i = 0; i < 25; i++) short.step(0.01, thrust);
  assert(long.environment.groundAltitudeKm > 10);
  assert(speedKm(long) > 1 && speedKm(long) < 30, "restoring the space target must not jump straight to 100 km/s");
  assert(long.position.distanceTo(start) * world.unitsKm > 0.25,
    "the portion after crossing must accelerate beyond the low-flight preset");
  assert(Math.abs(speedKm(long) - speedKm(short)) < 0.0001);
  assert(long.position.distanceTo(short.position) * world.unitsKm < 0.001);
  assert.equal(long.cruiseSpeedKm, 100);
  assert.equal(long.lowFlightSpeedMps, 1000);
});

test("a mountain crossing uses the terrain's real ten-kilometre boundary instead of a global maximum-height shell", () => {
  const fixture = mountainTraverse(mountainTraverse().heightKm + 10);
  assert(fixture.clearance[0] > 10.2 && fixture.clearance.at(-1) > 10.2);
  assert(Math.min(...fixture.clearance) < 9.8);
  const ship = new ShipDynamics();
  placeOnTraverse(ship, fixture);
  ship.setLowFlightSpeed(1000);
  const start = ship.position.clone();
  assert(!ship.environment.lowFlight);
  ship.step(0.05, { ...emptyInput(), throttle: 1 });
  const movedKm = ship.position.distanceTo(start) * world.unitsKm;
  assert(movedKm > 2 && movedKm < 3,
    "space-speed motion must first reach the intermediate real ridge's 10 km layer");
  assert(ship.environment.lowFlight);
  assert(ship.environment.groundAltitudeKm < 10 && ship.environment.groundAltitudeKm > 9.9);
  assert(Math.abs(speedKm(ship) - 1) < 1e-8);
  assert.equal(ship.collision, null);
  assert.equal(ship.cruiseSpeedKm, 200);
});

test("a swept atmosphere crossing preserves the user speed and slow frame integration retains elapsed time", () => {
  const ship = new ShipDynamics();
  placeAboveGround(ship, "earth", 200);
  ship.assist = false;
  ship.orientation.identity();
  ship.setCruiseSpeed(500);
  ship.velocity.set(0, 0, -500 / world.unitsKm);
  const previous = ship.position.clone();
  ship.step(0.25, { ...emptyInput(), throttle: 1 });
  assert.equal(ship.elapsed, 0.25);
  assert(ship.environment.atmospheric);
  assert(ship.environment.groundAltitudeKm > 50);
  assert(Math.abs(speedKm(ship) - 500) < 1e-8);
  assert(Math.abs(ship.position.distanceTo(previous) * world.unitsKm - 125) < 1e-6,
    "crossing the old safety or atmospheric shell must not shorten the actual path");
  const a = new ShipDynamics(), b = new ShipDynamics();
  a.position.set(1e6, 0, 0); b.position.copy(a.position);
  const input = { ...emptyInput(), throttle: 1, yaw: 0.7 };
  a.step(0.25, input);
  for (let i = 0; i < 5; i++) b.step(0.05, input);
  assert(a.position.distanceTo(b.position) < 1e-10);
  assert(a.orientation.angleTo(b.orientation) < 1e-7);
});

test("assisted flight follows the heading, turns ease out, and S brakes before reversing", () => {
  const assisted = new ShipDynamics(), inertial = new ShipDynamics();
  for (const ship of [assisted, inertial]) {
    ship.position.set(1e6, 0, 0);
    ship.setCruiseSpeed(1000);
    ship.orientation.identity();
    ship.velocity.set(0, 0, -1000 / world.unitsKm);
  }
  inertial.assist = false;
  for (let i = 0; i < 30; i++) {
    assisted.step(0.05, { ...emptyInput(), yaw: 0.7 });
    inertial.step(0.05, { ...emptyInput(), yaw: 0.7 });
  }
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(assisted.orientation);
  assert(assisted.velocity.clone().normalize().dot(forward) > 0.95);
  assert(inertial.velocity.clone().normalize().dot(forward) < 0.5);
  const turn = assisted.angularVelocity.length();
  assisted.step(0.05, emptyInput());
  assert(assisted.angularVelocity.length() > 0 && assisted.angularVelocity.length() < turn);
  for (let i = 0; i < 30; i++) assisted.step(0.05, emptyInput());
  assert(assisted.angularVelocity.length() < 1e-5);
  assisted.orientation.identity();
  assisted.velocity.set(0, 0, -1000 / world.unitsKm);
  assisted.step(0.25, { ...emptyInput(), throttle: -1 });
  assert(assisted.velocity.z < 0 && assisted.velocity.length() * world.unitsKm < 600);
});

test("target projection uses the current camera turn and places off-screen and behind targets at screen edges", () => {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.01, 200);
  const target = new THREE.Vector3(0, 0, -10);
  let projected = projectFlightTarget(target, camera);
  assert.equal(projected.targetX, 50); assert.equal(projected.targetY, 50);
  assert(projected.inView);
  camera.rotation.y = 0.2;
  projected = projectFlightTarget(target, camera);
  assert(projected.inView && projected.targetX > 55);
  camera.rotation.y = 0;
  for (const target of [new THREE.Vector3(100, 20, -10), new THREE.Vector3(0, 0, 10), new THREE.Vector3(-10, 2, 10)]) {
    const marker = projectFlightTarget(target, camera);
    assert.equal(marker.inView, false);
    assert(Number.isFinite(marker.angle));
    assert(marker.targetX >= 6 - 1e-9 && marker.targetX <= 94 + 1e-9);
    assert(marker.targetY >= 14 - 1e-9 && marker.targetY <= 86 + 1e-9);
    assert(Math.abs(marker.targetX - 50) >= 43.99 || Math.abs(marker.targetY - 50) >= 35.99);
  }
});


test("the legacy orbital shortcut does not alter speed presets or create a launch permission", () => {
  for (const [id, altitude] of [["earth", 1], ["earth", 50], ["moon", 1], ["jupiter", 1500]]) {
    const ship = new ShipDynamics();
    placeAboveGround(ship, id, altitude);
    ship.setCruiseSpeed(5000);
    ship.setLowFlightSpeed(133);
    const before = ship.snapshot();
    assert.equal(ship.orbitalBlockReason, null);
    assert.equal(ship.startOrbitalEngine(), null);
    assert.deepEqual(ship.snapshot(), before);
    assert.equal(ship.orbitalEngineActive, false);
  }
});

test("propulsion target changes preserve the mutual exclusion between automatic landing and warp", () => {
  const descending = new ShipDynamics();
  placeAboveGround(descending, "earth", 1);
  assert.equal(descending.startLanding(), null);
  assert.equal(descending.setCruiseSpeed(5000), null);
  assert.equal(descending.setLowFlightSpeed(133), null);
  assert.equal(descending.landingPhase, "descending");
  assert(descending.startWarp());
  const warping = new ShipDynamics();
  assert.equal(warping.startWarp(), null);
  assert.equal(warping.setCruiseSpeed(5000), null);
  assert.equal(warping.warpPhase, "charging");
  assert(warping.startLanding());
});

test("all 26 moons have real parent-relative distances, valid saves and safe warp destinations", () => {
  const moons = JSON.parse(readFileSync(new URL("../shared/moons.json", import.meta.url), "utf8"));
  assert.equal(moons.length, 26);
  assert.equal(new Set(world.bodies.filter(body => bodySystem(body) === "solar").map(body => body.id)).size, 37);
  const ship = new ShipDynamics();
  for (const moon of moons) {
    const body = world.bodies.find(body => body.id === moon.id);
    const parent = world.bodies.find(body => body.id === moon.parentId);
    assert(Math.abs(body.radius * world.unitsKm - moon.radiusKm) < 1e-6);
    assert(Math.abs(Math.hypot(...body.position.map((n, axis) => n - parent.position[axis])) * world.unitsKm - moon.orbitRadiusKm) < 1e-5);
    ship.jump("earth");
    ship.target = moon.id;
    const departureSide = ship.targetRelative.negate().normalize();
    assert.equal(ship.startWarp(), null, moon.id);
    for (let i = 0; i < 300 && ship.warpPhase !== "ready"; i++) {
      ship.step(0.05, emptyInput());
      for (const obstacle of ship.activeBodies) {
        assert(ship.position.distanceTo(new THREE.Vector3().fromArray(obstacle.position)) > obstacle.radius, `moon route intersects ${obstacle.id}`);
      }
    }
    assert.equal(ship.warpPhase, "ready");
    assertNearbyArrival(ship, departureSide);
    assert.equal(ship.environment.body.id, moon.id);
    assert(ship.environment.altitudeKm >= 1099.99);
    assert(validateFlightState(ship.snapshot()));
    assert.equal(validateFlightState({ ...ship.snapshot(), version: 1 }), null);
  }
});

test("braking generates a decaying visual pulse; ordinary assisted drift does not", () => {
  const ship = new ShipDynamics();
  ship.position.set(1e6, 0, 0);
  ship.setCruiseSpeed(world.unitsKm);
  ship.velocity.set(0, 0, -1);
  ship.step(0.05, emptyInput());
  assert.equal(ship.deceleration, 0);
  ship.step(0.05, { ...emptyInput(), brake: true });
  assert(ship.deceleration > 0.5);
  const peak = ship.deceleration;
  ship.step(0.25, emptyInput());
  assert(ship.deceleration > 0 && ship.deceleration < peak);
});


test("former thousand-kilometre and giant-atmosphere protection zones do not use the solid low-flight preset", () => {
  for (const [id, altitude] of [["earth", 500], ["jupiter", 1500]]) {
    const ship = new ShipDynamics();
    placeAboveGround(ship, id, altitude);
    faceOutward(ship);
    ship.setCruiseSpeed(700);
    ship.setLowFlightSpeed(1);
    assert(!ship.environment.lowFlight);
    assert.equal(ship.engineMode, "cruise");
    assert(Math.abs(ship.speedLimit * world.unitsKm - 700) < 1e-8);
    ship.step(0.05, { ...emptyInput(), throttle: 1 });
    assert(speedKm(ship) > 1 && speedKm(ship) < 700);
    assert.equal(ship.startWarp(), null);
  }
});

test("three Centauri stars and their planets use local coordinates and light-year navigation", () => {
  assert.equal(world.systems.length, 7);
  assert.equal(world.bodies.length, 56);
  const ship = new ShipDynamics();
  ship.target = "alpha-centauri-a";
  assert(Math.abs(ship.targetRelative.length() * world.unitsKm / world.lightYearKm - 4.37) < 0.001);
  const a = world.bodies.find(body => body.id === "alpha-centauri-a");
  const b = world.bodies.find(body => body.id === "alpha-centauri-b");
  assert(Math.abs(Math.hypot(...a.position.map((value, axis) => value - b.position[axis])) * world.unitsKm / world.auKm - 23.4) < 1e-8);
  assert.equal(a.kind, "star");
  ship.jump("proxima-b");
  assert.equal(ship.systemId, "proxima-centauri");
  assert.equal(ship.environment.body.id, "proxima-b");
  assert(ship.position.length() < 2000, "arrival coordinates stay precise and local");
  assert(validateFlightState(ship.snapshot()));
});

test("warps reach all Centauri bodies and return to Earth; transit snapshots remain restorable and routes avoid local stars", () => {
  const ship = new ShipDynamics();
  for (const target of ["alpha-centauri-a", "alpha-centauri-b", "proxima-centauri", "proxima-b", "proxima-d", "proxima-c", "betelgeuse", "earth"]) {
    ship.target = target;
    const departureSide = ship.targetRelative.negate().normalize();
    assert.equal(ship.startWarp(), null, target);
    let sawNewSystem = false;
    for (let i = 0; i < 320 && ship.warpPhase !== "ready"; i++) {
      ship.step(0.05, emptyInput());
      assert(validateFlightState(ship.snapshot()), `invalid transit save: ${target}`);
      if (ship.systemId !== "solar") sawNewSystem = true;
      for (const obstacle of ship.activeBodies) {
        assert(ship.position.distanceTo(new THREE.Vector3().fromArray(obstacle.position)) > obstacle.radius, `route intersects ${obstacle.id}`);
      }
    }
    assert.equal(ship.warpPhase, "ready");
    assertNearbyArrival(ship, departureSide);
    assert.equal(ship.environment.body.id, target);
    const restored = new ShipDynamics();
    assert(restored.restore(ship.snapshot()));
    assert.equal(restored.systemId, ship.systemId);
    assert(restored.position.equals(ship.position));
    if (target !== "earth") assert(sawNewSystem);
  }
});

test("Betelgeuse is a star-only red-supergiant system with real scale and restorable local coordinates", async (t) => {
  const bodies = world.bodies.filter(body => body.systemId === "betelgeuse");
  assert.deepEqual(bodies.map(body => body.id), ["betelgeuse"]);
  const star = bodies[0];
  assert.equal(star.kind, "star");
  assert(Math.abs(star.radius * world.unitsKm / 695700 - 764) < 1e-8);
  const ship = new ShipDynamics();
  ship.target = "betelgeuse";
  assert(Math.abs(ship.targetRelative.length() * world.unitsKm / world.lightYearKm - 548) < 0.001);
  ship.jump("betelgeuse");
  assert.match(ship.startLanding(), /恒星无法着陆/);
  const { url } = await fixture(t);
  const cookie = (await fetch(url + "/api/flight/save")).headers.get("set-cookie").split(";")[0];
  const saved = ship.snapshot();
  assert.equal((await fetch(url + "/api/flight/save", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(saved) })).status, 200);
  const stored = (await (await fetch(url + "/api/flight/save", { headers: { cookie } })).json()).state;
  const restored = new ShipDynamics();
  assert(restored.restore(stored));
  assert.equal(restored.systemId, "betelgeuse");
  assert.equal(restored.target, "betelgeuse");
  assert(restored.position.equals(ship.position));
  restored.position.set(0, 0, 0);
  restored.step(0.05, emptyInput());
  assert(restored.position.length() >= star.radius, "entity collision keeps the ship out of the photosphere");
  assert(restored.position.length() < star.radius * 1.0001, "the removed stellar protection bubble must not displace the ship far from the physical surface");
});

test("cancelling an interstellar warp preserves its coordinate frame and old saves default to the solar frame", () => {
  const ship = new ShipDynamics();
  ship.target = "proxima-b";
  assert.equal(ship.startWarp(), null);
  for (let i = 0; i < 130; i++) ship.step(0.05, emptyInput());
  assert.equal(ship.warpPhase, "transit");
  assert.equal(ship.systemId, "proxima-centauri");
  const saved = ship.snapshot();
  assert(Math.hypot(...saved.position) > 1e8);
  ship.cancelWarp();
  const restored = new ShipDynamics();
  assert(restored.restore(saved));
  assert.equal(restored.systemId, saved.systemId);
  assert(restored.position.equals(ship.position));
  for (let i = 0; i < 60; i++) ship.step(0.05, emptyInput());
  assert.equal(ship.startWarp(), null);
  const old = state(); delete old.systemId;
  assert.equal(validateFlightState(old).systemId, "solar");
  assert.equal(validateFlightState({ ...saved, systemId: "missing-system" }), null);
  assert.equal(validateFlightState({ ...saved, version: 1 }), null);
});

test("an atmospheric Proxima departure may immediately warp to an interstellar target", () => {
  const ship = new ShipDynamics();
  placeAboveGround(ship, "proxima-b", 1);
  ship.target = "earth";
  assert(ship.environment.atmospheric);
  assert.equal(ship.warpBlockReason, null);
  assert.equal(ship.startWarp(), null);
  for (let i = 0; i < 400 && ship.warpPhase !== "ready"; i++) ship.step(0.05, emptyInput());
  assert.equal(ship.warpPhase, "ready");
  assert.equal(ship.systemId, "solar");
  assert.equal(ship.environment.body.id, "earth");
});

function assertOutsideEntity(position, body) {
  const offset = position.clone().sub(new THREE.Vector3().fromArray(body.position));
  const distance = offset.length();
  const surface = surfaceProfile(body.id).solid
    ? terrainHeightKm(body.id, offset.clone().normalize().toArray()) + LANDING_CLEARANCE_KM : 0;
  const clearance = (distance - body.radius) * world.unitsKm - surface;
  assert(clearance >= -0.0001, `warp intersects physical ${body.id}`);
}

function assertNearbyArrival(ship, departureSide) {
  const target = world.bodies.find(body => body.id === ship.target);
  assert.equal(ship.systemId, bodySystem(target));
  const radial = ship.position.clone().sub(new THREE.Vector3().fromArray(target.position)).normalize();
  assert(radial.dot(departureSide) > 0.999999, `${target.id}: arrival must preserve the departure side`);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.orientation);
  assert(forward.dot(radial) < -0.99, `${target.id}: planet must remain ahead after arrival`);
  assert(ship.environment.altitudeKm >= 1099.99);
}

test("left, right and polar arrivals brake continuously with a fixed attitude", () => {
  const earth = world.bodies.find(body => body.id === "earth");
  for (const side of [new THREE.Vector3(-1,0,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)]) {
    const ship = new ShipDynamics();
    ship.position.fromArray(earth.position).addScaledVector(side,15);
    if(side.z===1) ship.orientation.setFromUnitVectors(new THREE.Vector3(0,1,0),side);
    ship.target = "earth";
    assert.equal(ship.startWarp(),null);
    let arrivalStart, lastArrivalSpeed = Infinity, arrivalMovement = 0, lastTransitSpeed;
    for (let i=0; i<1500 && ship.warpPhase!=="cooldown"; i++) {
      const before = ship.warpPhase, previous = ship.position.clone(), facing = ship.orientation.clone();
      ship.step(0.01,emptyInput());
      if (before==="transit") lastTransitSpeed = ship.warpSpeedKm;
      if (before==="transit" && ship.warpPhase==="arrival") arrivalStart=ship.position.clone();
      if (before==="arrival") {
        arrivalMovement+=ship.position.distanceTo(previous);
        assert(ship.warpSpeedKm<=lastArrivalSpeed+1e-6,"arrival speed must decrease");
        if(lastArrivalSpeed===Infinity) assert(Math.abs(ship.warpSpeedKm-lastTransitSpeed)/lastTransitSpeed<0.04);
        lastArrivalSpeed=ship.warpSpeedKm;
        assert(ship.orientation.equals(facing),"arrival must not turn or level the ship");
        assert(ship.position.distanceTo(new THREE.Vector3().fromArray(earth.position))>1.17);
      }
    }
    assert.equal(ship.warpPhase,"cooldown");
    assert(arrivalStart && arrivalMovement>0.3);
    assertNearbyArrival(ship,side);
    assert(Math.abs(ship.environment.altitudeKm-1100)<1e-5);
    assert.equal(ship.warpSpeedKm,0);
  }
});

test("cancelling the arrival approach preserves position, orientation and a valid snapshot", () => {
  const ship = new ShipDynamics(); ship.target="mars";
  assert.equal(ship.startWarp(),null);
  while(ship.warpPhase!=="arrival") ship.step(0.05,emptyInput());
  ship.step(0.25,emptyInput());
  const position=ship.position.clone(),orientation=ship.orientation.clone();
  ship.cancelWarp();
  assert(ship.position.equals(position)); assert(ship.orientation.equals(orientation));
  const restored=new ShipDynamics(); assert(restored.restore(ship.snapshot()));
  assert(restored.position.equals(position)); assert.equal(ship.warpSpeedKm,0);
});

test("a distant planet grows continuously across the whole approach, including slow frames", () => {
  const earth = world.bodies.find(body => body.id === "earth");
  const center = new THREE.Vector3().fromArray(earth.position);
  for (const dt of [1 / 60, 0.1, 0.25]) {
    const ship = new ShipDynamics();
    ship.position.copy(center).add(new THREE.Vector3(0, 0, 256));
    ship.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4);
    const attitude = ship.orientation.clone();
    ship.target = "earth";
    assert.equal(ship.startWarp(), null);
    while (ship.warpPhase !== "arrival") ship.step(dt, emptyInput());
    const entryAngle = Math.asin(earth.radius / ship.position.distanceTo(center));
    assert(entryAngle < 0.04, "braking must begin with a small planet, not a screen-filling globe");
    let previousAngle = entryAngle, previousSpeed = ship.warpSpeedKm, quarter = 0, halfway = 0;
    while (ship.warpPhase === "arrival") {
      const previousPosition = ship.position.clone();
      ship.step(dt, emptyInput());
      const angle = Math.asin(earth.radius / ship.position.distanceTo(center));
      assert(angle >= previousAngle, "planet must never shrink during approach");
      assert(angle - previousAngle < 0.18, "even a 250 ms frame must not jump from a dot to a large planet");
      assert(ship.position.distanceTo(previousPosition) <= previousSpeed * dt / world.unitsKm + 1e-8,
        "phase changes must not teleport the ship");
      assert(ship.warpSpeedKm <= previousSpeed + 1e-6);
      assert(ship.orientation.angleTo(attitude) < 1e-7, "keep the pilot's roll, with no final attitude adjustment");
      if (ship.warpProgress >= 0.25 && !quarter) quarter = angle;
      if (ship.warpProgress >= 0.5 && !halfway) halfway = angle;
      previousAngle = angle; previousSpeed = ship.warpSpeedKm;
    }
    assert(quarter > entryAngle * 3, "the zoom must already be visible in the first quarter");
    assert(halfway > quarter * 2 && halfway < previousAngle * 0.6, "growth must continue through both halves");
    assert(previousAngle > entryAngle * 25);
    assert(Math.abs(ship.environment.altitudeKm - 1100) < 1e-5);
    assert.equal(ship.warpSpeedKm, 0);
  }
});

test("a warp already inside the arrival margin preserves attitude and eases out to safety", () => {
  const earth = world.bodies.find(body => body.id === "earth");
  const ship = new ShipDynamics();
  ship.position.fromArray(earth.position).add(new THREE.Vector3(0, 0, earth.radius + 1001 / world.unitsKm));
  ship.orientation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
  const facing = ship.orientation.clone();
  ship.target = "earth";
  assert.equal(ship.startWarp(), null);
  for (let i = 0; i < 200 && ship.warpPhase !== "ready"; i++) {
    ship.step(0.05, emptyInput());
    assert(ship.orientation.angleTo(facing) < 1e-7);
    assert(ship.environment.altitudeKm >= 1001 - 1e-5);
  }
  assert.equal(ship.warpPhase, "ready");
  assert(Math.abs(ship.environment.altitudeKm - 1100) < 1e-5);
});

test("physical hull length is 10 km, small beside Earth's diameter", () => {
  const model=createShip();
  const scale=SHIP_LENGTH_KM/(world.unitsKm*model.hullLength);
  model.group.scale.setScalar(scale); model.group.updateMatrixWorld(true);
  const hull=new THREE.Box3();
  for (const mesh of model.group.children.filter(child=>child instanceof THREE.Mesh)) hull.expandByObject(mesh);
  assert(Math.abs((hull.max.z-hull.min.z)*world.unitsKm-10)<1e-5);
  assert((hull.max.z-hull.min.z)/2<0.012);
});

test("render budget lowers sustained slow resolution and recovers slowly within its ceiling", () => {
  const budget=new RenderBudget(); budget.configure(true,3,1920,1080);
  assert(budget.ratio<=1.5); assert(1920*1080*budget.ratio**2<=2100000.01);
  const initial=budget.ratio;
  for(let i=0;i<240;i++)budget.sample(1/30);
  assert(budget.ratio<initial);assert(budget.ratio>=0.25);
  const low=budget.ratio;
  for(let i=0;i<120;i++)budget.sample(1/60);
  assert(budget.ratio<=low);
  for(let i=0;i<3000;i++)budget.sample(1/60);
  assert(budget.ratio>low);assert(budget.ratio<=initial);
  const previous=budget.ratio;budget.sample(0);budget.sample(5);assert.equal(budget.ratio,previous);
  const jitter=new RenderBudget();jitter.configure(true,1,1440,960);
  const sharp=jitter.ratio;
  for(let i=0;i<600;i++)jitter.sample(i%15===0?1/30:1/60);
  assert(jitter.ratio<sharp,"regular missed frames must reduce resolution even with a decent average FPS");
});

test("ultra quality preserves a 4K viewport and restores still-image detail after load", () => {
  const budget = new RenderBudget();
  budget.configure("ultra", 2, 3840, 2160);
  assert(budget.ratio >= 1, "4K screens should render at their native resolution");
  assert(3840 * 2160 * budget.ratio ** 2 <= 8_300_000.01);
  for (let i = 0; i < 240; i++) budget.sample(1 / 30);
  assert(budget.ratio < 1);
  assert(budget.rest());
  assert(budget.ratio >= 1);
  budget.configure("standard", 2, 3840, 2160);
  assert(3840 * 2160 * budget.ratio ** 2 <= 1_200_000.01);
});

test("holding S reverses promptly after near-surface slowdown at every engine preset", () => {
  for (const assist of [true, false]) for (const preset of [1, 1000]) for (const dt of [1 / 120, 1 / 30, 0.05]) {
    const ship = new ShipDynamics();
    placeAboveGround(ship, "earth", 8);
    ship.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), ship.environment.outward.clone().negate());
    ship.assist = assist;
    ship.lowFlightSpeedMps = preset;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.orientation);
    ship.velocity.copy(forward).multiplyScalar(preset / 1000 / world.unitsKm);
    const start = ship.position.clone();
    for (let elapsed = 0; elapsed < 2; elapsed += dt) ship.step(dt, { ...emptyInput(), throttle: -1 });
    assert(ship.velocity.dot(forward) < 0, "continuous S must switch from braking to reverse within two seconds");
    for (let elapsed = 0; elapsed < 2; elapsed += dt) ship.step(dt, { ...emptyInput(), throttle: -1 });
    assert(ship.position.clone().sub(start).dot(forward) < 0, `reverse displacement assist=${assist} preset=${preset} dt=${dt}: ${ship.position.clone().sub(start).dot(forward)}`);
  }
});
