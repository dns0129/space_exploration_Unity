/** Interior coordinates are metres, with character positions measured at the feet. */
export const STATION_HELM = Object.freeze([0, 0, -36]);
export const STATION_SPAWN = Object.freeze([0, 0, 24]);
export const STATION_ROOMS = Object.freeze([
  Object.freeze({ id: "docking", name: "停泊区", minX: -14, maxX: 14, minZ: 12, maxZ: 34, height: 6 }),
  Object.freeze({ id: "corridor", name: "连接廊道", minX: -3, maxX: 3, minZ: -18, maxZ: 12, height: 4.2 }),
  Object.freeze({ id: "control", name: "驾驶室", minX: -14, maxX: 14, minZ: -40, maxZ: -18, height: 4.8 }),
  Object.freeze({ id: "observation", name: "观测舱", minX: 3, maxX: 27, minZ: -14, maxZ: 10, height: 4.8 }),
]);

/** Solid furniture uses the same footprints in rendering, movement and save validation. */
export const STATION_OBSTACLES = Object.freeze([
  Object.freeze({ id: "helm-console", minX: -2.3, maxX: 2.3, minZ: -39.15, maxZ: -38.25 }),
  Object.freeze({ id: "parked-ship", minX: -11.2, maxX: -1.3, minZ: 20.3, maxZ: 29.8 }),
  Object.freeze({ id: "hologram-table", minX: -3.2, maxX: 3.2, minZ: -33.4, maxZ: -27.6 }),
  Object.freeze({ id: "port-consoles", minX: -13, maxX: -9.2, minZ: -38, maxZ: -22 }),
  Object.freeze({ id: "starboard-consoles", minX: 9.2, maxX: 13, minZ: -38, maxZ: -22 }),
  Object.freeze({ id: "observation-bench", minX: 11, maxX: 21, minZ: 6.5, maxZ: 8.5 }),
]);

function coordinates(position) {
  return Array.isArray(position) ? position : [position?.x, position?.y, position?.z];
}
const contains = (rectangle, x, z) => x >= rectangle.minX && x <= rectangle.maxX
  && z >= rectangle.minZ && z <= rectangle.maxZ;
const inFloor = (x, z) => STATION_ROOMS.some(room => contains(room, x, z));

/** Exterior edges of the room union; shared edges become open connecting portals. */
export const STATION_WALLS = Object.freeze(STATION_ROOMS.flatMap(room => {
  const walls = [];
  for (const [axis, fixed, from, to, inward] of [
    ["x", room.minX, room.minZ, room.maxZ, 1], ["x", room.maxX, room.minZ, room.maxZ, -1],
    ["z", room.minZ, room.minX, room.maxX, 1], ["z", room.maxZ, room.minX, room.maxX, -1],
  ]) {
    const cuts = [...new Set([from, to, ...STATION_ROOMS.flatMap(other => axis === "x"
      ? [other.minZ, other.maxZ] : [other.minX, other.maxX])])]
      .filter(value => value >= from && value <= to).sort((a, b) => a - b);
    let start;
    for (let index = 0; index < cuts.length - 1; index++) {
      const midpoint = (cuts[index] + cuts[index + 1]) / 2;
      const exterior = axis === "x" ? !inFloor(fixed - inward * 0.001, midpoint)
        : !inFloor(midpoint, fixed - inward * 0.001);
      if (exterior && start === undefined) start = cuts[index];
      if (start !== undefined && (!exterior || index === cuts.length - 2)) {
        walls.push(Object.freeze({ roomId: room.id, axis, fixed, from: start,
          to: exterior ? cuts[index + 1] : cuts[index], inward, height: room.height }));
        start = undefined;
      }
    }
  }
  return walls;
}));

/** Test a horizontal capsule, allowing movement across the shared room seams. */
export function stationWalkable(positionM, margin = 0.45) {
  const [x, y, z] = coordinates(positionM);
  if (![x, y, z, margin].every(Number.isFinite) || margin < 0 || !inFloor(x, z)) return false;
  // A circle-to-rectangle test matches furniture rather than allowing corner clipping.
  for (const obstacle of STATION_OBSTACLES) {
    const dx = x - Math.max(obstacle.minX, Math.min(obstacle.maxX, x));
    const dz = z - Math.max(obstacle.minZ, Math.min(obstacle.maxZ, z));
    if (dx * dx + dz * dz <= margin * margin) return false;
  }
  for (const wall of STATION_WALLS) {
    const along = wall.axis === "x" ? z : x;
    const across = wall.axis === "x" ? x : z;
    const dx = across - wall.fixed;
    const dz = along - Math.max(wall.from, Math.min(wall.to, along));
    if (dx * dx + dz * dz < margin * margin) return false;
  }
  return true;
}

export function stationZone(positionM) {
  const [x, , z] = coordinates(positionM);
  return STATION_ROOMS.find(room => contains(room, x, z))?.name ?? "空间站";
}
