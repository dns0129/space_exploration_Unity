import type { BodyId } from "../src/solar-system";
export function surfaceProfile(id: BodyId): { solid: boolean; sky: string; ground: string; gravity: number; gravityEstimated: boolean; density: number; scaleKm: number; landingReason?: string };
export function terrainHeightKm(id: BodyId, normal: number[]): number;
export function legacyTerrainHeightKm(id: BodyId, normal: number[]): number;
export const TERRAIN_VERSION: number;
export interface TerrainHeightField {
  id: BodyId;
  sourceId: string;
  width: number;
  height: number;
  data: Uint8Array;
  /** 255=water, 0=land; present for Earth's GEBCO/Blue Marble classification. */
  waterMask?: Uint8Array;
  heightOffsetKm: number;
  heightScaleKm: number;
  tiltRad: number;
  yawRad: number;
  mapOffset: number;
  fineSeed: number;
  fineEnabled: boolean;
  craters?: { id: string; uv: [number, number]; angularRadius: number }[];
}
export function terrainHeightField(id: BodyId): TerrainHeightField | undefined;
export function terrainMapUv(id: BodyId, worldNormal: number[]): [number, number];
export function terrainMapNormal(id: BodyId, uv: number[]): [number, number, number];
export function sampleTerrainField(field: TerrainHeightField, uv: number[]): number;
export function terrainMaxHeightKm(id: BodyId): number;
export const canonicalTerrainSampling: string;
export const LANDING_CLEARANCE_KM: number;
