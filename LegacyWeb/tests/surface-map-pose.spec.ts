import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { surfaceMapRotation } from "../src/surface-map-pose";
import { SURFACE_MAPS } from "../src/body-textures";
import { getBody } from "../src/solar-system";
import { terrainMapNormal } from "../shared/surface.mjs";

const sphereUv = (direction: THREE.Vector3) => {
  const p = direction.clone().normalize();
  return [THREE.MathUtils.euclideanModulo(Math.atan2(p.z, -p.x) / (2 * Math.PI), 1),
    1 - Math.acos(p.y) / Math.PI];
};

test("地球表面与漂移云层分别保留原图方向", () => {
  const group = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.41));
  const surface = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.8, 0));
  const clouds = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.31, 0));
  const local = new THREE.Vector3(-0.73, 0.24, 0.37).normalize();
  for (const source of [surface, clouds]) {
    const world = local.clone().applyQuaternion(source).applyQuaternion(group);
    const sampled = world.applyMatrix3(surfaceMapRotation("earth", 23.44, { group, surface: source }));
    const uv = sphereUv(sampled);
    expect(uv[0]).toBeCloseTo(sphereUv(local)[0], 10);
    expect(uv[1]).toBeCloseTo(sphereUv(local)[1], 10);
  }
});

test("共享卫星概念图保持全局着色器的正向经度偏移与纬度", () => {
  const group = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.55));
  const surface = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.4, 0));
  for (const offset of [0.37, 0.5, 0.83]) {
    const local = new THREE.Vector3(-0.93, -0.32, 0.22).normalize();
    const world = local.clone().applyQuaternion(surface).applyQuaternion(group);
    const actual = sphereUv(world.applyMatrix3(surfaceMapRotation("thalassa", 0, { group, surface }, offset)));
    expect(actual[0]).toBeCloseTo(THREE.MathUtils.euclideanModulo(sphereUv(local)[0] + offset, 1), 10);
    expect(actual[1]).toBeCloseTo(sphereUv(local)[1], 10);
  }
});

test("金星摄影采用云顶姿态；直接恢复时使用初始云顶姿态", () => {
  const group = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 3.1));
  const surface = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.4, 0));
  const clouds = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.23, 0));
  const local = new THREE.Vector3(0.43, 0.71, -0.62).normalize();
  const world = local.clone().applyQuaternion(clouds).applyQuaternion(group);
  expect(world.applyMatrix3(surfaceMapRotation("venus", 177.4, { group, surface, clouds }))
    .distanceTo(local)).toBeLessThan(1e-10);
  const restoredWorld = local.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(177.4)));
  expect(restoredWorld.applyMatrix3(surfaceMapRotation("venus", 177.4)).distanceTo(local)).toBeLessThan(1e-10);
});

test("碰撞高度与轨道和局部摄影对同一地貌使用相同经纬坐标", () => {
  for (const id of ["earth", "mars", "mimas", "umbriel", "thalassa", "ceres"] as const) {
    const body = getBody(id);
    const offset = SURFACE_MAPS[id]?.offset ?? 0;
    for (const uv of [[.155, .5], [.985, .32], [.01, .78]]) {
      // Construct a world location through the collision height's UV frame,
      // then sample it through the independent render-map pose transform.
      const normal = new THREE.Vector3().fromArray(terrainMapNormal(id, uv));
      const actual = sphereUv(normal.applyMatrix3(surfaceMapRotation(id, body.axialTiltDeg, {}, offset)));
      expect(Math.abs(THREE.MathUtils.euclideanModulo(actual[0] - uv[0] + .5, 1) - .5), `${id}经度对应同一地貌`).toBeLessThan(1e-10);
      expect(actual[1], `${id}纬度对应同一地貌`).toBeCloseTo(uv[1], 10);
    }
  }
});
