// Original fictional geology. One deterministic, body-fixed field drives the
// orbital material, surface material, landing and metre-scale walking collision.
export const echoTerrainDefinitions = {
  "echo-thalassa": {
    id: "echo-thalassa", sourceId: "echo-thalassa-procedural", heightOffsetKm: 0,
    heightScaleKm: 12, tiltRad: 0, yawRad: -0.4, mapOffset: 0, fineSeed: 330.74, fineEnabled: false,
  },
  cinder: {
    id: "cinder", sourceId: "cinder-procedural", heightOffsetKm: 0,
    heightScaleKm: 18, tiltRad: 0, yawRad: -0.4, mapOffset: 0, fineSeed: 402.61, fineEnabled: false,
  },
};
const fields = new Map();
const clamp = value => Math.max(0, Math.min(1, value));
function noise(x, y, z, seed) {
  return Math.sin(x * 2.9 + y * 1.7 + seed) * Math.cos(y * 3.1 - z * 2.3 - seed * .37)
    + .48 * Math.sin(z * 6.7 + x * 3.4 + seed * .71) * Math.cos(y * 5.2 + x * 2.1)
    + .22 * Math.sin(x * 13.8 - z * 9.2 + y * 11.1 + seed);
}
function geology(id, x, y, z) {
  const warp = noise(x, y, z, id === "cinder" ? 9.4 : 3.7);
  const broad = noise(x + .16 * warp, y - .11 * warp, z + .14 * warp, id === "cinder" ? 7.8 : 1.1);
  const ridge = 1 - Math.abs(Math.sin(x * 16 + y * 11 + z * 9 + warp * 3));
  const fracture = Math.abs(Math.sin(x * 8.1 - y * 5.6 + z * 4.7 + warp));
  if (id === "echo-thalassa") {
    // Large connected seas and branching low channels. Water is at zero,
    // while the same ridges remain fixed when approached or landed on.
    const continent = clamp((broad + .18) / 1.65);
    const land = Math.max(0, continent - .36);
    if (!land) return 0;
    const riverCut = 1 - Math.exp(-fracture * fracture * 110);
    return clamp((land * .88 + ridge ** 4 * land * .7) * riverCut);
  }
  // Dry terraced uplands and broad rift valleys; there is no water classification.
  const plateau = clamp(.48 + broad * .23);
  const terraces = Math.floor(plateau * 10) / 10;
  return clamp(.08 + terraces * .62 + ridge ** 3 * .23 - Math.exp(-fracture * fracture * 65) * .18);
}
export function getEchoTerrainHeightField(id) {
  const definition = echoTerrainDefinitions[id];
  if (!definition) return undefined;
  if (fields.has(id)) return fields.get(id);
  const width = 512, height = 256;
  const data = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const latitude = ((row + .5) / height - .5) * Math.PI;
    for (let column = 0; column < width; column++) {
      const longitude = (column + .5) / width * Math.PI * 2;
      const x = -Math.cos(longitude) * Math.cos(latitude), y = Math.sin(latitude), z = Math.sin(longitude) * Math.cos(latitude);
      data[row * width + column] = Math.round(geology(id, x, y, z) * 255);
    }
  }
  // Longitude has only one physical value at either pole. Taper four rows so
  // linear sampling stays smooth and exactly matches the GPU DataTexture.
  for (const pole of [0, height - 1]) {
    let mean = 0;
    for (let column = 0; column < width; column++) mean += data[pole * width + column] / width;
    for (let step = 0; step < 4; step++) {
      const row = pole === 0 ? step : pole - step, blend = step / 4;
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        data[index] = Math.round(mean * (1 - blend) + data[index] * blend);
      }
    }
  }
  const waterMask = id === "echo-thalassa" ? Uint8Array.from(data, value => value <= 4 ? 255 : 0) : undefined;
  const field = Object.freeze({ ...definition, width, height, data, ...(waterMask ? { waterMask } : {}) });
  fields.set(id, field);
  return field;
}
