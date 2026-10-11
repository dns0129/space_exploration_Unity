/** Kilometre-scale local cloud volume. Coordinates stay in the planet's collision frame. */
export const entryClouds = /* glsl */ `
  float entryHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  // The eight corner hashes produce both value and analytic gradient; normals
  // therefore reuse the existing billow sample instead of adding noise calls.
  vec4 entryNoiseGradient(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 derivative = 6.0 * f * (1.0 - f);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = entryHash(i), n100 = entryHash(i + vec3(1, 0, 0));
    float n010 = entryHash(i + vec3(0, 1, 0)), n110 = entryHash(i + vec3(1, 1, 0));
    float n001 = entryHash(i + vec3(0, 0, 1)), n101 = entryHash(i + vec3(1, 0, 1));
    float n011 = entryHash(i + vec3(0, 1, 1)), n111 = entryHash(i + vec3(1, 1, 1));
    float x00 = mix(n000, n100, f.x), x10 = mix(n010, n110, f.x);
    float x01 = mix(n001, n101, f.x), x11 = mix(n011, n111, f.x);
    float low = mix(x00, x10, f.y), high = mix(x01, x11, f.y);
    float dx = mix(mix(n100 - n000, n110 - n010, f.y),
      mix(n101 - n001, n111 - n011, f.y), f.z);
    float dy = mix(x10 - x00, x11 - x01, f.z);
    return vec4(mix(low, high, f.z), vec3(dx, dy, high - low) * derivative);
  }
  float entryNoise(vec3 p) { return entryNoiseGradient(p).x; }
  vec4 scatterEntryClouds(vec3 up, float altitude, vec3 ray, float radius,
      vec3 sunDirection, float time, float cloudScale, float coverage, vec3 cloudTint) {
    // Two separated decks share one eight-step march: low cumulus is visible
    // from the ground, while the higher entry banks retain their spatial depth.
    // The intervening clear air never becomes an opaque white blanket.
    float top = 16.0 * cloudScale, base = 1.6 * cloudScale;
    float radial = radius + altitude;
    float b = radial * dot(up, ray);
    float c = (altitude - top) * (2.0 * radius + altitude + top);
    float d = b * b - c;
    if (d <= 0.0) return vec4(0.0);
    float entry = max(0.0, -b - sqrt(d));
    float exitPoint = -b + sqrt(d);
    float baseC = (altitude - base) * (2.0 * radius + altitude + base);
    float baseD = b * b - baseC;
    if (baseD > 0.0) {
      float baseRoot = sqrt(baseD);
      // Sample only the near cloud shell, skipping empty air below the deck.
      if (altitude < base) entry = max(entry, -b + baseRoot);
      else if (-b - baseRoot > entry) exitPoint = min(exitPoint, -b - baseRoot);
    }
    float groundC = altitude * (2.0 * radius + altitude);
    float groundD = b * b - groundC;
    if (b < 0.0 && groundD > 0.0) {
      exitPoint = min(exitPoint, groundC / (-b + sqrt(groundD)));
    }
    // A fixed horizon range bounds fragment work in the independent local scene.
    exitPoint = min(exitPoint, entry + 420.0 * cloudScale);
    if (exitPoint <= entry) return vec4(0.0);
    float stepLength = (exitPoint - entry) / 8.0;
    float transmission = 1.0;
    vec3 light = vec3(0.0);
    float forward = pow(max(dot(ray, sunDirection), 0.0), 14.0);
    for (int i = 0; i < 8; i++) {
      // At most 2.5% of the remaining light can contribute beyond a dense bank.
      if (transmission < 0.025) break;
      float t = entry + (float(i) + 0.5) * stepLength;
      vec3 point = up * radial + ray * t;
      float h = (groundC + 2.0 * b * t + t * t) / (length(point) + radius) / cloudScale;
      if (h > 1.6 && h < 16.0) {
        vec3 p = point * (0.065 / cloudScale) + vec3(time * 0.0007, 0.0, time * 0.0003);
        // Nearby cumulus needs gaps across the pilot's field of view. Entry
        // banks use broader weather, but reusing that domain below 6 km made
        // every ray encounter the same dense bank and erased the blue sky.
        if (h < 7.8) p *= 1.6;
        float weather = entryNoise(p);
        vec4 billowSample = entryNoiseGradient(p * 3.9 + vec3(17.2, 4.1, 11.8));
        float billow = billowSample.x;
        // Cheap erosion replaces a third eight-corner noise lookup per step.
        float wisp = 0.5 + 0.5 * sin(dot(p, vec3(18.7, 4.3, 13.1)) + billow * 7.0);
        float localTop = 10.5 + weather * 4.0 + billow;
        float shape = smoothstep(7.8, 8.9, h)
          * (1.0 - smoothstep(localTop - 1.2, localTop, h));
        float lowTop = 3.6 + weather * 2.2 + billow * 0.7;
        float lowShape = smoothstep(1.6, 2.2, h)
          * (1.0 - smoothstep(lowTop - 0.9, lowTop, h));
        float density = smoothstep(0.55, 0.78, weather * 0.60 + billow * 0.31 + wisp * 0.09 + coverage) * shape;
        density += smoothstep(0.59, 0.82, weather * 0.65 + billow * 0.35 + coverage) * lowShape * 0.68;
        float extinction = h < 7.8 ? 0.28 : 0.42;
        float alpha = 1.0 - exp(-density * stepLength * (extinction / cloudScale));
        vec3 radialUp = normalize(point);
        float solarElevation = dot(radialUp, sunDirection);
        float day = smoothstep(-0.13, 0.16, solarElevation);
        float sunset = exp(-pow((solarElevation + 0.02) * 8.0, 2.0));
        float topLight = h < 7.8 ? smoothstep(1.6, lowTop, h) : smoothstep(7.8, localTop, h);
        // Rounded density gradients face the star differently on each billow.
        // This optical normal is artistic; no extra shadow ray or texture is used.
        vec3 cloudNormal = normalize(radialUp * 0.82 - billowSample.yzw * 0.65);
        float diffuse = max(dot(cloudNormal, sunDirection), 0.0);
        float sculpted = (0.42 + diffuse * 0.58) * (0.62 + topLight * 0.38);
        vec3 color = mix(vec3(0.009, 0.014, 0.026), vec3(0.87, 0.93, 1.0), day);
        color *= sculpted + (1.0 - density) * forward * 0.62;
        color = mix(color, vec3(1.0, 0.48, 0.2) * (0.15 + day * 0.65), sunset * 0.64);
        color *= cloudTint;
        light += color * alpha * transmission;
        transmission *= 1.0 - alpha;
      }
    }
    float opacity = 1.0 - transmission;
    return vec4(light / max(opacity, 0.00001), opacity);
  }

  // A single thin sheet adds long, broken cirrus strands without another march.
  vec4 scatterHighClouds(vec3 up, float altitude, vec3 ray, float radius,
      vec3 sunDirection, float time, float cloudScale, float coverage, vec3 cloudTint) {
    float layer = 21.0 * cloudScale;
    float radial = radius + altitude;
    float b = radial * dot(up, ray);
    float c = (altitude - layer) * (2.0 * radius + altitude + layer);
    float d = b * b - c;
    if (d <= 0.0) return vec4(0.0);
    float t = altitude < layer ? -b + sqrt(d) : -b - sqrt(d);
    if (t <= 0.0 || t > 700.0 * cloudScale || (dot(up, ray) < 0.0 && altitude < layer)) return vec4(0.0);
    vec3 point = up * radial + ray * t;
    vec3 p = point * (0.011 / cloudScale) + vec3(time * 0.0002, 0.0, time * 0.0005);
    float weather = entryNoise(p);
    float strand = sin(dot(p, vec3(23.0, 1.6, 6.0)) + weather * 10.0) * 0.5 + 0.5;
    float opacity = smoothstep(0.54, 0.77, weather + coverage) * pow(strand, 5.0) * 0.22;
    float solarElevation = dot(normalize(point), sunDirection);
    float day = smoothstep(-0.13, 0.16, solarElevation);
    float sunset = exp(-pow((solarElevation + 0.02) * 8.0, 2.0));
    vec3 color = mix(vec3(0.007, 0.011, 0.021), vec3(0.82, 0.89, 1.0), day);
    color = mix(color, vec3(1.0, 0.52, 0.27) * (0.12 + day * 0.74), sunset * 0.65);
    return vec4(color * cloudTint, opacity);
  }
`;
