import { world, validateFlightState } from "../shared/flight-state.mjs";
import type { WorldConfig, FlightState } from "../shared/flight-state.mjs";
const key = "voyager-flight-v1";

async function fetchWithDeadline<T>(
  path: string,
  timeoutMs: number,
  consume: (response: Response) => Promise<T> | T,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  // A native AbortSignal timeout can expire while terrain creation blocks the
  // main thread, aborting a response that has already arrived. A cancellable
  // main-thread timer yields once before aborting, letting queued headers and
  // body completion run after a long task. Keep the deadline active through
  // JSON consumption so a stalled response body still falls back.
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    abortTimer = setTimeout(() => controller.abort(), 0);
  }, timeoutMs);
  try {
    return await consume(await fetch(path, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
    clearTimeout(abortTimer);
  }
}

export class FlightStore {
  online = false;
  async connect(): Promise<WorldConfig> {
    this.online = false;
    if (import.meta.env.VITE_PUBLIC_SITE === "true" || !["http:", "https:"].includes(location.protocol) || !navigator.onLine)
      return world;
    try {
      const config = await fetchWithDeadline(
        "/api/world", 2500,
        (response) => response.ok ? response.json() : null,
      );
      if (JSON.stringify(config) === JSON.stringify(world)) {
        this.online = true;
        return config;
      }
    } catch {
      /* Offline navigation keeps the local world. */
    }
    return world;
  }
  async read(): Promise<FlightState | null> {
    if (!navigator.onLine) this.online = false;
    if (this.online)
      try {
        const saved = await fetchWithDeadline(
          "/api/flight/save", 2500,
          (response) => response.ok ? response.json() : null,
        );
        const state = validateFlightState(saved?.state);
        if (state) return state;
      } catch {
        this.online = false;
      }
    try {
      return validateFlightState(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
    } catch {
      return null;
    }
  }
  async save(state: FlightState): Promise<"server" | "local"> {
    if (!navigator.onLine) this.online = false;
    const safe = validateFlightState(state);
    if (!safe) throw new Error("Invalid flight state");
    let local = false;
    try {
      localStorage.setItem(key, JSON.stringify(safe));
      local = true;
    } catch {
      /* Server storage can still succeed. */
    }
    if (this.online)
      try {
        const saved = await fetchWithDeadline(
          "/api/flight/save", 4000,
          (response) => response.ok,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(safe),
          },
        );
        if (saved) return "server";
      } catch {
        /* Fall back to a local save. */
      }
    this.online = false;
    if (local) return "local";
    throw new Error("无法保存航行，请检查浏览器存储空间。");
  }
}
