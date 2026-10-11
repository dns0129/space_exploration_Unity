export interface StationRectangle {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}
export interface StationRoom extends StationRectangle {
  readonly name: string;
  readonly height: number;
}
export type StationPosition = readonly number[] | { readonly x: number; readonly y: number; readonly z: number };
export const STATION_HELM: readonly number[];
export const STATION_SPAWN: readonly number[];
export const STATION_ROOMS: readonly StationRoom[];
export const STATION_OBSTACLES: readonly StationRectangle[];
export const STATION_WALLS: readonly { readonly roomId: string; readonly axis: "x" | "z"; readonly fixed: number;
  readonly from: number; readonly to: number; readonly inward: number; readonly height: number }[];
/** Floor and furniture capsule test; vertical jump bounds are handled by the caller. */
export function stationWalkable(positionM: StationPosition, margin?: number): boolean;
export function stationZone(positionM: StationPosition): string;
