export type EngineMode = "maneuver" | "cruise" | "transfer" | "planetary" | "interstellar";
export interface PropulsionBand { readonly id: EngineMode; readonly name: string; readonly minKm: number; readonly maxKm: number; }
export const PROPULSION_BANDS: readonly PropulsionBand[];
export function propulsionBand(speedKm: number): PropulsionBand;
export function speedToSlider(speedKm: number): number;
export function sliderToSpeed(position: number): number;
