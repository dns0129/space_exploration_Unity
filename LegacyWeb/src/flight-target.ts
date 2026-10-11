import * as THREE from "three";

export interface FlightTargetStats {
  targetX: number;
  targetY: number;
  inView: boolean;
  angle: number;
}
const local = new THREE.Vector3();

/** Project after the current camera transform; behind-camera targets stay at an edge. */
export function projectFlightTarget(relative: THREE.Vector3, camera: THREE.PerspectiveCamera): FlightTargetStats {
  camera.updateMatrixWorld();
  local.copy(relative).applyMatrix4(camera.matrixWorldInverse);
  const depth = Math.max(Math.abs(local.z), 1e-9);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let x = local.x / (depth * halfHeight * camera.aspect);
  let y = -local.y / (depth * halfHeight);
  const inView = local.z < 0 && Math.abs(x) <= 0.88 && Math.abs(y) <= 0.72;
  if (!inView) {
    if (Math.abs(x) + Math.abs(y) < 1e-9) y = 1;
    const edge = Math.min(0.88 / Math.max(Math.abs(x), 1e-12), 0.72 / Math.max(Math.abs(y), 1e-12));
    x *= edge;
    y *= edge;
  }
  return { targetX: (x + 1) * 50, targetY: (y + 1) * 50, inView,
    angle: Math.atan2(y, x) * 180 / Math.PI + 90 };
}
