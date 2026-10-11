import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { world, validateFlightState, WALKING_GROUNDED_CLEARANCE_M } from "../shared/flight-state.mjs";
import { terrainHeightKm, TERRAIN_VERSION, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { createVoyagerServer } from "./server.mjs";

const meters = world.unitsKm * 1000;
function landedSave(id = "earth", feetClearanceM = 0, exactReference = false) {
  const body = world.bodies.find(candidate => candidate.id === id);
  const length = Math.hypot(.4, .7, -.5), normal = [.4, .7, -.5].map(n => n / length);
  const groundRadiusM = body.radius * meters + terrainHeightKm(id, normal) * 1000;
  const radialM = normal.map(n => n * (groundRadiusM + LANDING_CLEARANCE_KM * 1000));
  const position = body.position.map((n, i) => n + radialM[i] / meters);
  return {
    version: 2, worldLayoutVersion: world.layoutVersion, terrainVersion: TERRAIN_VERSION,
    position, velocity: [0, 0, 0], orientation: [0, 0, 0, 1], target: id,
    camera: "chase", assist: true, elapsed: 42, systemId: body.systemId ?? "solar", landedBody: id,
    ...(exactReference ? { coordinateVersion: 1, referenceFrame: { kind: "body-fixed", bodyId: id, radialM } } : {}),
    walking: { bodyId: id, offsetM: normal.map(n => n * (feetClearanceM - LANDING_CLEARANCE_KM * 1000)),
      velocityMps: [0, 0, 0], orientation: [0, 0, 0, 1], pitch: 0, grounded: true },
  };
}

test("body-relative metre coordinates and universe positions restore consistently without persisting a floating origin", () => {
  for (const id of ["earth", "mars", "triton", "nereid", "proxima-b", "echo-thalassa"]) {
    const legacy = landedSave(id), original = structuredClone(legacy);
    const saved = validateFlightState(legacy);
    assert(saved, id);
    assert.equal(saved.coordinateVersion, 1);
    assert.equal(saved.referenceFrame.kind, "body-fixed");
    assert.equal(saved.referenceFrame.bodyId, id);
    assert.equal(saved.referenceFrame.radialM.length, 3);
    assert.deepEqual(saved.position, legacy.position, `${id} preserves the saved universe position`);
    assert.deepEqual(saved.walking, legacy.walking, `${id} preserves the ship-relative metre pose`);
    assert.deepEqual(legacy, original, "legacy migration is non-mutating");
    assert.deepEqual(validateFlightState(saved), saved, `${id} metadata migration runs once`);
    const ephemeral = { ...saved, localOriginM: [1e6, -5e6, 9e6],
      referenceFrame: { ...saved.referenceFrame, localOriginM: [999, 999, 999] } };
    assert.deepEqual(validateFlightState(ephemeral), saved, "temporary engine-origin data is never persisted");
  }
});

test("HTTP persistence keeps exact distant-body metres and drops transient physics origins", async t => {
  const root = await mkdtemp(join(tmpdir(), "voyager-coordinate-save-"));
  const staticRoot = join(root, "game"), dataDir = join(root, "saves");
  await mkdir(staticRoot);
  const server = createVoyagerServer({ staticRoot, dataDir });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/flight/save`;
  const initial = await fetch(url), cookie = initial.headers.get("set-cookie").split(";")[0];
  const input = landedSave("nereid", .08, true), expected = validateFlightState(input);
  const body = world.bodies.find(body => body.id === "nereid");
  const fromUniverse = input.position.map((n, i) => (n - body.position[i]) * meters);
  assert(Math.hypot(...fromUniverse.map((n, i) => n - input.referenceFrame.radialM[i])) > 1e-8,
    "fixture exercises real precision lost by AU-scale subtraction");
  const result = await fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...input, localOriginM: [1e9, 1e9, 1e9] }) });
  assert.equal(result.status, 200);
  const stored = (await (await fetch(url, { headers: { cookie } })).json()).state;
  assert.deepEqual(stored, expected);
  assert.deepEqual(stored.referenceFrame.radialM, input.referenceFrame.radialM,
    "serializing and validating do not reconstruct precise metres from the rounded universe position");
  assert.equal(stored.localOriginM, undefined);
  const corrupted = { ...input, referenceFrame: { ...input.referenceFrame,
    radialM: input.referenceFrame.radialM.map((n, i) => n + (i ? 0 : 1)) } };
  assert.equal((await fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(corrupted) })).status, 400);
  assert.deepEqual((await (await fetch(url, { headers: { cookie } })).json()).state, expected,
    "rejecting inconsistent exact coordinates preserves the last valid file");
});

test("save reference metadata rejects cross-body/system, inconsistent positions, nonfinite coordinates and unknown revisions", () => {
  const saved = validateFlightState(landedSave("nereid"));
  const reference = saved.referenceFrame;
  const damaged = [null, {}, { kind: "camera" }, { kind: "body-fixed", bodyId: "missing", radialM: [0, 0, 0] },
    { ...reference, bodyId: "triton" }, { ...reference, bodyId: "proxima-b" },
    { ...reference, radialM: [Infinity, 0, 0] }, { ...reference, radialM: [NaN, 0, 0] },
    { ...reference, radialM: [1, 2] }, { ...reference, radialM: reference.radialM.map((n, i) => n + (i ? 0 : 1)) },
    { kind: "system", bodyId: "nereid" }, { kind: "system", radialM: [0, 0, 0] }];
  for (const referenceFrame of damaged) {
    assert.equal(validateFlightState({ ...saved, referenceFrame }), null);
  }
  for (const coordinateVersion of [0, 2, null, "1", Infinity])
    assert.equal(validateFlightState({ ...saved, coordinateVersion }), null);
  assert.equal(validateFlightState({ ...saved, systemId: "proxima-centauri" }), null);
});

test("rounded capsule contact allows a small positive slope gap but never broadens the underground save tolerance", () => {
  for (const id of ["earth", "moon", "mars", "triton", "nereid", "proxima-b", "echo-thalassa"]) {
    for (const clearance of [0, .01, WALKING_GROUNDED_CLEARANCE_M - .01]) {
      const value = landedSave(id, clearance), original = structuredClone(value);
      const saved = validateFlightState(value);
      assert(saved, `${id} capsule gap ${clearance} m`);
      assert.deepEqual(validateFlightState(saved), saved, `${id} normalization is idempotent`);
      assert.deepEqual(value, original, "validation leaves the stored input intact");
    }
    assert.equal(validateFlightState(landedSave(id, -.03)), null, `${id} buried contact stays invalid`);
    assert.equal(validateFlightState(landedSave(id, WALKING_GROUNDED_CLEARANCE_M + .03)), null,
      `${id} an unsupported floating character is not grounded`);
  }
});
