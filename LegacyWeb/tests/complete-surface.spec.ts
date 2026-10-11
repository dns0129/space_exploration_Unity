import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { SurfaceScene } from "../src/surface-scene";
import { ShipDynamics } from "../src/ship-dynamics";
import { world } from "../shared/flight-state.mjs";
import { terrainHeightKm } from "../shared/surface.mjs";

test("近地表所有方向使用一个闭合球面，细分不产生第二层地表", () => {
  for (const id of ["earth", "moon", "mars", "mimas", "ceres"]) {
    const body = world.bodies.find(candidate => candidate.id === id)!;
    const ship = new ShipDynamics();
    ship.position.fromArray(body.position).add(new THREE.Vector3(0, 0,
      -body.radius - (terrainHeightKm(id, [0, 0, -1]) + 1) / world.unitsKm));
    const scene = new SurfaceScene();
    const camera = new THREE.PerspectiveCamera();
    const sun = new THREE.PointLight();
    sun.position.set(1, 1, 1);
    scene.update(ship, camera, sun);
    const surfaces = scene.group.children.filter(object => object instanceof THREE.Mesh && object.visible);
    expect(surfaces).toHaveLength(1);
    const globe = surfaces[0] as THREE.Mesh<THREE.SphereGeometry>;
    expect(globe.name).toBe("complete-surface-globe");
    const vertices = globe.geometry.getAttribute("position");
    const point = new THREE.Vector3();
    let near = 0, far = 0;
    for (let i = 0; i < vertices.count; i += 19) {
      point.fromBufferAttribute(vertices, i);
      const normal = point.clone().normalize();
      const expected = body.radius + terrainHeightKm(id, normal.toArray()) / world.unitsKm;
      expect(Math.abs(point.length() - expected) * world.unitsKm).toBeLessThan(0.01);
      if (normal.dot(ship.environment.outward) > 0.9) near++;
      if (normal.dot(ship.environment.outward) < -0.5) far++;
    }
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    // Longitude seam is closed for every ring, including both poles.
    const stride = globe.geometry.parameters.widthSegments + 1;
    for (let row = 0; row <= globe.geometry.parameters.heightSegments; row++) {
      const first = new THREE.Vector3().fromBufferAttribute(vertices, row * stride);
      const last = new THREE.Vector3().fromBufferAttribute(vertices, row * stride + stride - 1);
      expect(first.distanceTo(last) * world.unitsKm).toBeLessThan(0.01);
    }
    scene.dispose();
  }
});
