import { test } from "node:test";
import assert from "node:assert/strict";
import { world, validateFlightState, validateStationVisitState } from "../shared/flight-state.mjs";
import { stationWalkable, STATION_SPAWN } from "../shared/station-layout.mjs";
import { ShipDynamics } from "../src/ship-dynamics.ts";

const station = world.bodies.find(body => body.id === "earth-station");
const earth = world.bodies.find(body => body.id === "earth");
const atDistance = (distanceKm, center = station.position, direction = [0, 0, 1]) =>
  center.map((n, i) => n + direction[i] * distanceKm / world.unitsKm);
const visit = (extra = {}) => ({ bodyId: "earth-station", positionM: [...STATION_SPAWN], yaw: .3, pitch: -.2, camera: "first", ...extra });
const savedFlight = (extra = {}) => ({
  version: 2, coordinateVersion: 1, worldLayoutVersion: world.layoutVersion,
  referenceFrame: { kind: "system" }, systemId: "solar",
  position: atDistance(station.radius * world.unitsKm + 200), velocity: [0, 0, 0],
  orientation: [0, 0, 0, 1], target: "earth-station", camera: "chase", assist: true,
  elapsed: 12, ...extra,
});

test("station approach reference migration survives a changed navigation target", () => {
  const oldWorld = structuredClone(world);
  oldWorld.layoutVersion = 2;
  const oldStation = oldWorld.bodies.find(body => body.id === "earth-station");
  oldStation.position = [...station.previousPosition];
  oldStation.radius = 60 / world.unitsKm;
  const ship = new ShipDynamics(oldWorld);
  ship.jump("earth-station");
  ship.target = "earth";
  const source = ship.snapshot(), original = structuredClone(source);
  assert.equal(source.referenceFrame.bodyId, "earth");
  const normalized = validateFlightState(source);
  assert(normalized, "retargeted station approach remains a valid save");
  const expected = source.position.map((n, i) => n + station.position[i] - station.previousPosition[i]);
  assert(Math.hypot(...normalized.position.map((n, i) => n - expected[i])) < 1e-8);
  assert.equal(normalized.target, "earth");
  assert.deepEqual(validateFlightState(normalized), normalized);
  assert.deepEqual(source, original);
  const restored = new ShipDynamics();
  assert(restored.restore(normalized));
  assert.deepEqual(restored.position.toArray(), normalized.position);
});

test("room visit saves retain metre-scale pose and camera across normalization and ship restore", () => {
  for (const positionM of [[0, 0, 24], [0, 0, 12], [0, 0, -18], [-6, 0, -24], [3, 0, 0], [15, 0, 0]]) {
    for (const camera of ["first", "third"]) {
      assert(stationWalkable(positionM), "connected room seams remain open");
      const source = savedFlight({ stationVisit: visit({ positionM, camera }) });
      const original = structuredClone(source), normalized = validateFlightState(source);
      assert(normalized);
      assert.deepEqual(normalized.stationVisit, source.stationVisit);
      assert.deepEqual(source, original, "validation never modifies its source");
      assert.deepEqual(validateFlightState(normalized), normalized, "visit normalization is idempotent");
      assert.notEqual(normalized.stationVisit.positionM, source.stationVisit.positionM);
      const ship = new ShipDynamics();
      assert(ship.restore(normalized), "parked ship restores with visit payload present");
      assert.deepEqual(ship.position.toArray(), normalized.position);
      assert.equal(ship.target, "earth-station");
      assert.equal(ship.velocity.length(), 0);
      assert.equal(ship.landedBody, null, "station visits do not claim a planetary landing");
    }
  }
});

test("visit validation rejects walls, solid furniture, unsupported heights and invalid viewing poses", () => {
  const flight = savedFlight();
  for (const positionM of [[28, 0, 0], [13.9, 0, 33.9], [-6, 0, 24], [0, 0, -30], [15, 0, 7],
    [0, -.001, 24], [0, 2.401, 24], [NaN, 0, 24], [0, 0, Infinity], [0, 24]])
    assert.equal(validateStationVisitState(visit({ positionM }), flight), null, `invalid character position ${positionM}`);
  for (const yaw of [Infinity, NaN, 1e6 + 1, "0"])
    assert.equal(validateStationVisitState(visit({ yaw }), flight), null);
  for (const pitch of [Infinity, NaN, 1.251, -1.251, "0"])
    assert.equal(validateStationVisitState(visit({ pitch }), flight), null);
  for (const extra of [{ bodyId: "earth" }, { camera: "chase" }, { camera: undefined }])
    assert.equal(validateFlightState(savedFlight({ stationVisit: visit(extra) })), null);
  for (const positionM of [[0, 0, 24], [0, 2.4, 24]])
    for (const pitch of [-1.25, 1.25])
      assert(validateStationVisitState(visit({ positionM, pitch }), flight), "valid height and pitch limits are inclusive");
});

test("station visit requires a stationary ship near the station and clear of Earth", () => {
  for (const extra of [
    { target: "earth" }, { systemId: "proxima-centauri" }, { velocity: [0, 1e-8, 0] },
    { landedBody: "earth" }, { walking: {} },
    { position: atDistance(station.radius * world.unitsKm * 1.002 - .001) },
    { position: atDistance(station.radius * world.unitsKm + 1800.001, station.position, [0, 0, -1]) },
  ]) assert.equal(validateFlightState(savedFlight({ stationVisit: visit(), ...extra })), null);
  const sunlitNormal = station.position.map((n, i) => n - earth.position[i]);
  const distance = Math.hypot(...sunlitNormal);
  const unsafeEarthPosition = atDistance(earth.radius * world.unitsKm + 900, earth.position,
    sunlitNormal.map(n => n / distance));
  assert.equal(validateFlightState(savedFlight({ position: unsafeEarthPosition, stationVisit: visit() })), null,
    "being near the station does not allow parking inside Earth's flight safety clearance");
  for (const distanceKm of [station.radius * world.unitsKm * 1.002 + .001, station.radius * world.unitsKm + 1799.999])
    assert(validateFlightState(savedFlight({ position: atDistance(distanceKm, station.position, [0, 0, -1]), stationVisit: visit() })));
});

test("layout 1 and layout 2 station approaches migrate once while current and planetary saves retain their positions", () => {
  for (const layout of [undefined, 1, 2]) {
    const oldPosition = atDistance(station.radius * world.unitsKm + 200, station.previousPosition);
    const source = savedFlight({ position: oldPosition, worldLayoutVersion: layout });
    const normalized = validateFlightState(source);
    assert(normalized);
    assert.deepEqual(normalized.position, savedFlight().position, "old station approach follows station relocation");
    assert.equal(normalized.worldLayoutVersion, 3);
    assert.deepEqual(validateFlightState(normalized), normalized, "a relocated save never moves twice");
  }
  for (const body of world.bodies.filter(body => body.kind !== "station")) {
    const source = savedFlight({ target: body.id, systemId: body.systemId ?? "solar", worldLayoutVersion: 2,
      position: atDistance(body.radius * world.unitsKm + 2000, body.position) });
    const normalized = validateFlightState(source);
    assert(normalized, `${body.id} layout 2 save remains accepted`);
    assert.deepEqual(normalized.position, source.position, `${body.id} keeps its layout 2 coordinates`);
  }
  const fresh = savedFlight(), normalized = validateFlightState(fresh);
  assert.deepEqual(normalized.position, fresh.position);
  assert.equal(normalized.stationVisit, undefined, "old free-flight saves never acquire an interior visit");
  const earthLanding = new ShipDynamics();
  assert.equal(earthLanding.placeOnSurface("earth", [0, 1, 0]), null);
  const planetSave = { ...earthLanding.snapshot(), target: "earth-station", worldLayoutVersion: 2 };
  assert.deepEqual(validateFlightState(planetSave).position, planetSave.position, "planetary landing stays on Earth");
  const walking = { bodyId: "earth", offsetM: [0, -6, 0], velocityMps: [0, 0, 0],
    orientation: [0, 0, 0, 1], pitch: 0, grounded: true, camera: "first" };
  const planetWalking = validateFlightState({ ...planetSave, walking });
  assert(planetWalking, "layout 2 planetary walking saves remain valid even with station selected");
  assert.deepEqual(planetWalking.position, planetSave.position);
  assert.deepEqual(planetWalking.walking, walking);
});

test("old station approach snapshots carry Earth's precise reference frame through relocation", () => {
  const oldWorld = structuredClone(world);
  oldWorld.layoutVersion = 2;
  const oldStation = oldWorld.bodies.find(body => body.id === "earth-station");
  oldStation.position = [...station.previousPosition];
  oldStation.radius = 60 / world.unitsKm;
  const ship = new ShipDynamics(oldWorld);
  ship.jump("earth-station");
  const source = ship.snapshot(), original = structuredClone(source);
  assert.equal(source.referenceFrame.kind, "body-fixed");
  assert.equal(source.referenceFrame.bodyId, "earth", "real station approaches are simulated near Earth");
  const normalized = validateFlightState(source);
  assert(normalized, "Earth's reference radial relocates along with the station approach");
  const expectedPosition = source.position.map((n, i) => n + station.position[i] - station.previousPosition[i]);
  assert(Math.hypot(...normalized.position.map((n, i) => n - expectedPosition[i])) < 1e-8);
  assert.equal(normalized.referenceFrame.bodyId, "earth");
  assert.deepEqual(validateFlightState(normalized), normalized);
  assert.deepEqual(source, original);
  const restored = new ShipDynamics();
  assert(restored.restore(normalized));
  assert.equal(restored.target, "earth-station");
  const damaged = { ...source, referenceFrame: { ...source.referenceFrame,
    radialM: source.referenceFrame.radialM.map((n, i) => n + (i === 0 ? 1 : 0)) } };
  assert.equal(validateFlightState(damaged), null, "relocation never legitimizes a contradictory original reference");
});

test("starship visits retain internal poses while flying and across stellar systems", () => {
  for (const systemId of ["solar", "alpha-centauri", "proxima-centauri", "barnard"]) {
    const body = world.bodies.find(b => (b.systemId ?? "solar") === systemId && b.kind === "star");
    if (!body) continue;
    for (const piloting of [true, false]) {
      const source = savedFlight({ systemId, target: body.id,
        position: atDistance(body.radius * world.unitsKm + 1000000, body.position), velocity: [0, 0, .001],
        stationVisit: visit({ vessel: true, piloting, positionM: [0, 0, -36] }) });
      const normalized = validateFlightState(source);
      assert(normalized);
      assert.equal(normalized.stationVisit.piloting, piloting);
      assert.deepEqual(normalized.stationVisit.positionM, [0, 0, -36]);
      assert.deepEqual(validateFlightState(normalized), normalized);
      const ship = new ShipDynamics();
      assert(ship.restore(normalized));
      assert.equal(ship.systemId, systemId);
      assert.deepEqual(ship.velocity.toArray(), normalized.velocity);
    }
  }
  for (const flags of [{ vessel: false }, { vessel: "true" }, { piloting: true }, { vessel: true, piloting: 1 }])
    assert.equal(validateFlightState(savedFlight({ stationVisit: visit(flags) })), null);
});
