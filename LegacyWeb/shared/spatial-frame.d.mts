import type { BodyId, SystemId } from '../src/solar-system';
import type { WorldConfig } from './flight-state.mjs';
type Body = WorldConfig['bodies'][number];
export const METRES_PER_KILOMETRE: 1000;
export const FLOATING_ORIGIN_DISTANCE_M: 256;
export class SpatialScale {
  constructor(unitsKm: number);
  readonly unitsKm: number;
  readonly metresPerUnit: number;
  readonly metersPerUniverseUnit: number;
  universeDistanceToMeters(value: number): number;
  universeDistanceToKilometres(value: number): number;
  kilometresToUniverseDistance(value: number): number;
  metresToUniverseDistance(value: number): number;
  universeDeltaToMetres(position: number[], origin: number[]): number[];
  metresOffsetToUniverse(offset: number[], origin?: number[]): number[];
  universeVelocityToMetres(velocity: number[]): number[];
  metresVelocityToUniverse(velocity: number[]): number[];
}
export interface FrameOptions {
  originUniverse?: number[];
  /** Local-to-system rotation; current solid surfaces keep identity rotation. */
  orientation?: number[];
  /** Velocity of the current floating origin, expressed in system axes (m/s). */
  originVelocityMps?: number[];
  /** Angular velocity expressed in system axes (rad/s). */
  angularVelocityRadps?: number[];
  bodyId?: BodyId | null;
  systemId?: SystemId;
  rebaseDistanceM?: number;
}
export class FloatingOriginFrame {
  constructor(scale: SpatialScale, options?: FrameOptions);
  readonly scale: SpatialScale;
  readonly anchorUniverse: number[];
  readonly originUniverse: number[];
  originOffsetM: number[];
  orientation: number[];
  originVelocityMps: number[];
  angularVelocityRadps: number[];
  bodyId: BodyId | null;
  systemId: SystemId;
  rebaseDistanceM: number;
  revision: number;
  vectorToLocal(vector: number[]): number[];
  vectorToUniverse(vector: number[]): number[];
  universeToLocal(position: number[]): number[];
  localToUniverse(positionM: number[]): number[];
  universeVelocityToLocal(velocity: number[], positionM?: number[]): number[];
  localVelocityToUniverse(velocityMps: number[], positionM?: number[]): number[];
  orientationToLocal(orientation: number[]): number[];
  orientationToUniverse(orientation: number[]): number[];
  bodyRadialM(positionM: number[], body: Body): number[];
  bodyRadialToLocal(radialM: number[], body: Body): number[];
  rebase(focusLocalM: number[]): number[] | null;
}
export function surfaceRadiusM(config: WorldConfig, body: Body, normal: number[]): number;
export function sampleSurface(config: WorldConfig, body: Body, radialM: number[]): {
  normal: number[]; radiusM: number; heightM: number; clearanceM: number; surfaceRadialM: number[];
};
