export const PROPULSION_BANDS = Object.freeze([
  { id: "maneuver", name: "机动档", minKm: 1, maxKm: 100 },
  { id: "cruise", name: "巡航档", minKm: 100, maxKm: 1000 },
  { id: "transfer", name: "转移档", minKm: 1000, maxKm: 10000 },
  { id: "planetary", name: "行星际档", minKm: 10000, maxKm: 50000 },
  { id: "interstellar", name: "星际档", minKm: 50000, maxKm: 150000 },
].map(Object.freeze));
const boundedSpeed = speed => Number.isFinite(speed) ? Math.max(1, Math.min(150000, speed)) : 100;
export function propulsionBand(speedKm) {
  const speed = boundedSpeed(speedKm);
  return PROPULSION_BANDS.find(band => speed < band.maxKm) ?? PROPULSION_BANDS.at(-1);
}
export function speedToSlider(speedKm) {
  const speed = boundedSpeed(speedKm), band = propulsionBand(speed);
  return PROPULSION_BANDS.indexOf(band) * 100 + (speed - band.minKm) / (band.maxKm - band.minKm) * 100;
}
export function sliderToSpeed(position) {
  const value = Number.isFinite(position) ? Math.max(0, Math.min(500, position)) : 100;
  const band = PROPULSION_BANDS[Math.min(4, Math.floor(value / 100))];
  return band.minKm + (value - PROPULSION_BANDS.indexOf(band) * 100) / 100 * (band.maxKm - band.minKm);
}
