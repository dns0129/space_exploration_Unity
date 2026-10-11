import * as THREE from "three";
import { terrainHeightField, terrainMapNormal } from "../shared/surface.mjs";

// Exercise a real elevated source pixel, rather than assuming the old
// procedural mountain happened to remain at a fixed world direction.
export function mappedMountainNormal(id = "earth") {
  const field = terrainHeightField(id);
  let summit = 0;
  for (let i = 1; i < field.data.length; i++) if (field.data[i] > field.data[summit]) summit = i;
  return new THREE.Vector3().fromArray(terrainMapNormal(id,
    [(summit % field.width + 0.5) / field.width, (Math.floor(summit / field.width) + 0.5) / field.height]));
}
