import { test, expect } from "@playwright/test";
import { proceduralBodyProfile } from "../src/procedural-body";
import { SOLAR_SYSTEM } from "../src/solar-system";
import { SURFACE_MAPS } from "../src/body-textures";

test("天体程序地貌在重载及不同导航顺序下保持一致，共享概念图也使用独立世界", () => {
  const before = new Map(SOLAR_SYSTEM.map(body => [body.id, proceduralBodyProfile(body)]));
  expect(new Set([...before.values()].map(profile => profile.seed.join(","))).size).toBe(SOLAR_SYSTEM.length);
  for (const body of [...SOLAR_SYSTEM].reverse()) {
    expect(proceduralBodyProfile(body)).toEqual(before.get(body.id));
    expect(proceduralBodyProfile({ ...body, surfaceSeed: (body.surfaceSeed ?? 0) + 1 }).seed).not.toEqual(before.get(body.id)!.seed);
  }

  // These moons reuse one conceptual image: its native 4K map must not determine their generated worlds.
  const shared = SOLAR_SYSTEM.filter(body => SURFACE_MAPS[body.id]?.file === "concept-asteroid.jpg");
  expect(shared.length).toBeGreaterThan(1);
  expect(new Set(shared.map(body => before.get(body.id)!.seed.join(","))).size).toBe(shared.length);
  expect(new Set(shared.map(body => before.get(body.id)!.terrain.join(","))).size).toBe(shared.length);

  // Different material families must keep distinct shapes rather than just recolouring one noise field.
  const archetypes = ["mars", "europa", "jupiter", "sun"] as const;
  expect(new Set(archetypes.map(id => JSON.stringify([
    before.get(id)!.terrain, before.get(id)!.weather, before.get(id)!.stretch,
  ]))).size).toBe(archetypes.length);
});
