import * as THREE from "three";
import type { BodyId } from "./solar-system";

interface SurfaceMapPose {
  group?: THREE.Quaternion;
  surface?: THREE.Quaternion;
  clouds?: THREE.Quaternion;
}

/** Transform a world radial direction into the same UV frame used by the orbital map shader. */
export function surfaceMapRotation(bodyId: BodyId, axialTiltDeg: number, pose: SurfaceMapPose = {}, longitudeOffset = 0) {
  const group = pose.group ?? new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(axialTiltDeg));
  // Venus's photography belongs to its drifting cloud deck, rather than its rocky surface.
  const source = bodyId === "venus" ? pose.clouds : pose.surface;
  const yaw = bodyId === "earth" ? -1.8 : bodyId === "venus" ? 0 : -0.4;
  const object = source ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const rotation = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
    group.clone().multiply(object).invert()));
  // SphereGeometry uses atan(z, -x); a positive Y rotation adds the shader's positive U offset.
  if (longitudeOffset) rotation.premultiply(new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationY(longitudeOffset * Math.PI * 2)));
  return rotation;
}
