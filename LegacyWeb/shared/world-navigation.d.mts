import type { WorldConfig } from "./flight-state.mjs";
import type { SystemId } from "../src/solar-system";
type WorldBody = WorldConfig["bodies"][number];
export function bodySystem(body: WorldBody): SystemId;
export function systemBodies(config: WorldConfig, id: SystemId): WorldBody[];
export function systemConfig(config: WorldConfig, id: SystemId): WorldConfig["systems"][number];
export function systemDisplacement(config: WorldConfig, fromSystem: SystemId, from: number[], toSystem: SystemId, to: number[]): number[];
