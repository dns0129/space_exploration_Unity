import { terrainHeightKm } from './surface.mjs';

/** System navigation uses kilometres / unitsKm; nearby simulation uses metres and seconds.
 * Both frames are right handed (+X right, +Y up, forward -Z). A frame quaternion
 * rotates local axes into system axes. Current ephemerides and surface maps are
 * frozen during flight: their body frame has identity rotation and zero motion.
 */
export const METRES_PER_KILOMETRE = 1000;
export const FLOATING_ORIGIN_DISTANCE_M = 256;
const zero = () => [0, 0, 0];
const add = (a, b) => a.map((n, i) => n + b[i]);
const subtract = (a, b) => a.map((n, i) => n - b[i]);
const multiply = (a, factor) => a.map(n => n * factor);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const inverse = q => [-q[0], -q[1], -q[2], q[3]];
function quaternionProduct(a, b) {
  return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
}
function rotate(vector, quaternion) {
  const uv = cross(quaternion, vector), uuv = cross(quaternion, uv);
  return vector.map((n, i) => n + 2 * (quaternion[3] * uv[i] + uuv[i]));
}

export class SpatialScale {
  constructor(unitsKm) {
    if (!Number.isFinite(unitsKm) || unitsKm <= 0) throw new RangeError('unitsKm must be positive');
    this.unitsKm = unitsKm;
    this.metresPerUnit = unitsKm * METRES_PER_KILOMETRE;
    this.metersPerUniverseUnit = this.metresPerUnit;
  }
  universeDistanceToMeters(value) { return value * this.metresPerUnit; }
  universeDistanceToKilometres(value) { return value * this.unitsKm; }
  kilometresToUniverseDistance(value) { return value / this.unitsKm; }
  metresToUniverseDistance(value) { return value / this.metresPerUnit; }
  universeDeltaToMetres(position, origin) { return multiply(subtract(position, origin), this.metresPerUnit); }
  metresOffsetToUniverse(offset, origin = zero()) { return add(origin, multiply(offset, 1 / this.metresPerUnit)); }
  universeVelocityToMetres(velocity) { return multiply(velocity, this.metresPerUnit); }
  metresVelocityToUniverse(velocity) { return multiply(velocity, 1 / this.metresPerUnit); }
}

/** Floating origins keep an immutable universe anchor plus double precision metre
 * offsets. Repeated recentering never roundtrips the origin through AU coordinates.
 * Callers translate every local rigid body/collider/render anchor by -shiftM;
 * velocities, quaternions and collider handles are unchanged by that translation.
 */
export class FloatingOriginFrame {
  constructor(scale, options = {}) {
    this.scale = scale;
    this.anchorUniverse = [...(options.originUniverse ?? zero())];
    this.originOffsetM = zero();
    const orientation = options.orientation ?? [0, 0, 0, 1];
    const length = Math.hypot(...orientation);
    if (!length || !Number.isFinite(length)) throw new RangeError('Invalid frame orientation');
    this.orientation = orientation.map(n => n / length);
    this.originVelocityMps = [...(options.originVelocityMps ?? zero())];
    this.angularVelocityRadps = [...(options.angularVelocityRadps ?? zero())];
    this.bodyId = options.bodyId ?? null;
    this.systemId = options.systemId ?? 'solar';
    this.rebaseDistanceM = options.rebaseDistanceM ?? FLOATING_ORIGIN_DISTANCE_M;
    if (!(this.rebaseDistanceM > 0)) throw new RangeError('Rebase distance must be positive');
    this.revision = 0;
  }
  get originUniverse() { return this.scale.metresOffsetToUniverse(this.vectorToUniverse(this.originOffsetM), this.anchorUniverse); }
  vectorToLocal(vector) { return rotate(vector, inverse(this.orientation)); }
  vectorToUniverse(vector) { return rotate(vector, this.orientation); }
  universeToLocal(position) { return subtract(this.vectorToLocal(this.scale.universeDeltaToMetres(position, this.anchorUniverse)), this.originOffsetM); }
  localToUniverse(positionM) { return this.scale.metresOffsetToUniverse(this.vectorToUniverse(add(positionM, this.originOffsetM)), this.anchorUniverse); }
  /** Velocity transport is v = V_origin + omega x r + R v_local. */
  universeVelocityToLocal(velocity, positionM = zero()) {
    const relative = subtract(this.scale.universeVelocityToMetres(velocity), this.originVelocityMps);
    return subtract(this.vectorToLocal(relative), cross(this.vectorToLocal(this.angularVelocityRadps), positionM));
  }
  localVelocityToUniverse(velocityMps, positionM = zero()) {
    const local = add(velocityMps, cross(this.vectorToLocal(this.angularVelocityRadps), positionM));
    return this.scale.metresVelocityToUniverse(add(this.vectorToUniverse(local), this.originVelocityMps));
  }
  orientationToLocal(orientation) { return quaternionProduct(inverse(this.orientation), orientation); }
  orientationToUniverse(orientation) { return quaternionProduct(this.orientation, orientation); }
  /** Convert local coordinates to a stable radial in the body's frozen surface axes. */
  bodyRadialM(positionM, body) {
    return add(this.scale.universeDeltaToMetres(this.anchorUniverse, body.position),
      this.vectorToUniverse(add(this.originOffsetM, positionM)));
  }
  /** Map a body radial to local metres without adding/subtracting its universe centre. */
  bodyRadialToLocal(radialM, body) {
    const anchorRadial = this.scale.universeDeltaToMetres(this.anchorUniverse, body.position);
    return subtract(this.vectorToLocal(subtract(radialM, anchorRadial)), this.originOffsetM);
  }
  rebase(focusLocalM) {
    if (Math.hypot(...focusLocalM) < this.rebaseDistanceM) return null;
    const shift = [...focusLocalM];
    this.originOffsetM = add(this.originOffsetM, shift);
    // A rotating reference frame's new origin has a different transport velocity.
    this.originVelocityMps = add(this.originVelocityMps,
      cross(this.angularVelocityRadps, this.vectorToUniverse(shift)));
    this.revision++;
    return shift;
  }
}

export function surfaceRadiusM(config, body, normal) {
  return body.radius * config.unitsKm * METRES_PER_KILOMETRE
    + terrainHeightKm(body.id, normal) * METRES_PER_KILOMETRE;
}
/** One canonical CPU surface sample is used by rendering, landing and Rapier. */
export function sampleSurface(config, body, radialM) {
  const distanceM = Math.hypot(...radialM);
  const normal = distanceM ? multiply(radialM, 1 / distanceM) : [0, 1, 0];
  const radiusM = surfaceRadiusM(config, body, normal);
  return { normal, radiusM,
    heightM: radiusM - body.radius * config.unitsKm * METRES_PER_KILOMETRE,
    clearanceM: distanceM - radiusM, surfaceRadialM: multiply(normal, radiusM) };
}
