import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import world from "../shared/world.json" with { type: "json" };
import { getBody } from "../src/solar-system.ts";
import { surfaceMapRotation } from "../src/surface-map-pose.ts";
import { ShipDynamics } from "../src/ship-dynamics.ts";
import { surfaceProfile, terrainHeightField, terrainHeightKm, terrainMaxHeightKm,
  terrainMapUv, terrainMapNormal, sampleTerrainField, legacyTerrainHeightKm } from "../shared/surface.mjs";

const solids = world.bodies.filter(body => surfaceProfile(body.id).solid);
const sphereUv = direction => {
  const p = direction.clone().normalize();
  return [THREE.MathUtils.euclideanModulo(Math.atan2(p.z, -p.x) / (2 * Math.PI), 1),
    .5 + Math.asin(p.y) / Math.PI];
};

test("every solid body has one stable height field and the measured/concept image frames match", () => {
  assert.equal(solids.length, 40);
  for (const body of solids) {
    const field = terrainHeightField(body.id);
    assert(field, body.id);
    assert.equal(terrainHeightField(body.id), field, "sampling never regenerates or replaces a field");
    assert.equal(field.width, body.id === "earth" ? 1024 : 512);
    assert.equal(field.height, field.width / 2);
    assert.equal(field.data.length, field.width * field.height);
    const normal = new THREE.Vector3(-.47, .63, .82).normalize();
    const pose = body.id === "venus" ? { clouds: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.4) } : {};
    const photo = sphereUv(normal.clone().applyMatrix3(surfaceMapRotation(body.id, getBody(body.id).axialTiltDeg, pose, field.mapOffset)));
    const collision = terrainMapUv(body.id, normal.toArray());
    assert(Math.abs(collision[0] - photo[0]) < 1e-12, `${body.id} fixed photographic longitude`);
    assert(Math.abs(collision[1] - photo[1]) < 1e-12, `${body.id} fixed photographic latitude`);
    assert(new THREE.Vector3(...terrainMapNormal(body.id, collision)).distanceTo(normal) < 1e-12);
  }
  assert.equal(terrainHeightField("naiad").data, terrainHeightField("thalassa").data,
    "shared concept sources decode once despite independent longitude and relief scale");
  for (const body of world.bodies.filter(body => !surfaceProfile(body.id).solid)) {
    assert.equal(terrainHeightField(body.id), undefined);
    assert.equal(terrainHeightKm(body.id, [0, 0, 1]), 0);
  }
});

test("field sampling respects pixel centres, wrapping, poles and the declared collision envelope", () => {
  for (const body of solids) {
    const field = terrainHeightField(body.id);
    for (const [x, y] of [[0, 0], [17, 91], [field.width - 1, field.height - 1]]) {
      const uv = [(x + .5) / field.width, (y + .5) / field.height];
      assert(Math.abs(sampleTerrainField(field, uv) - field.data[y * field.width + x] / 255) < 1e-12);
      assert(Math.abs(sampleTerrainField(field, [uv[0] + 2, uv[1]]) - sampleTerrainField(field, uv)) < 1e-12);
    }
    for (const v of [0, 1]) {
      const heights = [0, .13, .5, .99].map(u => terrainHeightKm(body.id, terrainMapNormal(body.id, [u, v])));
      assert(Math.max(...heights) - Math.min(...heights) < 1e-9, `${body.id} has one physical pole`);
    }
    const left = terrainHeightKm(body.id, terrainMapNormal(body.id, [1 - 1e-9, .6]));
    const right = terrainHeightKm(body.id, terrainMapNormal(body.id, [1e-9, .6]));
    assert(Math.abs(left - right) < .00002, `${body.id} continuous longitude seam`);
    for (let i = 0; i < 160; i++) {
      const normal = new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * .7), Math.cos(i * 2.4)).normalize();
      const height = terrainHeightKm(body.id, normal.toArray());
      assert(height >= 0 && height <= terrainMaxHeightKm(body.id) + 1e-12, `${body.id} envelope bounds actual ground`);
      const metre = normal.clone().add(new THREE.Vector3(.001 / (body.radius * world.unitsKm), 0, 0)).normalize();
      assert(Math.abs(height - terrainHeightKm(body.id, metre.toArray())) < .025,
        `${body.id} metre-scale travel cannot jump to an unrelated surface`);
    }
  }
});

test("Earth collision uses its GEBCO field and preserves a separate sea-level water classification", () => {
  const field = terrainHeightField("earth");
  assert.equal(field.fineEnabled, false, "independent random mountain ranges cannot replace mapped geography");
  assert(field.waterMask instanceof Uint8Array);
  assert.equal(field.waterMask.length, field.data.length);
  let water = 0, zeroLand = 0, peak = 0;
  for (let i = 0; i < field.data.length; i++) {
    assert([0, 255].includes(field.waterMask[i]));
    water += Number(field.waterMask[i] === 255);
    zeroLand += Number(field.waterMask[i] === 0 && field.data[i] === 0);
    if (field.data[i] > field.data[peak]) peak = i;
  }
  assert(water > field.data.length * .5);
  assert(zeroLand > 0, "sea-level land is not misclassified as water");
  const uv = [(peak % field.width + .5) / field.width, (Math.floor(peak / field.width) + .5) / field.height];
  const normal = terrainMapNormal("earth", uv);
  const height = terrainHeightKm("earth", normal);
  assert(height > 7, "the shipped elevation retains mountain summits");
  assert(Math.abs(height - field.data[peak] / 255 * field.heightScaleKm) < 1e-8);
  assert(Math.abs(height - legacyTerrainHeightKm("earth", normal)) > 2,
    "mapped mountain height is not the old unrelated noise field");
});

test("Mimas' visible Herschel bowl stays below its rim and landing references those exact elevations", () => {
  const field = terrainHeightField("mimas");
  const crater = field.craters.find(feature => feature.id === "herschel");
  assert(crater);
  const center = terrainMapNormal("mimas", crater.uv);
  const floor = terrainHeightKm("mimas", center);
  const ship = new ShipDynamics();
  const body = world.bodies.find(candidate => candidate.id === "mimas");
  ship.jump("mimas");
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const uv = [crater.uv[0] + crater.angularRadius * Math.cos(angle) / (2 * Math.PI),
      crater.uv[1] + crater.angularRadius * Math.sin(angle) / Math.PI];
    const rimNormal = terrainMapNormal("mimas", uv);
    const rim = terrainHeightKm("mimas", rimNormal);
    assert(rim - floor > .7, "the photo's crater has a kilometre-scale geometric bowl at every rim direction");
    ship.position.fromArray(body.position).addScaledVector(new THREE.Vector3(...rimNormal), body.radius + (rim + .006 + .002) / world.unitsKm);
    assert(Math.abs(ship.environment.groundAltitudeKm - .002) < .00001);
  }
  ship.position.fromArray(body.position).addScaledVector(new THREE.Vector3(...center), body.radius + (floor + .006 + .002) / world.unitsKm);
  assert(Math.abs(ship.environment.groundAltitudeKm - .002) < .00001);
});

test("procedural Ceres and Venus use fixed geometric crater fields rather than an unrelated local plain", () => {
  for (const id of ["ceres", "venus"]) {
    const field = terrainHeightField(id);
    assert.equal(field.sourceId, `procedural-${id}`);
    const feature = field.craters[0];
    const center = new THREE.Vector3(...terrainMapNormal(id, feature.uv));
    const tangent = new THREE.Vector3(0, 1, 0).cross(center).normalize();
    const rim = center.clone().multiplyScalar(Math.cos(feature.angularRadius)).addScaledVector(tangent, Math.sin(feature.angularRadius));
    assert(terrainHeightKm(id, rim.toArray()) - terrainHeightKm(id, center.toArray()) > .7,
      `${id} keeps its crater from orbit through physical terrain`);
  }
});
