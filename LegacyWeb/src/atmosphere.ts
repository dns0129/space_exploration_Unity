/** Optical density is deliberately broader than aerodynamic density for a readable entry transition. */
export function atmosphereStrength(id: string) {
  return id === "mars" ? 0.55 : id === "venus" || id === "titan" ? 2.2 : 1.5;
}

/** Local weather art is separate from orbital texture maps and collision density. */
export function atmosphereCloudProfile(id: string, atmosphereKm: number) {
  if (id === "earth") return { scale: 1, opacity: 1, coverage: 0, tint: "#ffffff" };
  if (id === "venus") return { scale: 3, opacity: 1, coverage: 0.22, tint: "#eed0a0" };
  if (id === "titan") return { scale: 2.2, opacity: 0.7, coverage: 0.12, tint: "#dbc3a2" };
  if (id === "proxima-b") return { scale: 0.8, opacity: 0.75, coverage: 0.08, tint: "#e7cdbd" };
  if (id === "proxima-c") return { scale: 3, opacity: 0.85, coverage: 0.1, tint: "#d3e6ed" };
  if (["jupiter", "saturn", "uranus", "neptune"].includes(id))
    return { scale: Math.max(3, Math.min(16, atmosphereKm / 100)), opacity: 0.95, coverage: 0.24, tint: "#eee4d3" };
  return { scale: 1, opacity: 0, coverage: 0, tint: "#ffffff" };
}

/** Shared orbital/local optics. Distances use the caller's units; alpha is extinction. */
export const atmosphereScattering = /* glsl */ `
  vec4 scatterAtmosphere(vec3 up, float altitude, vec3 ray, float radius,
      float height, vec3 sunDirection, vec3 tint, float strength) {
    if (strength <= 0.0) return vec4(0.0);
    float radial = radius + altitude;
    float b = radial * dot(up, ray);
    float c = (altitude - height) * (2.0 * radius + altitude + height);
    float discriminant = b * b - c;
    if (discriminant <= 0.0) return vec4(0.0);
    float root = sqrt(discriminant);
    float entry = max(0.0, -b - root);
    float exitPoint = -b + root;
    float groundC = altitude * (2.0 * radius + altitude);
    float groundD = b * b - groundC;
    float groundRay = 0.0, groundCosine = 1.0;
    if (b < 0.0 && groundD > 0.0) {
      float hit = groundC / (-b + sqrt(groundD));
      exitPoint = min(exitPoint, max(0.0, hit));
      groundRay = 1.0;
      groundCosine = clamp(sqrt(groundD) / radius, 0.0, 1.0);
    }
    if (exitPoint <= entry) return vec4(0.0);
    float stepLength = (exitPoint - entry) / 12.0;
    // Most optical mass is close to the surface. A tenuous upper component
    // keeps entry continuous without painting a broad luminous orbital shell.
    float scaleHeight = height * 0.105;
    float upperHeight = height * 0.28;
    float aerosolHeight = height * 0.018;
    float blueSky = smoothstep(1.1, 1.8, tint.b / max(tint.r, 0.02));
    // Wavelength-dependent extinction lets long solar paths redden naturally.
    vec3 molecularBeta = mix(tint * 0.38, vec3(0.055, 0.13, 0.3), blueSky) * strength;
    vec3 aerosolBeta = mix(tint * 0.2, vec3(0.025), blueSky) * strength;
    vec3 transmission = vec3(1.0);
    vec3 scattered = vec3(0.0);
    float mu = dot(ray, sunDirection);
    float rayleigh = 0.75 * (1.0 + mu * mu);
    float g = 0.76;
    float mie = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 0.02), 1.5);
    for (int i = 0; i < 12; i++) {
      float t = entry + (float(i) + 0.5) * stepLength;
      vec3 point = up * radial + ray * t;
      // Rationalized height avoids precision loss near a planet-sized ground.
      float h = max(0.0, (groundC + 2.0 * b * t + t * t) / (length(point) + radius));
      float taper = 1.0 - smoothstep(height * 0.75, height, h);
      float molecular = (exp(-h / scaleHeight) + 0.035 * exp(-h / upperHeight)) * taper;
      float aerosol = exp(-h / aerosolHeight) * taper;
      float solarElevation = dot(normalize(point), sunDirection);
      float horizonDip = sqrt(max(h * (2.0 * radius + h), 0.0)) / (radius + h);
      // The planet blocks direct sunlight; twilight follows the illuminated
      // upper air instead of a fixed orange stripe around the whole planet.
      float sunlight = smoothstep(-horizonDip - 0.008, -horizonDip + 0.008, solarElevation);
      // Curvature bounds the tangent light path (Chapman air-mass approximation).
      float airMass = 2.0 / max(solarElevation + sqrt(solarElevation * solarElevation
        + 2.0 * scaleHeight / (radius + h)), 0.001);
      float aerosolMass = 2.0 / max(solarElevation + sqrt(solarElevation * solarElevation
        + 2.0 * aerosolHeight / (radius + h)), 0.001);
      vec3 solarOptical = molecularBeta * molecular * airMass
        + aerosolBeta * aerosol * aerosolMass;
      vec3 solarLight = exp(-solarOptical) * sunlight;
      vec3 molecularDepth = molecularBeta * molecular * stepLength / scaleHeight;
      vec3 aerosolDepth = aerosolBeta * aerosol * stepLength / aerosolHeight;
      vec3 opticalDepth = molecularDepth + aerosolDepth;
      vec3 stepTransmission = exp(-opticalDepth);
      // Aerosols scatter in a narrow forward lobe, never as a white gloss coat.
      vec3 source = solarLight * (molecularDepth * rayleigh + aerosolDepth * mie * 0.14)
        / max(opticalDepth, vec3(0.000001));
      // Faint diffuse sky light softens the shadow without brightening dark orbit.
      source += tint * 0.015 * sunlight;
      scattered += transmission * (1.0 - stepTransmission) * source;
      transmission *= stepTransmission;
    }
    // Normal alpha compositing applies extinction to clouds, terrain and stars.
    // Preserve one scalar alpha for the shared shell/sky material contract.
    float opacity = 1.0 - min(transmission.r, min(transmission.g, transmission.b));
    vec3 color = scattered / max(opacity, 0.000001);
    // Aerial perspective is restrained over resolved ground, especially at
    // nadir. Scaling the effective alpha attenuates both haze and extinction,
    // preserving photographic terrain/cloud contrast beneath the optical sky.
    float groundHaze = 0.05 + 0.42 * pow(1.0 - groundCosine, 3.0);
    opacity = mix(opacity, min(opacity, groundHaze), groundRay);
    return vec4(color, opacity);
  }
`;
