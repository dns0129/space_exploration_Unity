import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { terrainHeightKm, LANDING_CLEARANCE_KM, TERRAIN_VERSION } from "../shared/surface.mjs";

async function seedCheckpoint(page: Page) {
  const world = await (await page.request.get("/api/world")).json();
  const body = world.bodies.find((candidate: any) => candidate.id === "earth");
  const height = terrainHeightKm(body.id, [0, 0, -1]) + LANDING_CLEARANCE_KM;
  const checkpoint = {
    version: 2, worldLayoutVersion: world.layoutVersion, terrainVersion: TERRAIN_VERSION,
    position: [body.position[0], body.position[1], body.position[2] - body.radius - height / world.unitsKm],
    velocity: [0, 0, 0], orientation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    target: body.id, camera: "chase", assist: true, elapsed: 42,
    systemId: "solar", landedBody: body.id,
  };
  await page.request.get("/api/flight/save");
  expect((await page.request.post("/api/flight/save", { data: checkpoint })).ok()).toBe(true);
  const saved = (await (await page.request.get("/api/flight/save")).json()).state;
  // Load only the browser module, so the intentional event-loop stalls below
  // exercise network deadlines without the renderer adding variable GPU load.
  await page.goto("/api/world");
  return saved;
}

for (const delay of [3000, 6000]) {
  test(`主线程忙碌 ${delay / 1000} 秒仍读取已经到达的有效存档`, async ({ page }) => {
    const expected = await seedCheckpoint(page);
    const result = await page.evaluate(async delay => {
      const { FlightStore } = await import("/src/flight-store.ts");
      const store = new FlightStore();
      await store.connect();
      const reading = store.read();
      const end = performance.now() + delay;
      while (performance.now() < end) { /* Simulate synchronous terrain creation. */ }
      return { state: await reading, online: store.online };
    }, delay);
    expect(result.state).toEqual(expected);
    expect(result.online).toBe(true);
  });
}

test("主线程忙碌不会把已连接的服务或成功写入误判为离线", async ({ page }) => {
  const checkpoint = await seedCheckpoint(page);
  const result = await page.evaluate(async checkpoint => {
    const { FlightStore } = await import("/src/flight-store.ts");
    const store = new FlightStore();
    const block = () => {
      const end = performance.now() + 6000;
      while (performance.now() < end) { /* Exceed both connection and save deadlines. */ }
    };
    const connecting = store.connect();
    block();
    await connecting;
    const connected = store.online;
    const saving = store.save({ ...checkpoint, elapsed: 43 });
    block();
    return { connected, destination: await saving, online: store.online };
  }, checkpoint);
  expect(result).toEqual({ connected: true, destination: "server", online: true });
  expect((await (await page.request.get("/api/flight/save")).json()).state.elapsed).toBe(43);
});

test("网络没有响应时仍按原期限返回有效本机存档并保留后续本机保存", async ({ page }) => {
  const checkpoint = await seedCheckpoint(page);
  await page.route("**/api/flight/save", () => { /* Deliberately leave the request unanswered. */ });
  const result = await page.evaluate(async checkpoint => {
    const { FlightStore } = await import("/src/flight-store.ts");
    localStorage.setItem("voyager-flight-v1", JSON.stringify({ ...checkpoint, elapsed: 17 }));
    const store = new FlightStore();
    await store.connect();
    const started = performance.now();
    const restored = await store.read();
    const readMs = performance.now() - started, offlineAfterRead = !store.online;
    // Exercise a later online write attempt against the same unavailable API.
    store.online = true;
    const savingStarted = performance.now();
    const destination = await store.save({ ...checkpoint, elapsed: 18 });
    const saveMs = performance.now() - savingStarted;
    return { restored, readMs, saveMs, offlineAfterRead, destination,
      final: await store.read(), online: store.online };
  }, checkpoint);
  expect(result.restored).toEqual({ ...checkpoint, elapsed: 17 });
  expect(result.final).toEqual({ ...checkpoint, elapsed: 18 });
  expect(result.offlineAfterRead).toBe(true);
  expect(result.destination).toBe("local");
  expect(result.online).toBe(false);
  expect(result.readMs).toBeGreaterThanOrEqual(2400);
  expect(result.readMs).toBeLessThan(5000);
  expect(result.saveMs).toBeGreaterThanOrEqual(3900);
  expect(result.saveMs).toBeLessThan(6500);
});
