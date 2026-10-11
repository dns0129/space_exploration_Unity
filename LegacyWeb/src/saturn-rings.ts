// Ring radii in units of the model's 58,232 km mean planetary radius.
export const SATURN_RING_INNER = 1.11;
export const SATURN_RING_OUTER = 2.415;

/** Normal optical depth, shared by the visible particulate layer and its shadow. */
export const saturnRingOptics = /* glsl */ `
  float ringBand(float r, float inner, float outer, float footprint) {
    float edge = max(footprint * 0.6, 0.00035);
    return max(0.0, smoothstep(inner-edge,inner+edge,r)
      - smoothstep(outer-edge,outer+edge,r));
  }
  float ringLine(float r, float frequency, float phase, float footprint) {
    return sin(r*frequency+phase)*exp(-0.5*pow(footprint*frequency,2.0));
  }
  float ringOpticalDepth(float r, float footprint) {
    // D/C rings are translucent; B is optically thick; A is moderately dense.
    // The divisions are low-density material, rather than painted black bands.
    float tau = 0.018*ringBand(r,1.11,1.282,footprint)
      + 0.13*ringBand(r,1.282,1.58,footprint)
      + 2.65*ringBand(r,1.58,2.019,footprint)
      + 0.018*ringBand(r,2.019,2.098,footprint)
      + 0.58*ringBand(r,2.098,2.349,footprint)
      + 0.32*ringBand(r,2.406,2.408,footprint);
    float structure = 1.0
      + 0.12*ringLine(r,53.0,0.4,footprint)
      + 0.07*ringLine(r,137.0,2.1,footprint)
      + 0.08*ringLine(r,421.0,0.8,footprint)
      + 0.055*ringLine(r,1277.0,1.7,footprint)
      + 0.035*ringLine(r,3529.0,0.2,footprint)
      + 0.025*ringLine(r,9311.0,2.4,footprint);
    // C-ring plateaus, the B-ring outer rim, and the narrow Encke/Keeler gaps.
    tau *= structure * (1.0 + 0.24*ringBand(r,1.46,1.50,footprint)
      + 0.18*ringBand(r,1.94,2.019,footprint));
    tau *= 1.0 - 0.96*ringBand(r,2.288,2.294,footprint);
    tau *= 1.0 - 0.90*ringBand(r,2.336,2.337,footprint);
    return max(tau,0.0);
  }
  float ringTransmittance(float r, float footprint, float incidence) {
    // Filter transmitted light, so a subpixel clear gap still admits sunlight.
    float stepSize = footprint*0.5;
    float mu0 = max(incidence,0.015);
    return (exp(-ringOpticalDepth(r-stepSize,footprint*0.35)/mu0)
      + 2.0*exp(-ringOpticalDepth(r,footprint*0.35)/mu0)
      + exp(-ringOpticalDepth(r+stepSize,footprint*0.35)/mu0))*0.25;
  }
`;
