import { test, expect } from "@playwright/test";
import { stellarDiskVisibility } from "../src/light-occlusion";
import * as THREE from "three";
import { FlightLight } from "../src/flight-light";
import type { ShipDynamics } from "../src/ship-dynamics";

test("恒星有限光盘产生连续半影，远端小遮挡物无法制造全黑拖尾", () => {
  expect(stellarDiskVisibility(0.005, 0.01, 0)).toBe(0);
  expect(stellarDiskVisibility(0.005, 0.01, 0.015)).toBe(1);
  expect(stellarDiskVisibility(0.005, 0.0025, 0)).toBeCloseTo(0.75, 8);
  const samples = Array.from({ length: 101 }, (_, i) => stellarDiskVisibility(0.005, 0.01, 0.004 + i * 0.00012));
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    expect(samples[i] - samples[i - 1]).toBeLessThan(0.03);
  }
  expect(stellarDiskVisibility(0.005, 0.005, 0.005)).toBeCloseTo(0.609, 3);
});

test("航行中的船体受光与恒星辉光一起经过半影，不会瞬间跳黑", () => {
  const blocker = { kind: "planet", position: [0, 0, -10], radius: 1 };
  const ship = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), warping: false,
    activeBodies: [{ kind: "star", position: [0, 0, -100], radius: 1 }, blocker],
    environment: { outward: new THREE.Vector3(0, 1, 0), body: {}, altitudeKm: 1000 },
    config: { unitsKm: 6371 }, landingPhase: "manual", elapsed: 0,
  } as unknown as ShipDynamics;
  const effect = new FlightLight();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.01, 200);
  const sun = new THREE.PointLight();
  sun.position.set(0, 0, -100);
  effect.update(ship, camera, sun);
  expect(effect.illumination).toBe(0);
  expect(effect.material.uniforms.glow.value).toBe(0);
  blocker.position[0] = 1;
  effect.update(ship, camera, sun);
  expect(effect.illumination).toBeGreaterThan(0.2);
  expect(effect.illumination).toBeLessThan(0.8);
  expect(effect.material.uniforms.glow.value).toBeCloseTo(effect.illumination * 0.1);
  blocker.position[0] = 2;
  effect.update(ship, camera, sun);
  expect(effect.illumination).toBe(1);
  expect(effect.material.uniforms.glow.value).toBeCloseTo(0.1);
  effect.mesh.geometry.dispose();
  effect.material.dispose();
});
