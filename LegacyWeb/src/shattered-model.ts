import * as THREE from "three";
import type { PlanetModel } from "./planet-models";
import { createShatteredGeometries } from "./shattered-geometry";
import { createShatteredMaterial } from "./shattered-material";
import { PROCEDURAL_DETAIL_WIDTH } from "./procedural-body";

type ShaderSources = { vertex: string; noise: string; atmosphere: string };

/** A spherical planet opening along real faults, with matching curved crust shards. */
export function configureShatteredModel(model: PlanetModel,
  uniforms: Record<string, THREE.IUniform>, sources: ShaderSources) {
  const { crust, mantle, debris } = createShatteredGeometries(model.body.id === "shard");
  model.surface.geometry.dispose();
  (model.surface.material as THREE.Material).dispose();
  const material = createShatteredMaterial(uniforms, sources, model.body.id === "shard");
  model.surface.geometry = crust;
  model.surface.material = material;
  model.surface.rotation.y = 0;
  model.surface.name = "surviving-fractured-crust";
  const inner = new THREE.Mesh(mantle, material);
  inner.name = "recessed-molten-mantle";
  model.surface.add(inner);
  const fragments = new THREE.Mesh(debris, material);
  fragments.name = "irregular-detached-rocks";
  model.surface.add(fragments);
  model.group.userData.shatteredReference = { ...crust.userData,
    ...debris.userData, detailWidth: PROCEDURAL_DETAIL_WIDTH, detailType: "procedural" };
}
