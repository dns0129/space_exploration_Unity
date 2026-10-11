export const bodySystem = (body) => body.systemId ?? "solar";
export const systemBodies = (config, id) => config.bodies.filter(body => bodySystem(body) === id);
export const systemConfig = (config, id) => config.systems.find(system => system.id === id);

// Local coordinates retain metre-scale precision near planets. Only long-range
// directions and interstellar route segments use the distance between origins.
export function systemDisplacement(config, fromSystem, from, toSystem, to) {
  const a = systemConfig(config, fromSystem), b = systemConfig(config, toSystem);
  return to.map((value, axis) => value - from[axis]
    + (b.positionLy[axis] - a.positionLy[axis]) * config.lightYearKm / config.unitsKm);
}
