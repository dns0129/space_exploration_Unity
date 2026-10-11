import * as THREE from "three";
import { world, validateFlightState } from "../shared/flight-state.mjs";
import type { EngineMode, FlightState, WorldConfig } from "../shared/flight-state.mjs";
import { surfaceProfile, terrainHeightKm, terrainMaxHeightKm, TERRAIN_VERSION, LANDING_CLEARANCE_KM } from "../shared/surface.mjs";
import { bodySystem, systemBodies, systemDisplacement } from "../shared/world-navigation.mjs";
import { PROPULSION_BANDS, propulsionBand } from "../shared/propulsion.mjs";
import { FloatingOriginFrame, SpatialScale, sampleSurface, surfaceRadiusM, METRES_PER_KILOMETRE } from "../shared/spatial-frame.mjs";
import type { BodyId, SystemId } from "./solar-system";
// Centimetre tolerance compensates for subtraction at AU-scale coordinates.
const SURFACE_EPSILON_KM = 1e-5;
export interface FlightInput {
  throttle: number;
  strafe: number;
  lift: number;
  yaw: number;
  pitch: number;
  roll: number;
  boost: boolean;
  brake: boolean;
  mouseX: number;
  mouseY: number;
}
export const emptyInput = (): FlightInput => ({
  throttle: 0,
  strafe: 0,
  lift: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  boost: false,
  brake: false,
  mouseX: 0,
  mouseY: 0,
});
interface RoutePoint { systemId: SystemId; position: THREE.Vector3; }
interface WarpApproach {
  center: THREE.Vector3;
  radial: THREE.Vector3;
  entryRadius: number;
  endRadius: number;
}
export class ShipDynamics {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  readonly angularVelocity = new THREE.Vector3();
  bank = 0;
  deceleration = 0;
  cruiseSpeedKm = 100;
  lowFlightSpeedMps = 1000;
  get engineMode(): EngineMode { return propulsionBand(this.cruiseSpeedKm).id; }
  target: BodyId = "earth";
  systemId: SystemId = "solar";
  camera: "cockpit" | "chase" = "cockpit";
  assist = true;
  elapsed = 0;
  collision: BodyId | null = null;
  landedBody: BodyId | null = null;
  landingPhase: "manual" | "descending" | "landed" | "ascending" = "manual";
  private landingBody: BodyId | null = null;
  readonly config: WorldConfig;
  readonly scale: SpatialScale;
  private frame!: FloatingOriginFrame;
  private readonly localPosition = new THREE.Vector3();
  private readonly publishedPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  /** Universe position remains the navigation/save interface; metre coordinates
   * are authoritative between nearby steps and never roundtrip through it. */
  get localFrame() { this.syncLocalFrame(); return this.frame; }
  get localPositionM() { this.syncLocalFrame(); return this.localPosition.clone(); }
  get localVelocityMps() {
    this.syncLocalFrame();
    return new THREE.Vector3().fromArray(this.frame.universeVelocityToLocal(this.velocity.toArray(), this.localPosition.toArray()));
  }
  get bodyRadialM() {
    this.syncLocalFrame();
    const body = this.config.bodies.find(candidate => candidate.id === this.frame.bodyId);
    return body ? new THREE.Vector3().fromArray(this.frame.bodyRadialM(this.localPosition.toArray(), body)) : new THREE.Vector3();
  }
  warpPhase: "ready" | "charging" | "transit" | "arrival" | "cooldown" = "ready";
  warpProgress = 0;
  warpSpeedKm = 0;
  private warpClock = 0;
  private warpRoute: RoutePoint[] = [];
  private warpLength = 0;
  private warpTarget: BodyId = "earth";
  private warpApproach?: WarpApproach;
  private readonly warpUp = new THREE.Vector3(0, 1, 0);
  private warpApproachSpeed = 0;
  private warpTransitSeconds = 7;
  constructor(config: WorldConfig = world) {
    this.config = config;
    this.scale = new SpatialScale(config.unitsKm);
    this.jump("earth");
  }
  private syncLocalFrame() {
    let nearest: WorldConfig["bodies"][number] | undefined, altitudeM = Infinity;
    const current = this.frame && this.frame.systemId === this.systemId && this.position.equals(this.publishedPosition);
    for (const body of this.activeBodies) {
      if (body.kind === "station" || !surfaceProfile(body.id).solid) continue;
      const radial = current && this.frame.bodyId === body.id
        ? this.frame.bodyRadialM(this.localPosition.toArray(), body)
        : this.scale.universeDeltaToMetres(this.position.toArray(), body.position);
      const altitude = Math.hypot(...radial) - this.scale.universeDistanceToMeters(body.radius);
      if (altitude < altitudeM) { nearest = body; altitudeM = altitude; }
    }
    const bodyId = nearest && altitudeM <= Math.max(2_000_000, this.scale.universeDistanceToMeters(nearest.radius) * 5)
      ? nearest.id : null;
    if (!this.frame || this.frame.systemId !== this.systemId || this.frame.bodyId !== bodyId) {
      this.frame = new FloatingOriginFrame(this.scale, { originUniverse: this.position.toArray(), systemId: this.systemId, bodyId });
      this.localPosition.set(0, 0, 0);
      this.publishedPosition.copy(this.position);
    } else if (!current) {
      // Public position edits (debug placement, restored saves, warp) are explicit
      // universe teleports. Ordinary metre integration does not enter this path.
      this.localPosition.fromArray(this.frame.universeToLocal(this.position.toArray()));
      this.publishedPosition.copy(this.position);
    }
    this.recenterLocalFrame();
  }
  private recenterLocalFrame() {
    const shift = this.frame.rebase(this.localPosition.toArray());
    if (shift) this.localPosition.sub(new THREE.Vector3().fromArray(shift));
  }
  private publishLocalPosition() {
    this.recenterLocalFrame();
    this.position.fromArray(this.frame.localToUniverse(this.localPosition.toArray()));
    this.publishedPosition.copy(this.position);
  }
  private translateMetres(displacementM: THREE.Vector3) {
    this.syncLocalFrame();
    this.localPosition.add(displacementM);
    this.publishLocalPosition();
  }
  private radialForBody(body: WorldConfig["bodies"][number]) {
    return this.frame && this.frame.systemId === this.systemId && this.position.equals(this.publishedPosition)
      ? new THREE.Vector3().fromArray(this.frame.bodyRadialM(this.localPosition.toArray(), body))
      : new THREE.Vector3().fromArray(this.scale.universeDeltaToMetres(this.position.toArray(), body.position));
  }
  private setBodyRadialM(body: WorldConfig["bodies"][number], radialM: THREE.Vector3) {
    this.syncLocalFrame();
    this.localPosition.fromArray(this.frame.bodyRadialToLocal(radialM.toArray(), body));
    this.publishLocalPosition();
  }
  jump(id: BodyId) {
    this.resetWarp();
    this.landedBody = null;
    this.landingBody = null;
    this.landingPhase = "manual";
    this.deceleration = 0;
    const body = this.config.bodies.find((b) => b.id === id)!;
    this.systemId = bodySystem(body);
    const center = new THREE.Vector3().fromArray(body.position);
    const side =
      id === "sun" || center.lengthSq() === 0
        ? new THREE.Vector3(0, 0.2, -1)
        : center
            .clone()
            .negate()
            .normalize()
            .add(new THREE.Vector3(0, 0.18, 0))
            .normalize();
    if (body.kind === "station") {
      const earth = this.config.bodies.find(candidate => candidate.id === "earth")!;
      side.copy(center).sub(new THREE.Vector3().fromArray(earth.position)).normalize();
    }
    if (body.kind === "black-hole") side.normalize();
    const distance = Math.max(body.radius * (body.kind === "black-hole" ? 8 : id === "saturn" ? 5 : 3.8), body.radius + 1100 / this.config.unitsKm);
    this.position.copy(center).addScaledVector(side, distance);
    this.velocity.set(0, 0, 0);
    this.target = id;
    this.align();
    this.collision = null;
  }
  /** Start at a chosen terrain coordinate without an approach or landing animation. */
  placeOnSurface(id: BodyId, radial: [number, number, number]): string | null {
    const body = this.config.bodies.find(candidate => candidate.id === id);
    if (!body || body.kind === "station" || !surfaceProfile(id).solid)
      return surfaceProfile(id).landingReason ?? "请选择有固体地表的行星或卫星放置";
    if (!Array.isArray(radial) || radial.length !== 3 || !radial.every(Number.isFinite))
      return "地表位置无效，请重新选择放置点";
    const length = Math.hypot(...radial);
    if (!Number.isFinite(length) || length <= 1e-12)
      return "地表位置无效，请重新选择放置点";
    const normal = new THREE.Vector3().fromArray(radial).divideScalar(length);
    const height = terrainHeightKm(id, normal.toArray()) + LANDING_CLEARANCE_KM;
    const radius = body.radius + height / this.config.unitsKm;
    if (!Number.isFinite(radius) || radius <= 0)
      return "地表位置无效，请重新选择放置点";
    this.resetWarp();
    this.systemId = bodySystem(body);
    this.target = id;
    this.camera = "chase";
    this.deceleration = 0;
    this.position.fromArray(body.position).addScaledVector(normal, radius);
    this.touchDown(id);
    return null;
  }
  align() {
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    this.orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(), this.targetRelative, new THREE.Vector3(0, 1, 0),
    ));
  }
  get activeBodies() { return systemBodies(this.config, this.systemId); }
  get targetRelative() {
    const target = this.config.bodies.find(body => body.id === this.target)!;
    return new THREE.Vector3().fromArray(systemDisplacement(this.config, this.systemId,
      this.position.toArray(), bodySystem(target), target.position));
  }
  snapshot(): FlightState {
    this.syncLocalFrame();
    return {
      version: 2,
      coordinateVersion: 1,
      referenceFrame: this.frame.bodyId
        ? { kind: "body-fixed", bodyId: this.frame.bodyId, radialM: this.bodyRadialM.toArray() }
        : { kind: "system" },
      worldLayoutVersion: this.config.layoutVersion ?? 1,
      terrainVersion: TERRAIN_VERSION,
      ...(this.landedBody ? { landedBody: this.landedBody } : {}),
      systemId: this.systemId,
      engineMode: this.engineMode,
      cruiseSpeedKm: this.cruiseSpeedKm,
      lowFlightSpeedMps: this.lowFlightSpeedMps,
      position: this.position.toArray(),
      velocity: this.velocity.toArray(),
      orientation: this.orientation.toArray(),
      target: this.target,
      camera: this.camera,
      assist: this.assist,
      elapsed: this.elapsed,
    };
  }
  restore(value: unknown) {
    const saved = validateFlightState(value);
    if (!saved) return false;
    this.resetWarp();
    this.deceleration = 0;
    this.systemId = saved.systemId;
    this.position.fromArray(saved.position);
    this.syncLocalFrame();
    if (saved.referenceFrame?.kind === "body-fixed") {
      const reference = saved.referenceFrame;
      const body = this.config.bodies.find(candidate => candidate.id === reference.bodyId);
      if (body) {
        this.setBodyRadialM(body, new THREE.Vector3().fromArray(reference.radialM));
        // Keep the compatible universe projection byte-stable; the exact radial
        // is authoritative and its projection may differ by one universe ULP.
        this.position.fromArray(saved.position);
        this.publishedPosition.copy(this.position);
      }
    }
    this.velocity.fromArray(saved.velocity);
    this.orientation.fromArray(saved.orientation);
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    this.target = saved.target;
    this.cruiseSpeedKm = saved.cruiseSpeedKm ?? 100;
    this.lowFlightSpeedMps = saved.lowFlightSpeedMps ?? 1000;
    this.camera = saved.camera;
    this.assist = saved.assist;
    this.elapsed = saved.elapsed;
    this.landedBody = saved.landedBody ?? null;
    this.landingBody = this.landedBody;
    this.landingPhase = this.landedBody ? "landed" : "manual";
    this.resolveCollision(this.position.clone());
    this.clampCruiseSpeed();
    return true;
  }
  get environment() {
    this.syncLocalFrame();
    let body = this.activeBodies[0], altitudeKm = Infinity;
    for (const candidate of this.activeBodies) {
      if (candidate.kind === "station") continue;
      const altitude = (this.radialForBody(candidate).length() - this.scale.universeDistanceToMeters(candidate.radius)) / METRES_PER_KILOMETRE;
      if (altitude < altitudeKm) { body = candidate; altitudeKm = altitude; }
    }
    const nearHeightKm = this.config.flightSafety.nearSurfaceMinKm;
    const atmospheric = !!body.atmosphereKm && altitudeKm <= body.atmosphereKm;
    const surface = sampleSurface(this.config, body, this.radialForBody(body).toArray());
    const outward = new THREE.Vector3().fromArray(surface.normal);
    const profile = surfaceProfile(body.id);
    const groundHeightKm = surface.heightM / METRES_PER_KILOMETRE;
    const groundAltitudeKm = Math.max(0, altitudeKm - groundHeightKm - LANDING_CLEARANCE_KM);
    const density = atmospheric ? profile.density * Math.exp(-Math.max(0, altitudeKm) / profile.scaleKm) : 0;
    const headingOut = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation).dot(outward) > 0.25;
    const movingOut = this.velocity.dot(outward) >= -1e-9;
    const lowFlight = profile.solid && groundAltitudeKm <= 10 + SURFACE_EPSILON_KM;
    const escaping = false, orbitalRequired = false, restricted = false;
    return { body, altitudeKm: Math.max(0, altitudeKm), atmospheric, restricted, nearHeightKm, escaping,
      profile, density, groundHeightKm, groundAltitudeKm, outward, headingOut, movingOut, lowFlight, orbitalRequired };
  }
  get speedLimit() {
    return this.environment.lowFlight ? this.scale.metresToUniverseDistance(this.lowFlightSpeedMps)
      : this.scale.kilometresToUniverseDistance(this.cruiseSpeedKm);
  }
  get engine() {
    return this.config.engines.find(engine => engine.id === this.engineMode)!;
  }
  setCruiseSpeed(kilometresPerSecond: number): string | null {
    if (!Number.isFinite(kilometresPerSecond) || kilometresPerSecond < 1 || kilometresPerSecond > 150000) return "太空航速必须在 1–150,000 km/s 之间";
    this.cruiseSpeedKm = kilometresPerSecond;
    return null;
  }
  setLowFlightSpeed(metresPerSecond: number): string | null {
    if (!Number.isFinite(metresPerSecond) || metresPerSecond < 1 || metresPerSecond > 1000) return "低空航速必须在 1–1,000 m/s 之间";
    this.lowFlightSpeedMps = metresPerSecond;
    return null;
  }
  setEngineMode(mode: EngineMode): string | null {
    const band = PROPULSION_BANDS.find(band => band.id === mode);
    return band ? this.setCruiseSpeed(band.minKm) : "未知引擎档位";
  }
  get orbitalEngineActive() { return false; }
  get orbitalBlockReason(): string | null { return null; }
  startOrbitalEngine(): string | null {
    return null;
  }
  private clampCruiseSpeed() {
    const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
    const maximum = (this.environment.lowFlight ? 1 : 150000) / this.config.unitsKm;
    if (speed > maximum) this.velocity.divideScalar(speed).multiplyScalar(maximum);
  }
  step(seconds: number, input: FlightInput) {
    const duration = Math.max(0, Math.min(seconds, 0.25));
    if (!duration) return;
    this.deceleration *= Math.exp(-duration * 3);
    if (this.warping) { this.stepWarp(duration); return; }
    for (let remaining = duration; remaining > 1e-9; remaining -= 0.05)
      this.stepManual(Math.min(remaining, 0.05), input);
  }
  private stepManual(dt: number, input: FlightInput) {
    if (!dt) return;
    if (this.warpPhase === "cooldown") {
      this.warpClock += dt;
      this.warpProgress = Math.min(1, this.warpClock / this.config.warp.cooldownSeconds);
      if (this.warpProgress >= 1) this.resetWarp();
    }
    if (this.landingPhase === "landed") {
      this.elapsed += dt;
      this.velocity.set(0, 0, 0);
      if (input.lift > 0) this.takeOff();
      return;
    }
    if (this.landingPhase === "descending" || this.landingPhase === "ascending") {
      if (input.brake || input.throttle || input.strafe || input.lift || input.yaw || input.pitch || input.roll || input.mouseX || input.mouseY)
        this.cancelLanding();
      else { this.stepLanding(dt); return; }
    }
    const turn = new THREE.Vector3(
      THREE.MathUtils.clamp(input.pitch - input.mouseY, -1, 1) * 1.25,
      THREE.MathUtils.clamp(input.yaw - input.mouseX, -1, 1) * 1.25,
      input.roll * 1.7,
    );
    this.angularVelocity.lerp(turn, 1 - Math.exp(-dt * 9));
    this.bank = THREE.MathUtils.lerp(this.bank, -this.angularVelocity.y * 0.3, 1 - Math.exp(-dt * 5));
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        this.angularVelocity.x * dt,
        this.angularVelocity.y * dt,
        this.angularVelocity.z * dt,
        "YXZ",
      ),
    );
    this.orientation.multiply(rotation).normalize();
    if (this.assist && !input.strafe && !input.lift) {
      // Assisted flight carves a turn instead of sliding sideways indefinitely.
      const local = this.velocity.clone().applyQuaternion(this.orientation.clone().invert());
      const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
      const retainedSide = Math.hypot(local.x, local.y) * Math.exp(-dt * 3.5);
      const forwardSpeed = speed * Math.sqrt(Math.max(0, 1 - (speed ? retainedSide / speed : 0) ** 2));
      local.x *= Math.exp(-dt * 3.5);
      local.y *= Math.exp(-dt * 3.5);
      local.z = (local.z > 0 ? 1 : -1) * forwardSpeed;
      this.velocity.copy(local.applyQuaternion(this.orientation));
    }
    const environment = this.environment;
    const previousSpeedKm = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * this.config.unitsKm;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
    const slowing = input.throttle < 0 && this.velocity.dot(forward) * this.config.unitsKm > 0.000001;
    const acceleration = new THREE.Vector3(
      input.strafe,
      input.lift,
      slowing ? 0 : -input.throttle,
    );
    if (acceleration.lengthSq() > 1) acceleration.normalize();
    acceleration.applyQuaternion(this.orientation);
    const powered = !input.brake && !slowing && acceleration.lengthSq() > 0;
    // Powered flight compensates drag; releasing thrust restores atmospheric
    // drag and assisted drift, so each selected cruise speed remains reachable.
    if (environment.atmospheric && !acceleration.lengthSq())
      this.velocity.multiplyScalar(Math.exp(-Math.min(4, environment.density * 0.45) * dt));
    // Assisted near-ground flight counters local gravity; inertial flight must use lift.
    if (!this.assist && environment.profile.solid && environment.groundAltitudeKm < 5)
      this.velocity.addScaledVector(environment.outward, this.scale.metresToUniverseDistance(-environment.profile.gravity * dt));
    if (input.brake || slowing) {
      this.velocity.multiplyScalar(Math.exp(-(input.brake ? 8 : 2.8) * dt));
      if (slowing) {
        // Exponential braking alone approaches zero asymptotically, leaving S
        // stuck braking for seconds before reverse thrust can engage. Add a
        // finite stopping rate in the current engine region, then reverse on
        // the next step while S remains held.
        const speed = this.velocity.length();
        const stoppingRate = this.speedLimit * 0.5;
        this.velocity.multiplyScalar(speed ? Math.max(0, speed - stoppingRate * dt) / speed : 0);
      }
    }
    else if (this.assist && !acceleration.lengthSq()) {
      this.velocity.multiplyScalar(Math.exp(-0.1 * dt));
    }
    if (!powered && !input.brake && !slowing) {
      const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z);
      if (speed > this.speedLimit) {
        const nextSpeed = this.speedLimit + (speed - this.speedLimit) * Math.exp(-dt / 1.4);
        this.velocity.divideScalar(speed).multiplyScalar(nextSpeed);
      }
    }
    this.clampCruiseSpeed();
    if (Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * this.config.unitsKm < 0.000000001) this.velocity.set(0, 0, 0);
    const previous = this.position.clone();
    this.advanceManual(dt, acceleration, powered, input.boost);
    this.resolveCollision(previous);
    this.clampCruiseSpeed();
    const lostSpeedKm = previousSpeedKm - Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * this.config.unitsKm;
    if (lostSpeedKm > 0.05 && (input.brake || slowing || lostSpeedKm > Math.max(2, previousSpeedKm * 0.015)))
      this.deceleration = Math.max(this.deceleration, Math.min(1, lostSpeedKm / Math.max(10, previousSpeedKm * 0.15)));
    this.elapsed += dt;
  }
  private advanceManual(dt: number, thrust: THREE.Vector3, powered: boolean, boost: boolean) {
    let remaining = dt, lowFlight = this.environment.lowFlight;
    // A boundary may lie between two frames, including over a mountain ridge.
    // Spend the remaining time in the new engine region rather than applying
    // its speed to the entire frame or skipping through the low-flight volume.
    for (let crossing = 0; remaining > 1e-9 && crossing < 8; crossing++) {
      const initialVelocity = new THREE.Vector3().fromArray(this.scale.universeVelocityToMetres(this.velocity.toArray()));
      const tau = boost ? 0.7 : 1.4;
      const target = lowFlight ? this.lowFlightSpeedMps : this.cruiseSpeedKm * METRES_PER_KILOMETRE;
      const targetVelocity = powered ? thrust.clone().normalize().multiplyScalar(target) : initialVelocity;
      const difference = initialVelocity.clone().sub(targetVelocity);
      // Integrating the exponential response avoids using the frame's final
      // speed for its entire movement; short and long frames follow the same
      // acceleration and braking trajectory.
      const displacementAt = (time: number) => targetVelocity.clone().multiplyScalar(time)
        .addScaledVector(difference, tau * -Math.expm1(-time / tau));
      const velocityAt = (time: number) => targetVelocity.clone().addScaledVector(difference, Math.exp(-time / tau));
      const travel = displacementAt(remaining);
      const length = Math.hypot(travel.x, travel.y, travel.z);
      if (!length) return;
      const direction = travel.divideScalar(length);
      let boundary: { distance: number; position: THREE.Vector3 } | null = null;
      for (const body of this.activeBodies) {
        if (body.kind === "station" || !surfaceProfile(body.id).solid) continue;
        const candidate = this.lowFlightBoundary(body, this.position, direction, this.scale.metresToUniverseDistance(length), lowFlight);
        if (candidate) candidate.distance = this.scale.universeDistanceToMeters(candidate.distance);
        if (candidate && (!boundary || candidate.distance < boundary.distance)) boundary = candidate;
      }
      if (!boundary) {
        this.translateMetres(direction.clone().multiplyScalar(length));
        this.velocity.fromArray(this.scale.metresVelocityToUniverse(velocityAt(remaining).toArray()));
        return;
      }
      let lowTime = 0, highTime = remaining;
      for (let i = 0; i < 36; i++) {
        const middle = (lowTime + highTime) / 2;
        if (displacementAt(middle).dot(direction) < boundary.distance) lowTime = middle;
        else highTime = middle;
      }
      this.position.copy(boundary.position);
      this.syncLocalFrame();
      this.velocity.fromArray(this.scale.metresVelocityToUniverse(velocityAt(highTime).toArray()));
      remaining -= highTime;
      lowFlight = !lowFlight;
      if (lowFlight) {
        const speed = Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z), maximum = 1 / this.config.unitsKm;
        if (speed > maximum) this.velocity.divideScalar(speed).multiplyScalar(maximum);
      }
    }
    this.translateMetres(new THREE.Vector3().fromArray(this.scale.universeVelocityToMetres(this.velocity.toArray())).multiplyScalar(remaining));
  }
  private lowFlightBoundary(body: WorldConfig["bodies"][number], from: THREE.Vector3,
    direction: THREE.Vector3, length: number, inside: boolean) {
    const center = new THREE.Vector3().fromArray(body.position);
    const maximumTerrainKm = terrainMaxHeightKm(body.id);
    const outer = this.sphereRayChord(center, from, direction, length,
      body.radius + (10 + maximumTerrainKm + LANDING_CLEARANCE_KM + SURFACE_EPSILON_KM) / this.config.unitsKm);
    if (!outer) return null;
    const positionAt = (distance: number) => center.clone().add(outer.perpendicular).addScaledVector(direction, distance);
    const isInside = (distance: number) => {
      const position = positionAt(distance), radial = position.clone().sub(center);
      return (Math.hypot(radial.x, radial.y, radial.z) - this.physicalRadius(body, position)) * this.config.unitsKm
        <= 10 + SURFACE_EPSILON_KM;
    };
    // Only the body containing the initial low-flight position can be exited.
    if (inside && !isInside(-outer.projection)) return null;
    const start = Math.max(-outer.half, -outer.projection);
    let end = Math.min(outer.half, length - outer.projection);
    if (end < start) return null;
    if (!inside) {
      const inner = this.sphereRayChord(center, from, direction, length,
        body.radius + (10 + LANDING_CLEARANCE_KM) / this.config.unitsKm);
      if (inner && -inner.half >= start) end = Math.min(end, -inner.half);
    }
    const samples = Math.max(1, Math.min(4096, Math.ceil((end - start) * this.config.unitsKm / 0.125)));
    let low = start;
    for (let sample = 1; sample <= samples; sample++) {
      let high = start + (end - start) * sample / samples;
      if (isInside(high) === inside) { low = high; continue; }
      for (let i = 0; i < 36; i++) {
        const middle = (low + high) / 2;
        if (isInside(middle) === inside) low = middle;
        else high = middle;
      }
      return { distance: Math.max(0, outer.projection + high), position: positionAt(high) };
    }
    return null;
  }
  get warping() {
    return this.warpPhase === "charging" || this.warpPhase === "transit" || this.warpPhase === "arrival";
  }
  private resetWarp() {
    this.warpPhase = "ready";
    this.warpClock = 0;
    this.warpProgress = 0;
    this.warpSpeedKm = 0;
    this.warpRoute = [];
    this.warpApproach = undefined;
  }
  get warpBlockReason(): string | null {
    if (this.landingPhase !== "manual") return "请先起飞或中止着陆，再启动跃迁";
    if (this.warpPhase !== "ready") return "跃迁引擎正在工作或冷却";
    return null;
  }
  startWarp(): string | null {
    const blocked = this.warpBlockReason;
    if (blocked) return blocked;
    const target = this.config.bodies.find((b) => b.id === this.target)!;
    const destinationSystem = bodySystem(target);
    const center = new THREE.Vector3().fromArray(target.position);
    // Preserve the departure side, including transfers between systems.
    const radial = this.targetRelative.negate().normalize();
    if (target.kind === "station") {
      const earth = this.config.bodies.find(candidate => candidate.id === "earth")!;
      radial.copy(center).sub(new THREE.Vector3().fromArray(earth.position)).normalize();
    }
    const radius = Math.max(target.radius + Math.max(1100, (target.atmosphereKm ?? 0) + 300) / this.config.unitsKm,
      target.radius * (target.kind === "black-hole" ? 8 : target.kind === "star" ? 1.35 : target.id === "saturn" ? 2.45 : 1.015));
    const end = center.clone().addScaledVector(radial, radius);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.orientation);
    this.warpUp.copy(up);
    const departureRadius = this.targetRelative.length();
    // Begin braking while the planet is still a small disc. Nearby departures
    // keep their actual scale instead of travelling away to manufacture a zoom.
    let entryRadius = departureRadius <= radius ? departureRadius
      : Math.min(Math.max(target.radius * 32, radius * 8), radius + (departureRadius - radius) * 0.75);
    const approachSpeed = (distance: number) =>
      (distance > radius ? 2 * distance * Math.log(distance / radius) : 3 * (radius - distance)) / this.config.warp.arrivalSeconds;
    if (destinationSystem === this.systemId && departureRadius > radius) {
      const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
        new THREE.Vector3(), radial.clone().negate(), up));
      const steeringSeconds = Math.min(this.config.warp.travelSeconds,
        this.orientation.angleTo(facing) / 1.8 + 1);
      // Complete transit steering before the straight approach locks attitude.
      // Reserve enough distance to join it at the same speed, even on short hops.
      let low = radius, high = entryRadius;
      for (let i = 0; i < 32; i++) {
        const candidate = (low + high) / 2;
        if (approachSpeed(candidate) * steeringSeconds <= departureRadius - candidate) low = candidate;
        else high = candidate;
      }
      entryRadius = low;
    }
    let entry = center.clone().addScaledVector(radial, entryRadius);
    let clearApproach = false;
    for (let i = 0; i < 24; i++) {
      const segment = this.safeRoute(entry, end, destinationSystem);
      if (segment?.length === 2) { clearApproach = true; break; }
      // A moon or parent planet may obstruct a long radial approach. Keep the
      // safe, uninterrupted final section; transit handles any earlier detour.
      entryRadius = (entryRadius + radius) / 2;
      entry = center.clone().addScaledVector(radial, entryRadius);
    }
    if (!clearApproach) return "接近航线受阻，请先调整位置";
    let points: RoutePoint[];
    if (destinationSystem === this.systemId) {
      const route = this.safeRoute(this.position, entry, this.systemId);
      if (!route) return "当前航线无法安全跃迁，请调整位置";
      points = route.map(position => ({ systemId: this.systemId, position }));
    } else {
      const direction = this.targetRelative.normalize();
      const gateDistance = this.config.auKm * 100 / this.config.unitsKm;
      const departure = this.position.clone().addScaledVector(direction, gateDistance);
      const arrival = entry.clone().addScaledVector(direction, -gateDistance);
      const leaving = this.safeRoute(this.position, departure, this.systemId);
      const entering = this.safeRoute(arrival, entry, destinationSystem);
      if (!leaving || !entering) return "跨恒星系统航线受阻，请先调整位置";
      points = [...leaving.map(position => ({ systemId: this.systemId, position })),
        ...entering.map(position => ({ systemId: destinationSystem, position }))];
    }
    this.warpRoute = points;
    this.warpLength = points.slice(1).reduce((sum, point, i) => sum + this.routeDisplacement(points[i], point).length(), 0);
    this.warpApproach = { center, radial, entryRadius, endRadius: radius };
    this.warpApproachSpeed = approachSpeed(entryRadius);
    this.warpTransitSeconds = this.warpLength < 1e-8 ? 0
      : Math.min(this.config.warp.travelSeconds, this.warpLength / this.warpApproachSpeed);
    this.warpTarget = this.target;
    this.warpPhase = "charging";
    this.warpClock = 0;
    this.warpProgress = 0;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    return null;
  }
  private routeDisplacement(a: RoutePoint, b: RoutePoint) {
    return new THREE.Vector3().fromArray(systemDisplacement(this.config, a.systemId,
      a.position.toArray(), b.systemId, b.position.toArray()));
  }
  private safeRoute(from: THREE.Vector3, to: THREE.Vector3, systemId: SystemId): THREE.Vector3[] | null {
    const points = [from.clone(), to.clone()];
    for (let attempt = 0; attempt < 64; attempt++) {
      let obstacle = false;
      for (let i = 0; i < points.length - 1 && !obstacle; i++) {
        const a = points[i], b = points[i + 1];
        const line = b.clone().sub(a), lengthSq = line.lengthSq();
        if (!lengthSq) continue;
        for (const body of systemBodies(this.config, systemId)) {
          const center = new THREE.Vector3().fromArray(body.position);
          const t = THREE.MathUtils.clamp(center.clone().sub(a).dot(line) / lengthSq, 0, 1);
          const closest = a.clone().addScaledVector(line, t);
          // Avoid physical terrain and body geometry. Black holes instead use
          // the same fictional 6R exclusion barrier as manual flight; this is
          // game safety, not an event horizon or relativistic orbit model.
          // Surface departures first clear terrain radially.
          const terrainKm = surfaceProfile(body.id).solid ? terrainMaxHeightKm(body.id) + LANDING_CLEARANCE_KM : 0;
          const radius = body.radius * (body.kind === "black-hole" ? 6 : 1) + (terrainKm + SURFACE_EPSILON_KM) / this.config.unitsKm;
          if (closest.distanceTo(center) >= radius) continue;
          const aRadial = a.clone().sub(center), bRadial = b.clone().sub(center);
          const aDistance = aRadial.length(), bDistance = bRadial.length();
          if (aDistance < radius) {
            if (aDistance < this.physicalRadius(body, a) - SURFACE_EPSILON_KM / this.config.unitsKm) return null;
            if (bDistance >= radius && line.clone().normalize().dot(aRadial.clone().normalize()) > 1 - 1e-8) continue;
            points.splice(i + 1, 0, center.clone().addScaledVector(aRadial.normalize(), radius + SURFACE_EPSILON_KM / this.config.unitsKm));
            obstacle = true;
            break;
          }
          if (bDistance < radius) {
            if (bDistance < this.physicalRadius(body, b) - SURFACE_EPSILON_KM / this.config.unitsKm) return null;
            if (line.clone().normalize().dot(bRadial.clone().normalize()) < -1 + 1e-8) continue;
            points.splice(i + 1, 0, center.clone().addScaledVector(bRadial.normalize(), radius + SURFACE_EPSILON_KM / this.config.unitsKm));
            obstacle = true;
            break;
          }
          if (t <= 0 || t >= 1) return null;
          const outward = closest.sub(center);
          if (outward.lengthSq() < 1e-12) outward.crossVectors(line, new THREE.Vector3(0, 1, 0));
          if (outward.lengthSq() < 1e-12) outward.set(1, 0, 0);
          points.splice(i + 1, 0, center.addScaledVector(outward.normalize(), radius * 2));
          obstacle = true;
          break;
        }
      }
      if (!obstacle) return points;
    }
    return null;
  }
  cancelWarp() {
    if (!this.warping) return;
    this.warpPhase = "cooldown";
    this.warpClock = 0;
    this.warpProgress = 0;
    this.warpSpeedKm = 0;
    this.velocity.set(0, 0, 0);
    this.resolveCollision(this.position.clone());
  }
  private stepWarp(dt: number) {
    this.warpClock += dt;
    this.elapsed += dt;
    const durations = this.config.warp;
    const duration = this.warpPhase === "charging" ? durations.chargeSeconds : this.warpPhase === "transit" ? this.warpTransitSeconds : durations.arrivalSeconds;
    this.warpProgress = Math.min(1, this.warpClock / duration);
    this.warpSpeedKm = 0;
    if (this.warpPhase === "transit") {
      const t = this.warpProgress;
      const slope = Math.min(1, this.warpApproachSpeed * duration / this.warpLength);
      const travelled = (t * t * (3 - 2 * t) + slope * (t * t * t - t * t)) * this.warpLength;
      let distance = travelled;
      for (let i = 0; i < this.warpRoute.length - 1; i++) {
        const a = this.warpRoute[i], b = this.warpRoute[i + 1];
        const displacement = this.routeDisplacement(a, b), length = displacement.length();
        if (distance <= length || i === this.warpRoute.length - 2) {
          const blend = length ? Math.min(1, distance / length) : 1;
          // Interpolate from the closer local origin. The final approach never
          // subtracts two light-year-scale coordinates to recover a small height.
          if (a.systemId === b.systemId || blend <= 0.5) {
            this.systemId = a.systemId;
            this.position.copy(a.position).addScaledVector(displacement, blend);
          } else {
            this.systemId = b.systemId;
            this.position.copy(b.position).addScaledVector(displacement, -(1 - blend));
          }
          // Keep the destination visible after an avoidance detour. Finish
          // transit steering here; the arrival approach never changes attitude.
          this.faceWarpDirection(i === this.warpRoute.length - 2 ? this.targetRelative : displacement, dt);
          break;
        }
        distance -= length;
      }
      this.warpSpeedKm = (6 * t * (1 - t) + slope * (3 * t * t - 2 * t)) * this.warpLength * this.config.unitsKm / duration;
    } else if (this.warpPhase === "arrival" && this.warpApproach) {
      const t = this.warpProgress;
      const approach = this.warpApproach;
      const ratio = Math.log(approach.entryRadius / approach.endRadius);
      // Ease distance logarithmically so angular size grows throughout the
      // approach, with continuous entry speed and a complete stop at the end.
      const distance = ratio > 0 ? approach.endRadius * Math.exp(ratio * (1 - t) ** 2)
        : approach.endRadius + (approach.entryRadius - approach.endRadius) * (1 - t) ** 3;
      this.position.copy(approach.center).addScaledVector(approach.radial, distance);
      this.warpSpeedKm = (ratio > 0 ? distance * 2 * ratio * (1 - t)
        : 3 * (approach.endRadius - approach.entryRadius) * (1 - t) ** 2) * this.config.unitsKm / duration;
      this.deceleration = 0.45 * (1 - t);
    }
    if (this.warpProgress < 1) return;
    this.warpClock = 0;
    this.warpProgress = 0;
    if (this.warpPhase === "charging") this.warpPhase = this.warpTransitSeconds > 0 ? "transit" : "arrival";
    else if (this.warpPhase === "transit") {
      const arrival = this.warpRoute[this.warpRoute.length - 1];
      this.systemId = arrival.systemId;
      this.position.copy(arrival.position);
      this.target = this.warpTarget;
      this.warpPhase = "arrival";
    } else {
      this.warpPhase = "cooldown";
      this.velocity.set(0, 0, 0);
      this.warpSpeedKm = 0;
      this.resolveCollision(this.position.clone());
    }
  }
  private faceWarpDirection(direction: THREE.Vector3, dt: number) {
    const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
      new THREE.Vector3(), direction, this.warpUp));
    const angle = this.orientation.angleTo(facing);
    this.orientation.slerp(facing, Math.min(1 - Math.exp(-dt * 6), angle > 1e-9 ? dt * 1.8 / angle : 1));
  }
  private resolveCollision(previous: THREE.Vector3) {
    this.collision = null;
    if (this.landedBody) return;
    const travel = this.position.clone().sub(previous);
    const length = Math.hypot(travel.x, travel.y, travel.z);
    const direction = length ? travel.clone().divideScalar(length) : new THREE.Vector3();
    let earliest = length,
      hit: { id: BodyId; center: THREE.Vector3; position: THREE.Vector3; gentle: boolean } | undefined;
    for (const body of this.activeBodies) {
      const center = new THREE.Vector3().fromArray(body.position);
      const solid = surfaceProfile(body.id).solid;
      const gentle = solid && Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * this.config.unitsKm <= 0.3;
      const radius = this.physicalRadius(body, previous);
      const offset = previous.clone().sub(center);
      if (Math.hypot(offset.x, offset.y, offset.z) < radius) {
        const normal = this.position.clone().sub(center);
        const normalLength = Math.hypot(normal.x, normal.y, normal.z);
        if (normalLength) normal.divideScalar(normalLength);
        else normal.set(0, 1, 0);
        const contact = center.clone().add(normal);
        const correctionRadius = this.physicalRadius(body, contact);
        this.position
          .copy(center)
          .addScaledVector(normal, correctionRadius + SURFACE_EPSILON_KM / this.config.unitsKm);
        this.velocity.set(0, 0, 0);
        this.collision = body.id;
        if (gentle) this.touchDown(body.id);
        return;
      }
      if (!length) continue;
      if (solid) {
        const contact = this.terrainCollision(body, previous, direction, length);
        if (contact && contact.distance <= earliest) {
          earliest = contact.distance;
          hit = { id: body.id, center, position: contact.position, gentle };
        }
        continue;
      }
      const chord = this.sphereRayChord(center, previous, direction, length, radius);
      if (!chord) continue;
      const distance = chord.projection - chord.half;
      if (distance >= 0 && distance <= earliest) {
        earliest = distance;
        hit = { id: body.id, center,
          position: center.clone().add(chord.perpendicular).addScaledVector(direction, -chord.half), gentle };
      }
    }
    if (hit) {
      // Compute contact in the body's local chord, rather than subtracting
      // enormous travelled distances to recover a metre-scale surface point.
      this.position.copy(hit.position);
      const normal = this.position.clone().sub(hit.center).normalize();
      this.position.addScaledVector(normal, SURFACE_EPSILON_KM / this.config.unitsKm);
      this.velocity.set(0, 0, 0);
      this.collision = hit.id;
      if (hit.gentle)
        this.touchDown(hit.id);
    }
  }
  private physicalRadius(body: WorldConfig["bodies"][number], position: THREE.Vector3) {
    // No solid surface or GR collision is implied by this gameplay barrier.
    if (body.kind === "black-hole") return body.radius * 6;
    if (!surfaceProfile(body.id).solid) return body.radius;
    const normal = position.clone().sub(new THREE.Vector3().fromArray(body.position));
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length) normal.divideScalar(length);
    return this.scale.metresToUniverseDistance(surfaceRadiusM(this.config, body, normal.toArray())
      + LANDING_CLEARANCE_KM * METRES_PER_KILOMETRE);
  }
  private sphereRayChord(center: THREE.Vector3, from: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number) {
    const offset = from.clone().sub(center);
    if (Math.hypot(offset.x, offset.y, offset.z) > length + radius) return null;
    const projection = -offset.dot(direction);
    if (projection + radius < 0 || projection - radius > length) return null;
    const perpendicular = offset.addScaledVector(direction, projection);
    const distance = Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z);
    if (distance > radius) return null;
    // A unit ray keeps every squared quantity at body scale even when the
    // selected cruise speed and segment length are close to Number.MAX_VALUE.
    return { projection, perpendicular, half: Math.sqrt((radius - distance) * (radius + distance)) };
  }
  private terrainCollision(body: WorldConfig["bodies"][number], from: THREE.Vector3, direction: THREE.Vector3, length: number) {
    const center = new THREE.Vector3().fromArray(body.position);
    // This envelope only culls impossible physical contacts; it never changes
    // velocity or reports a collision until the actual terrain is touched.
    const maximumTerrainKm = terrainMaxHeightKm(body.id) + LANDING_CLEARANCE_KM;
    const outer = this.sphereRayChord(center, from, direction, length, body.radius + maximumTerrainKm / this.config.unitsKm);
    if (!outer) return null;
    const start = Math.max(-outer.half, -outer.projection);
    let end = Math.min(outer.half, length - outer.projection);
    if (end < start) return null;
    // Reaching the reference sphere guarantees contact with positive terrain.
    // Stop sampling there rather than searching through the body's interior.
    const inner = this.sphereRayChord(center, from, direction, length, body.radius + LANDING_CLEARANCE_KM / this.config.unitsKm);
    if (inner && -inner.half >= start) end = Math.min(end, -inner.half);
    const positionAt = (distance: number) => center.clone().add(outer.perpendicular).addScaledVector(direction, distance);
    const clearance = (distance: number) => {
      const position = positionAt(distance), radial = position.clone().sub(center);
      return Math.hypot(radial.x, radial.y, radial.z) - this.physicalRadius(body, position);
    };
    const sampleKm = body.id === "earth" ? 0.25 : Math.max(0.005, body.radius * this.config.unitsKm / 57600);
    const samples = Math.max(1, Math.min(4096, Math.ceil((end - start) * this.config.unitsKm / sampleKm)));
    let low = start;
    if (clearance(start) <= 0) return { distance: outer.projection + start, position: positionAt(start) };
    for (let sample = 1; sample <= samples; sample++) {
      let high = start + (end - start) * sample / samples;
      if (clearance(high) > 0) { low = high; continue; }
      for (let i = 0; i < 36; i++) {
        const middle = (low + high) / 2;
        if (clearance(middle) <= 0) high = middle;
        else low = middle;
      }
      return { distance: outer.projection + high, position: positionAt(high) };
    }
    return null;
  }

  get landingBlockReason(): string | null {
    if (this.warping) return "跃迁期间无法着陆";
    const target = this.config.bodies.find(body => body.id === this.target);
    if (target?.kind === "black-hole") return surfaceProfile(target.id).landingReason ?? "黑洞没有可着陆的固体地表";
    const environment = this.environment;
    if (this.target === "earth-station") return "空间站暂不支持自动对接，请手动近距离观测";
    if (!environment.profile.solid) return environment.profile.landingReason ?? (environment.body.kind === "star" ? "恒星无法着陆" : "气态或冰巨行星没有可降落的固体地表，请选择卫星");
    if (environment.body.id !== this.target) return "请先接近并选择要着陆的天体";
    if (environment.altitudeKm > Math.max(environment.body.radius * this.config.unitsKm * 5, 2000))
      return "距离地表太远，请先跃迁或驾驶接近目标";
    return null;
  }
  startLanding(): string | null {
    const blocked = this.landingBlockReason;
    if (blocked) return blocked;
    this.landingBody = this.environment.body.id;
    this.landingPhase = "descending";
    this.landedBody = null;
    this.collision = null;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    return null;
  }
  cancelLanding() {
    if (this.landingPhase === "landed") return;
    this.landingPhase = "manual";
    this.landingBody = null;
    this.velocity.set(0, 0, 0);
  }
  takeOff(): string | null {
    if (!this.landedBody) return "请先在地表着陆";
    this.landingBody = this.landedBody;
    this.landedBody = null;
    this.landingPhase = "ascending";
    this.collision = null;
    this.velocity.set(0, 0, 0);
    return null;
  }
  private surfaceAttitude(normal: THREE.Vector3, ascending = false) {
    let forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation).projectOnPlane(normal);
    if (forward.lengthSq() < 1e-8) forward = new THREE.Vector3(0, 1, 0).cross(normal);
    if (forward.lengthSq() < 1e-8) forward.set(1, 0, 0);
    forward.normalize();
    const up = ascending ? forward.clone().negate() : normal;
    const target = ascending ? normal : forward;
    this.orientation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), target, up));
  }
  private touchDown(id: BodyId) {
    const body = this.config.bodies.find((candidate) => candidate.id === id)!;
    this.syncLocalFrame();
    const normal = this.radialForBody(body).normalize();
    this.setBodyRadialM(body, normal.clone().multiplyScalar(surfaceRadiusM(this.config, body, normal.toArray())
      + LANDING_CLEARANCE_KM * METRES_PER_KILOMETRE));
    this.surfaceAttitude(normal);
    this.landedBody = id;
    this.landingBody = id;
    this.landingPhase = "landed";
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    this.collision = null;
  }
  private stepLanding(dt: number) {
    const body = this.config.bodies.find((candidate) => candidate.id === this.landingBody)!;
    this.syncLocalFrame();
    const surface = sampleSurface(this.config, body, this.radialForBody(body).toArray());
    const normal = new THREE.Vector3().fromArray(surface.normal);
    const altitude = (surface.clearanceM - LANDING_CLEARANCE_KM * METRES_PER_KILOMETRE) / METRES_PER_KILOMETRE;
    const ascending = this.landingPhase === "ascending";
    this.surfaceAttitude(normal, ascending);
    const proposedSpeedKm = ascending ? Math.max(0.015, altitude * 0.8) : Math.max(0.005, altitude * 0.65);
    let nextAltitude = altitude, speedKm = proposedSpeedKm, remaining = dt;
    while (remaining > 1e-9) {
      const lowFlight = nextAltitude <= 10 + SURFACE_EPSILON_KM;
      speedKm = Math.min(proposedSpeedKm, lowFlight ? this.lowFlightSpeedMps / METRES_PER_KILOMETRE : this.cruiseSpeedKm);
      if (ascending) { nextAltitude += speedKm * remaining; break; }
      const boundary = lowFlight ? 0 : 10 + SURFACE_EPSILON_KM;
      const toBoundary = Math.max(0, nextAltitude - boundary) / speedKm;
      if (toBoundary >= remaining) { nextAltitude = Math.max(0, nextAltitude - speedKm * remaining); break; }
      nextAltitude = boundary;
      remaining -= toBoundary;
      if (boundary === 0) { speedKm = 0; break; }
    }
    this.setBodyRadialM(body, normal.clone().multiplyScalar(surface.radiusM
      + (LANDING_CLEARANCE_KM + nextAltitude) * METRES_PER_KILOMETRE));
    this.velocity.copy(normal).multiplyScalar(this.scale.kilometresToUniverseDistance((ascending ? 1 : -1) * speedKm));
    this.elapsed += dt;
    if (!ascending && nextAltitude === 0) this.touchDown(body.id);
    else if (ascending && nextAltitude >= 2) { this.landingPhase = "manual"; this.landingBody = null; }
  }
}
