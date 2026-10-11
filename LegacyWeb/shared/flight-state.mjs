import world from "./world.json" with { type: "json" };
import { surfaceProfile, terrainHeightKm, legacyTerrainHeightKm, TERRAIN_VERSION, LANDING_CLEARANCE_KM } from "./surface.mjs";
import { propulsionBand } from "./propulsion.mjs";
import { SpatialScale, METRES_PER_KILOMETRE } from "./spatial-frame.mjs";
import { stationWalkable } from "./station-layout.mjs";
export { world };
// A rounded character capsule rests slightly above the radial height on a
// slope. This is a contact allowance, not permission to restore below ground.
export const WALKING_GROUNDED_CLEARANCE_M = 0.20;
const systemIds = new Set(world.systems.map(system => system.id));
const ids = new Set(world.bodies.map((body) => body.id));
// Stage 03 used a compressed world. Re-anchor old saves relative to their destination.
const legacy = {
  sun: [8, [0, 0, 0]], mercury: [0.4, [14, 0, 13]], venus: [0.95, [-28, 1, 4]],
  earth: [1, [0, 0, 42]], mars: [0.58, [41, 1, -38]], jupiter: [5.4, [-79, -3, -47]],
  saturn: [4.6, [78, 4, 96]], uranus: [2.5, [-147, 5, 65]], neptune: [2.45, [80, -4, -180]],
};
const vector = (value, count, bound) =>
  Array.isArray(value) &&
  value.length === count &&
  value.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= bound,
  );
// Keep already normalized quaternions byte-stable across repeated validation.
const normalizedQuaternion = (value, norm) => Math.abs(norm - 1) < 1e-10 ? [...value] : value.map(n => n / norm);
// Body-relative metres retain the precision lost when adding a small surface
// displacement to a solar-system position. Never persist a Rapier/world origin.
function bodyRadialM(config, body, position, referenceFrame) {
  const scale = new SpatialScale(config.unitsKm);
  if (referenceFrame?.kind === "body-fixed" && referenceFrame.bodyId === body.id) {
    if (!vector(referenceFrame.radialM, 3, 1e15)) return null;
    const expected = scale.metresOffsetToUniverse(referenceFrame.radialM, body.position);
    const toleranceM = .001 + Number.EPSILON * Math.max(1, ...position.map(Math.abs), ...body.position.map(Math.abs)) * scale.metresPerUnit * 8;
    if (Math.hypot(...scale.universeDeltaToMetres(position, expected)) > toleranceM) return null;
    return [...referenceFrame.radialM];
  }
  return scale.universeDeltaToMetres(position, body.position);
}
function validateReferenceFrame(value, position) {
  if (value.referenceFrame === undefined) return undefined;
  const reference = value.referenceFrame;
  if (!reference || typeof reference !== "object" || !["system", "body-fixed"].includes(reference.kind)) return null;
  if (reference.kind === "system") {
    if (reference.bodyId !== undefined || reference.radialM !== undefined) return null;
    return { kind: "system" };
  }
  const body = world.bodies.find(candidate => candidate.id === reference.bodyId);
  if (!body || (body.systemId ?? "solar") !== (value.systemId ?? "solar")
    || (value.landedBody && value.landedBody !== body.id)) return null;
  const radialM = bodyRadialM(world, body, position, reference);
  return radialM ? { kind: "body-fixed", bodyId: body.id, radialM } : null;
}
// Layout 1 placed every planet in the ecliptic; layout 2 already has the current
// planet positions, but precedes the station's move to Earth's sunlit side.
// Keep those histories separate so upgrading the station never moves a v2
// planet save a second time. Deep-space coordinates remain absolute.
function migrateLayoutPosition(value, position) {
  if (value.version !== 2 || (value.worldLayoutVersion ?? 1) >= (world.layoutVersion ?? 1)) return position;
  const layout = value.worldLayoutVersion ?? 1;
  const bodies = world.bodies.filter(body => (body.systemId ?? "solar") === (value.systemId ?? "solar"));
  const previousPosition = body => layout < 2 || body.id === "earth-station"
    ? body.previousPosition ?? body.position : body.position;
  const distanceTo = (body, previous) => Math.hypot(...position.map((n, i) => n - (previous ? previousPosition(body) : body.position)[i]));
  // Earth's large surface can be nearer than the small station itself. A save
  // explicitly approaching the station retains that destination's local offset.
  const station = !value.landedBody && value.target === "earth-station"
    ? bodies.find(body => body.id === "earth-station") : undefined;
  const stationApproach = station && distanceTo(station, true) <= station.radius + 1800 / world.unitsKm;
  const anchor = value.landedBody ? bodies.find(body => body.id === value.landedBody)
    : stationApproach ? station
    : bodies.reduce((nearest, body) => !nearest || distanceTo(body, true) - body.radius < distanceTo(nearest, true) - nearest.radius ? body : nearest, undefined);
  if (!anchor || previousPosition(anchor).every((n, i) => n === anchor.position[i])) return position;
  const oldDistance = distanceTo(anchor, true);
  const currentDistance = Math.min(...bodies.map(body => distanceTo(body, false) - body.radius));
  if ((!stationApproach && oldDistance - anchor.radius >= currentDistance)
    || (!value.landedBody && oldDistance - anchor.radius > Math.max(1e6 / world.unitsKm, anchor.radius * 20))) return position;
  return position.map((n, i) => anchor.position[i] + (n - previousPosition(anchor)[i]));
}
// Legacy station visits require a parked shuttle near the original berth.
// Starship visits carry the cabin pose independently of the vessel flight frame.
export function validateStationVisitState(value, flight, config = world) {
  if (!value || typeof value !== "object" || !flight || value.bodyId !== "earth-station"
    || !vector(value.positionM, 3, 1e4) || value.positionM[1] < 0 || value.positionM[1] > 2.4
    || !stationWalkable(value.positionM)
    || typeof value.yaw !== "number" || !Number.isFinite(value.yaw) || Math.abs(value.yaw) > 1e6
    || typeof value.pitch !== "number" || !Number.isFinite(value.pitch) || Math.abs(value.pitch) > 1.25
    || !["first", "third"].includes(value.camera)
    || (value.vessel !== undefined && value.vessel !== true)
    || (value.piloting !== undefined && typeof value.piloting !== "boolean")
    || (value.piloting === true && value.vessel !== true)
    || (!value.vessel && ((flight.systemId ?? "solar") !== "solar" || flight.target !== "earth-station"))
    || (!value.vessel && flight.landedBody !== undefined) || flight.walking !== undefined
    || !vector(flight.position, 3, Infinity) || !vector(flight.velocity, 3, Infinity)
    || (!value.vessel && Math.hypot(...flight.velocity) > 1e-9)) return null;
  if (value.vessel) return { bodyId: "earth-station", positionM: [...value.positionM],
    yaw: value.yaw, pitch: value.pitch, camera: value.camera, vessel: true, piloting: value.piloting ?? false };
  const station = config.bodies.find(body => body.id === "earth-station");
  const earth = config.bodies.find(body => body.id === "earth");
  if (!station || station.kind !== "station" || !earth) return null;
  const stationDistance = Math.hypot(...flight.position.map((n, i) => n - station.position[i]));
  const earthDistance = Math.hypot(...flight.position.map((n, i) => n - earth.position[i]));
  const earthClearance = Math.max(config.flightSafety.nearSurfaceMinKm / config.unitsKm,
    earth.radius * config.flightSafety.nearSurfaceRadiusFactor, earth.radius * .002);
  if (stationDistance < station.radius * 1.002 || stationDistance > station.radius + 1800 / config.unitsKm
    || earthDistance < earth.radius + earthClearance) return null;
  return { bodyId: "earth-station", positionM: [...value.positionM], yaw: value.yaw, pitch: value.pitch, camera: value.camera };
}
// Keep walking saves in the ship's metre-scale frame; never subtract two AU-scale character positions.
export function validateWalkingState(value, flight, config = world) {
  return validateWalkingTerrain(value, flight, config, terrainHeightKm);
}
function validateWalkingTerrain(value, flight, config, heightAt) {
  if (!value || typeof value !== "object" || !flight || value.bodyId !== flight.landedBody
    || !vector(value.offsetM, 3, 1e6) || Math.hypot(...value.offsetM) > 1e6
    || !vector(value.velocityMps, 3, 60) || Math.hypot(...value.velocityMps) > 60
    || !vector(value.orientation, 4, 1.01)
    || typeof value.pitch !== "number" || !Number.isFinite(value.pitch) || Math.abs(value.pitch) > 1.35
    || typeof value.grounded !== "boolean"
    || (value.camera !== undefined && !["first", "third"].includes(value.camera))
    || !vector(flight.position, 3, Infinity) || !vector(flight.velocity, 3, Infinity)
    || Math.hypot(...flight.velocity) > 1e-9) return null;
  const body = config.bodies.find(candidate => candidate.id === value.bodyId);
  if (!body || !surfaceProfile(body.id).solid || body.kind === "star" || body.kind === "black-hole" || body.kind === "station"
    || (body.systemId ?? "solar") !== (flight.systemId ?? "solar")) return null;
  const norm = Math.hypot(...value.orientation);
  if (norm < 0.95 || norm > 1.05) return null;
  const scale = new SpatialScale(config.unitsKm);
  const meters = scale.metresPerUnit;
  const anchorRadial = bodyRadialM(config, body, flight.position, flight.referenceFrame);
  if (!anchorRadial) return null;
  const anchorDistance = Math.hypot(...anchorRadial);
  if (!anchorDistance) return null;
  const landingRadius = body.radius * meters
    + (heightAt(body.id, anchorRadial.map(n => n / anchorDistance)) + LANDING_CLEARANCE_KM) * METRES_PER_KILOMETRE;
  if (Math.abs(anchorDistance - landingRadius) > 0.1) return null;
  const radial = anchorRadial.map((n, i) => n + value.offsetM[i]);
  const distance = Math.hypot(...radial);
  if (!distance) return null;
  const normal = radial.map(n => n / distance);
  const clearance = distance - body.radius * meters - heightAt(body.id, normal) * METRES_PER_KILOMETRE;
  // 1.5 cm allows distant landing-anchor round-off; a rounded Rapier capsule
  // can stand above the radial floor on a slope without its feet penetrating.
  if (clearance < -0.015 || clearance > 2000
    || (value.grounded && (clearance > WALKING_GROUNDED_CLEARANCE_M
      || Math.abs(value.velocityMps.reduce((sum, n, i) => sum + n * normal[i], 0)) > 0.1))) return null;
  return {
    bodyId: value.bodyId,
    offsetM: [...value.offsetM],
    velocityMps: [...value.velocityMps],
    orientation: normalizedQuaternion(value.orientation, norm),
    pitch: value.pitch,
    grounded: value.grounded,
    ...(value.camera !== undefined ? { camera: value.camera } : {}),
  };
}
// Validate an old anchor against its original terrain before moving it. The
// character retains its surface direction and height above the floor, rather
// than being translated by the ship's possibly different elevation change.
function migrateLandedTerrain(value, position, body, referenceFrame) {
  const scale = new SpatialScale(world.unitsKm);
  const meters = scale.metresPerUnit;
  const radial = bodyRadialM(world, body, position, referenceFrame);
  if (!radial) return null;
  const distance = Math.hypot(...radial);
  if (!distance) return null;
  const normal = radial.map(n => n / distance);
  const altitudeKm = distance / METRES_PER_KILOMETRE - body.radius * world.unitsKm;
  const currentHeight = terrainHeightKm(body.id, normal) + LANDING_CLEARANCE_KM;
  // Some callers already used the current terrain before writing version
  // metadata. Only unmarked saves may use this current-height compatibility.
  if ((value.terrainVersion === undefined || value.terrainVersion === TERRAIN_VERSION)
    && Math.abs(altitudeKm - currentHeight) <= 0.0001)
    return { position, radialM: radial, walking: value.walking };
  if ((value.terrainVersion ?? 1) !== 1) return null;
  const oldHeight = legacyTerrainHeightKm(body.id, normal) + LANDING_CLEARANCE_KM;
  if (Math.abs(altitudeKm - oldHeight) > 0.0001) return null;
  const oldFlight = { position, velocity: value.velocity, landedBody: body.id, systemId: value.systemId ?? "solar", referenceFrame };
  const oldWalking = value.walking === undefined ? undefined
    : validateWalkingTerrain(value.walking, oldFlight, world, legacyTerrainHeightKm);
  if (value.walking !== undefined && !oldWalking) return null;
  const newRadius = body.radius * meters + currentHeight * METRES_PER_KILOMETRE;
  const newRadial = normal.map(n => n * newRadius);
  const migratedPosition = scale.metresOffsetToUniverse(newRadial, body.position);
  let walking = oldWalking;
  if (oldWalking) {
    const oldFeet = radial.map((n, i) => n + oldWalking.offsetM[i]);
    const feetDistance = Math.hypot(...oldFeet);
    const feetNormal = oldFeet.map(n => n / feetDistance);
    const elevationDelta = (terrainHeightKm(body.id, feetNormal) - legacyTerrainHeightKm(body.id, feetNormal)) * METRES_PER_KILOMETRE;
    const newFeet = feetNormal.map(n => n * (feetDistance + elevationDelta));
    walking = { ...oldWalking, offsetM: newFeet.map((n, i) => n - newRadial[i]) };
  }
  return { position: migratedPosition, radialM: newRadial, walking };
}
export function validateFlightState(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![1, 2].includes(value.version) ||
    (value.coordinateVersion !== undefined && value.coordinateVersion !== 1) ||
    (value.worldLayoutVersion !== undefined && ![1, 2, world.layoutVersion ?? 1].includes(value.worldLayoutVersion)) ||
    (value.terrainVersion !== undefined && ![1, TERRAIN_VERSION].includes(value.terrainVersion)) ||
    !vector(value.position, 3, value.version === 1 ? 1e6 : Infinity) ||
    !vector(value.velocity, 3, value.version === 1 ? 120 : Infinity) ||
    !vector(value.orientation, 4, 1.01) ||
    !ids.has(value.target) ||
    (value.systemId !== undefined && !systemIds.has(value.systemId)) ||
    (value.cruiseSpeedKm !== undefined && (typeof value.cruiseSpeedKm !== "number"
      || !Number.isFinite(value.cruiseSpeedKm))) ||
    (value.lowFlightSpeedMps !== undefined && (typeof value.lowFlightSpeedMps !== "number"
      || !Number.isFinite(value.lowFlightSpeedMps))) ||
    !["cockpit", "chase"].includes(value.camera) ||
    typeof value.assist !== "boolean" ||
    typeof value.elapsed !== "number" ||
    !Number.isFinite(value.elapsed) ||
    value.elapsed < 0 ||
    value.elapsed > 1e12
  )
    return null;
  const norm = Math.hypot(...value.orientation);
  if (
    norm < 0.95 ||
    norm > 1.05 ||
    (value.version === 1 && Math.hypot(...value.velocity) > 120)
  )
    return null;
  const body = world.bodies.find((b) => b.id === value.target);
  const old = legacy[value.target];
  if (value.version === 1 && (!old || (value.systemId && value.systemId !== "solar"))) return null;
  let position = value.version === 1
    ? value.position.map((n, i) => body.position[i] + (n - old[1][i]) / old[0] * body.radius)
    : migrateLayoutPosition(value, [...value.position]);
  if (!vector(position, 3, Infinity)) return null;
  let referenceValue = value;
  if (value.version === 2
    && value.referenceFrame?.kind === "body-fixed" && value.referenceFrame.bodyId === "earth"
    && position.some((n, i) => n !== value.position[i])) {
    // Approaches to the old station used Earth's nearby simulation frame. Its
    // exact radial must follow the moved ship, after proving the original frame
    // agreed with the original position. Planet landings retain their radials.
    const earth = world.bodies.find(body => body.id === "earth");
    const originalRadial = bodyRadialM(world, earth, value.position, value.referenceFrame);
    if (!originalRadial) return null;
    const displacementM = new SpatialScale(world.unitsKm).universeDeltaToMetres(position, value.position);
    referenceValue = { ...value, referenceFrame: { kind: "body-fixed", bodyId: "earth",
      radialM: originalRadial.map((n, i) => n + displacementM[i]) } };
  }
  // Compressed-world v1 positions predate reference metadata. Their migration
  // retains the existing target-relative rule and constructs a fresh frame.
  let referenceFrame = value.version === 1 ? undefined : validateReferenceFrame(referenceValue, position);
  if (referenceFrame === null) return null;
  let walkingValue = value.walking;
  if (value.landedBody !== undefined) {
    const ground = world.bodies.find((b) => b.id === value.landedBody);
    if (value.version !== 2 || !ground || ground.kind === "star" || ground.kind === "black-hole" || !surfaceProfile(ground.id).solid
      || (ground.systemId ?? "solar") !== (value.systemId ?? "solar") || Math.hypot(...value.velocity) > 1e-9) return null;
    const migrated = migrateLandedTerrain(value, position, ground, referenceFrame);
    if (!migrated) return null;
    position = migrated.position;
    walkingValue = migrated.walking;
    referenceFrame = { kind: "body-fixed", bodyId: ground.id, radialM: migrated.radialM };
  }
  const walking = walkingValue === undefined ? undefined : validateWalkingState(walkingValue, {
    position, velocity: value.velocity, landedBody: value.landedBody, systemId: value.systemId ?? "solar", referenceFrame,
  });
  if (value.walking !== undefined && (value.version !== 2 || !walking)) return null;
  const stationVisit = value.stationVisit === undefined ? undefined : validateStationVisitState(value.stationVisit, {
    position, velocity: value.velocity, target: value.target, systemId: value.systemId ?? "solar",
    landedBody: value.landedBody, walking: value.walking,
  });
  if (value.stationVisit !== undefined && (value.version !== 2 || !stationVisit)) return null;
  const cruiseSpeedKm = Math.max(1, Math.min(150000, value.version === 2 ? value.cruiseSpeedKm ?? 100 : 100));
  const legacyLowSpeed = Number.isFinite(value.atmosphericSpeedMps) ? value.atmosphericSpeedMps : 1000;
  const lowFlightSpeedMps = Math.max(1, Math.min(1000, value.version === 2 ? value.lowFlightSpeedMps ?? legacyLowSpeed : 1000));
  let velocity = value.version === 1 ? [0, 0, 0] : [...value.velocity];
  const maximumVelocity = 150000 / world.unitsKm;
  if (Math.hypot(...velocity) > maximumVelocity) {
    // Normalize in two stages, so even finite legacy components whose norm
    // overflows can migrate to the current physical speed range.
    const scale = Math.max(...velocity.map(Math.abs));
    velocity = velocity.map(n => n / scale);
    const norm = Math.hypot(...velocity);
    velocity = velocity.map(n => n / norm * maximumVelocity);
  }
  return {
    version: 2,
    coordinateVersion: 1,
    referenceFrame: referenceFrame ?? { kind: "system" },
    worldLayoutVersion: world.layoutVersion ?? 1,
    terrainVersion: TERRAIN_VERSION,
    ...(value.landedBody ? { landedBody: value.landedBody } : {}),
    ...(walking ? { walking } : {}),
    ...(stationVisit ? { stationVisit } : {}),
    systemId: value.version === 1 ? "solar" : value.systemId ?? "solar",
    engineMode: propulsionBand(cruiseSpeedKm).id,
    cruiseSpeedKm,
    lowFlightSpeedMps,
    position,
    velocity,
    orientation: normalizedQuaternion(value.orientation, norm),
    target: value.target,
    camera: value.camera,
    assist: value.assist,
    elapsed: value.elapsed,
  };
}
