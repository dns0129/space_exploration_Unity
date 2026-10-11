import { test, expect } from "@playwright/test";
import { FlightRenderPolicy } from "../src/render-mode";
import type { RenderEnvironment } from "../src/render-mode";

const earth: RenderEnvironment = { bodyId: "earth", atmosphereKm: 160, altitudeKm: 200,
  groundAltitudeKm: 200, solid: true, warping: false };

test("大气内单独渲染星球环境，边界有高度滞回", () => {
  const policy = new FlightRenderPolicy();
  const at = (altitudeKm: number) => policy.update({ ...earth, altitudeKm, groundAltitudeKm: altitudeKm });
  expect(at(160.01)).toBe("space");
  expect(at(160)).toBe("surface");
  for (const altitude of [160.01, 159.99, 170, 160, 175.99]) expect(at(altitude)).toBe("surface");
  expect(at(176.01)).toBe("space");
  expect(at(170)).toBe("space");
  expect(at(159.99)).toBe("surface");
});

test("无大气固体地表也使用局部场景，星球切换不继承滞回", () => {
  const policy = new FlightRenderPolicy();
  const moon = { ...earth, bodyId: "moon", atmosphereKm: 0, altitudeKm: 69, groundAltitudeKm: 69 };
  expect(policy.update(moon)).toBe("surface");
  expect(policy.update({ ...moon, altitudeKm: 75, groundAltitudeKm: 75 })).toBe("surface");
  expect(policy.update({ ...moon, bodyId: "mercury", altitudeKm: 75, groundAltitudeKm: 75 })).toBe("space");
  expect(policy.update({ ...moon, altitudeKm: 70, groundAltitudeKm: 70 })).toBe("surface");
  expect(policy.update({ ...moon, altitudeKm: 81, groundAltitudeKm: 81 })).toBe("space");
});

test("巨行星大气由局部场景接管，跃迁和无地表恒星保持太空场景", () => {
  const policy = new FlightRenderPolicy();
  expect(policy.update({ ...earth, bodyId: "jupiter", atmosphereKm: 800,
    altitudeKm: 700, groundAltitudeKm: 700, solid: false })).toBe("surface");
  expect(policy.update({ ...earth, altitudeKm: 50, groundAltitudeKm: 50, warping: true })).toBe("space");
  expect(policy.update({ ...earth, bodyId: "sun", atmosphereKm: 0,
    altitudeKm: 1, groundAltitudeKm: 1, solid: false })).toBe("space");
  policy.update({ ...earth, altitudeKm: 100, groundAltitudeKm: 100 });
  policy.reset();
  expect(policy.update({ ...earth, altitudeKm: 170, groundAltitudeKm: 170 })).toBe("space");
});
