import * as THREE from "three";
import { world, validateWalkingState } from "../shared/flight-state.mjs";
import type { WalkingState, WorldConfig } from "../shared/flight-state.mjs";
import { surfaceProfile } from "../shared/surface.mjs";
import { FloatingOriginFrame, SpatialScale, surfaceRadiusM } from "../shared/spatial-frame.mjs";
import type { BodyId } from "./solar-system";
import type { FlightInput, ShipDynamics } from "./ship-dynamics";
import { WalkingPhysics, CAMERA_COLLISION_RADIUS_M } from "./walking-physics.ts";
import type { WalkingTerrainPatch } from "./walking-physics.ts";
export { initializeWalkingPhysics } from "./walking-physics.ts";

export const BOARD_DISTANCE_M = 12;
export const WALK_JUMP_SPEED_MPS = 4.5;
// Suit return assist is a gameplay safety mechanism for tiny moons, not their real gravity.
export const SUIT_MIN_FALL_ACCELERATION_MPS2 = 0.35;
const MAX_WALK_SLOPE = Math.tan(50 * Math.PI / 180);
const IDLE_CONTACT_SPEED_MPS = 0.01;

/** Radial gravity with metre-scale integration independent of the AU-scale rendering position. */
export class WalkingDynamics {
  active = false;
  bodyId: BodyId | null = null;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  readonly anchor = new THREE.Vector3();
  readonly offsetM = new THREE.Vector3();
  readonly localPositionM = new THREE.Vector3();
  readonly localShipPositionM = new THREE.Vector3();
  readonly localOriginOffsetM = new THREE.Vector3();
  readonly lastRebaseShiftM = new THREE.Vector3();
  localFrame?: FloatingOriginFrame;
  rebaseRevision = 0;
  pitch = 0;
  grounded = false;
  private readonly anchorRadialM = new THREE.Vector3();
  private readonly radialM = new THREE.Vector3();
  private jumpHeld = false;
  private physics?: WalkingPhysics;
  readonly config: WorldConfig;

  constructor(config: WorldConfig = world) { this.config = config; }

  get gravity() { return this.bodyId ? surfaceProfile(this.bodyId).gravity : 0; }
  get speedMps() { return this.velocity.length(); }
  get distanceToShipM() { return this.offsetM.length(); }
  get outward() { return this.radialM.clone().normalize(); }
  get bodyRadialM() { return this.radialM.clone(); }
  get anchorBodyRadialM() { return this.anchorRadialM.clone(); }
  get groundClearanceM() {
    if (!this.bodyId) return 0;
    return this.radialM.length() - this.groundRadiusM(this.outward);
  }
  get suitAssisted() { return this.active && this.gravity < SUIT_MIN_FALL_ACCELERATION_MPS2; }
  get terrainPatch(): WalkingTerrainPatch | undefined { return this.physics?.terrainPatch; }
  get collisionCount() { return this.physics?.collisionCount ?? 0; }
  get collisionGroundClearanceM() { return this.physics?.groundDistanceM(this.localPositionM, this.outward) ?? 0; }

  /** Eye, target and result are local metres; this never moves the walker or steps physics. */
  constrainCamera(eyeM: THREE.Vector3, desiredM: THREE.Vector3, radiusM = CAMERA_COLLISION_RADIUS_M): THREE.Vector3 {
    return this.physics?.constrainCamera(eyeM, desiredM, radiusM) ?? desiredM.clone();
  }

  disembark(ship: ShipDynamics): string | null {
    if (this.active) return "已经在地表探索中";
    const body = this.config.bodies.find(candidate => candidate.id === ship.landedBody);
    if (ship.landingPhase !== "landed" || !body || !surfaceProfile(body.id).solid
      || (body.systemId ?? "solar") !== ship.systemId) return "请先在固体星球或卫星表面着陆，再离开飞船";
    this.bodyId = body.id;
    this.anchor.copy(ship.position);
    this.anchorRadialM.copy(ship.localFrame.bodyId === body.id ? ship.bodyRadialM
      : new THREE.Vector3().copy(ship.position).sub(new THREE.Vector3().fromArray(body.position))
        .multiplyScalar(new SpatialScale(this.config.unitsKm).metersPerUniverseUnit));
    this.radialM.copy(this.anchorRadialM);
    this.orientation.copy(ship.orientation);
    this.alignToSurface();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.orientation);
    this.radialM.addScaledVector(right, 10);
    const normal = this.outward;
    this.radialM.copy(normal).multiplyScalar(this.groundRadiusM(normal));
    this.velocity.set(0, 0, 0);
    this.pitch = 0;
    this.grounded = true;
    this.jumpHeld = false;
    this.active = true;
    this.alignToSurface();
    this.updatePosition();
    this.createPhysics(ship);
    // Lower the full capsule onto the shared collision mesh. On a slope its side
    // touches before the radial foot point, as a real capsule should.
    const start = this.localPositionM.clone().addScaledVector(this.outward, 1);
    const settled = this.physics!.move(start, this.outward, this.orientation, this.outward.clone().multiplyScalar(-2), 1 / 120);
    this.radialM.addScaledVector(this.outward, 1).add(settled.movement);
    this.grounded = settled.grounded;
    this.updatePosition();
    return null;
  }

  board(ship: ShipDynamics): string | null {
    if (!this.active) return "当前正在飞船内";
    if (ship.landingPhase !== "landed" || ship.landedBody !== this.bodyId
      || new SpatialScale(this.config.unitsKm).universeDistanceToMeters(ship.position.distanceTo(this.anchor)) > 0.01) return "停泊飞船位置已改变，请恢复地表存档";
    if (!this.grounded) return "请先落回地面，再进入飞船";
    if (this.distanceToShipM > BOARD_DISTANCE_M) return "请靠近停泊飞船至 12 米内，再进入飞船";
    this.reset();
    return null;
  }

  step(seconds: number, input: FlightInput) {
    if (!this.active || !this.bodyId || !Number.isFinite(seconds)) return;
    const duration = Math.max(0, Math.min(seconds, 0.25));
    if (!duration) return;
    const jumpPressed = input.brake && !this.jumpHeld;
    this.jumpHeld = input.brake;
    if (jumpPressed && this.grounded) {
      this.velocity.addScaledVector(this.outward, WALK_JUMP_SPEED_MPS);
      this.grounded = false;
    }
    for (let remaining = duration; remaining > 1e-9; remaining -= 1 / 120)
      this.stepSurface(Math.min(remaining, 1 / 120), input);
    this.updatePosition();
  }

  private stepSurface(dt: number, input: FlightInput) {
    const normal = this.outward;
    const yaw = THREE.MathUtils.clamp(input.yaw - input.mouseX, -1, 1) * 1.8 * dt;
    this.orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(normal, yaw));
    this.pitch = THREE.MathUtils.clamp(this.pitch + (input.pitch - input.mouseY) * dt * 1.3, -1.35, 1.35);
    this.alignToSurface();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.orientation);
    const wish = forward.multiplyScalar(THREE.MathUtils.clamp(input.throttle, -1, 1))
      .addScaledVector(right, THREE.MathUtils.clamp(input.strafe, -1, 1)).clampLength(0, 1);
    const traction = THREE.MathUtils.clamp(Math.sqrt(this.gravity / 9.81), 0.12, 1.15);
    const maxSpeed = (input.boost ? 5.5 : 2.8) / Math.max(1, Math.sqrt(this.gravity / 9.81));
    const vertical = this.velocity.dot(normal);
    const tangent = this.velocity.clone().addScaledVector(normal, -vertical);
    if (wish.lengthSq()) {
      const response = this.grounded ? 9 * traction : 0.65 * traction;
      tangent.lerp(wish.multiplyScalar(maxSpeed), 1 - Math.exp(-dt * response));
    } else if (this.grounded) tangent.multiplyScalar(Math.exp(-dt * 10 * traction));
    const horizontalTravel = tangent.length() * dt;
    if (horizontalTravel > 1e-7 && vertical <= 0 && (this.grounded || this.collisionCount > 0)) {
      const nextNormal = this.radialM.clone().addScaledVector(tangent, dt).normalize();
      const rise = this.groundRadiusM(nextNormal) - this.groundRadiusM(normal);
      // Reject uphill motor motion over 50° before Rapier can interpret dense
      // triangle edges as tiny steps. Gravity and swept collision still decide
      // the actual position, contact and any downhill sliding.
      if (rise > horizontalTravel * MAX_WALK_SLOPE + 1e-7) tangent.set(0, 0, 0);
    }
    this.velocity.copy(tangent).addScaledVector(normal, vertical);
    const onGround = this.grounded;
    {
      const body = this.config.bodies.find(candidate => candidate.id === this.bodyId)!;
      const radiusM = new SpatialScale(this.config.unitsKm).universeDistanceToMeters(body.radius);
      const gravity = this.gravity * Math.min(1, (radiusM / this.radialM.length()) ** 2);
      this.velocity.addScaledVector(normal, -Math.max(gravity, SUIT_MIN_FALL_ACCELERATION_MPS2) * dt);
    }
    const originRadialM = this.anchorRadialM.clone().add(this.localOriginOffsetM);
    this.physics!.ensureTerrain(this.radialM, originRadialM);
    const movement = this.velocity.clone().multiplyScalar(dt);
    // Ground following is bounded by travelled distance, so leaving a cliff does
    // not teleport feet down. Rapier still resolves every contact and 50° slope.
    if (onGround && vertical <= 0) this.physics!.controller.enableSnapToGround(Math.max(0.015, movement.length() * Math.tan(50 * Math.PI / 180)));
    else this.physics!.controller.disableSnapToGround();
    const result = this.physics!.move(this.localPositionM, normal, this.orientation, movement, dt);
    this.radialM.add(result.movement);
    this.grounded = result.grounded && this.velocity.dot(normal) <= 0;
    if (this.grounded) {
      this.velocity.copy(result.movement).divideScalar(dt).projectOnPlane(this.outward);
      if (!wish.lengthSq() && this.velocity.length() < IDLE_CONTACT_SPEED_MPS) this.velocity.set(0, 0, 0);
    } else {
      // Keep the integrator's ballistic velocity; collision constraints only
      // remove motion into non-ground obstacles, without synthesizing energy.
      for (const n of result.contactNormals) {
        const toward = this.velocity.dot(n);
        if (toward < 0 && n.dot(normal) < Math.cos(50 * Math.PI / 180)) this.velocity.addScaledVector(n, -toward);
      }
    }
    this.alignToSurface();
    this.updatePosition();
    this.rebaseIfNeeded();
  }

  private groundRadiusM(normal: THREE.Vector3) {
    const body = this.config.bodies.find(candidate => candidate.id === this.bodyId)!;
    return surfaceRadiusM(this.config, body, normal.toArray());
  }

  private alignToSurface() {
    const normal = this.outward;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation).projectOnPlane(normal);
    if (forward.lengthSq() < 1e-10) {
      forward.copy(Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).cross(normal);
    }
    forward.normalize();
    this.orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, normal));
  }

  private updatePosition() {
    this.offsetM.copy(this.radialM).sub(this.anchorRadialM);
    this.position.copy(this.offsetM).divideScalar(new SpatialScale(this.config.unitsKm).metersPerUniverseUnit).add(this.anchor);
    this.localPositionM.copy(this.offsetM).sub(this.localOriginOffsetM);
    this.localShipPositionM.copy(this.localOriginOffsetM).negate();
  }

  private createPhysics(ship: ShipDynamics) {
    this.localOriginOffsetM.set(0, 0, 0);
    this.localFrame = new FloatingOriginFrame(new SpatialScale(this.config.unitsKm), {
      originUniverse: this.anchor.toArray(), bodyId: this.bodyId!, systemId: ship.systemId,
    });
    this.updatePosition();
    // Restored walks may be hundreds of kilometres from the ship. Rebase in
    // double precision before creating any Float32 render or collision vertex.
    const initialShift = this.localFrame.rebase(this.localPositionM.toArray());
    if (initialShift) {
      this.lastRebaseShiftM.fromArray(initialShift);
      this.localOriginOffsetM.add(this.lastRebaseShiftM);
      this.rebaseRevision++;
      this.updatePosition();
    }
    this.physics = new WalkingPhysics(this.config, this.bodyId!);
    this.physics.ensureTerrain(this.radialM, this.anchorRadialM.clone().add(this.localOriginOffsetM), true);
    this.physics.setFeet(this.localPositionM, this.outward, this.orientation);
  }

  /** Public for deterministic acceptance tests; normal gameplay calls this every substep. */
  rebaseIfNeeded() {
    if (!this.localFrame || !this.physics) return false;
    const shift = this.localFrame.rebase(this.localPositionM.toArray());
    if (!shift || !shift.some(component => component !== 0)) return false;
    this.lastRebaseShiftM.fromArray(shift);
    this.localOriginOffsetM.add(this.lastRebaseShiftM);
    this.physics.shiftOrigin(this.lastRebaseShiftM);
    this.rebaseRevision++;
    this.updatePosition();
    return true;
  }

  snapshot(): WalkingState | undefined {
    if (!this.active || !this.bodyId) return undefined;
    return { bodyId: this.bodyId, offsetM: this.offsetM.toArray(), velocityMps: this.velocity.toArray(),
      orientation: this.orientation.toArray(), pitch: this.pitch, grounded: this.grounded };
  }

  restore(payload: WalkingState | undefined, ship: ShipDynamics) {
    this.reset();
    if (!payload || ship.landingPhase !== "landed") return;
    const saved = validateWalkingState(payload, ship.snapshot(), this.config);
    if (!saved) return;
    const body = this.config.bodies.find(candidate => candidate.id === saved.bodyId)!;
    this.bodyId = saved.bodyId;
    this.anchor.copy(ship.position);
    this.anchorRadialM.copy(ship.localFrame.bodyId === body.id ? ship.bodyRadialM
      : new THREE.Vector3().copy(ship.position).sub(new THREE.Vector3().fromArray(body.position))
        .multiplyScalar(new SpatialScale(this.config.unitsKm).metersPerUniverseUnit));
    this.offsetM.fromArray(saved.offsetM);
    this.radialM.copy(this.anchorRadialM).add(this.offsetM);
    this.velocity.fromArray(saved.velocityMps);
    this.orientation.fromArray(saved.orientation);
    this.pitch = saved.pitch;
    this.grounded = saved.grounded;
    this.active = true;
    this.alignToSurface();
    this.updatePosition();
    this.createPhysics(ship);
  }

  reset() {
    this.physics?.dispose();
    this.physics = undefined;
    this.localFrame = undefined;
    this.localOriginOffsetM.set(0, 0, 0);
    this.localPositionM.set(0, 0, 0);
    this.localShipPositionM.set(0, 0, 0);
    this.lastRebaseShiftM.set(0, 0, 0);
    this.rebaseRevision = 0;
    this.active = false;
    this.bodyId = null;
    this.grounded = false;
    this.jumpHeld = false;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.offsetM.set(0, 0, 0);
    this.anchor.set(0, 0, 0);
    this.anchorRadialM.set(0, 0, 0);
    this.radialM.set(0, 0, 0);
    this.position.set(0, 0, 0);
    this.orientation.identity();
  }
}
