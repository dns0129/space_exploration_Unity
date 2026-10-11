export type FlightRenderMode = "space" | "surface";

export interface RenderEnvironment {
  bodyId: string;
  atmosphereKm?: number;
  altitudeKm: number;
  groundAltitudeKm: number;
  solid: boolean;
  warping: boolean;
}

/** One world renderer owns each frame; hysteresis keeps the boundary stable. */
export class FlightRenderPolicy {
  mode: FlightRenderMode = "space";
  private bodyId = "";

  update(environment: RenderEnvironment): FlightRenderMode {
    const { bodyId, atmosphereKm = 0, altitudeKm, groundAltitudeKm, solid, warping } = environment;
    const retainingSurface = this.mode === "surface" && this.bodyId === bodyId;
    this.bodyId = bodyId;
    if (warping) return this.mode = "space";
    const atmosphereLimit = atmosphereKm + (retainingSurface ? Math.max(2, atmosphereKm * 0.1) : 0);
    const nearGroundLimit = retainingSurface ? 80 : 70;
    this.mode = (atmosphereKm > 0 && altitudeKm <= atmosphereLimit)
      || (solid && groundAltitudeKm <= nearGroundLimit) ? "surface" : "space";
    return this.mode;
  }

  reset() { this.mode = "space"; this.bodyId = ""; }
}
