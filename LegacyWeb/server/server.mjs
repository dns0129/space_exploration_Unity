import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { world, validateFlightState } from "../shared/flight-state.mjs";
const project = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};
const sessionPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function createVoyagerServer({
  staticRoot = resolve(project, "dist"),
  dataDir = resolve(project, "data"),
  indexFile = "index.html",
  serveOnlyIndex = false,
} = {}) {
  const writes = new Map();
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  const session = (req, res) => {
    let id = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("voyager_session="))
      ?.slice(16);
    if (!id || !sessionPattern.test(id)) {
      id = randomUUID();
      res.setHeader(
        "Set-Cookie",
        `voyager_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      );
    }
    return id;
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/health" && req.method === "GET")
          return json(res, 200, { status: "ok", version: world.version });
        if (url.pathname === "/api/world" && req.method === "GET")
          return json(res, 200, world);
        if (url.pathname === "/api/flight/save") {
          if (!["GET", "POST"].includes(req.method))
            return json(res, 405, { error: "Method not allowed" });
          if (req.method === "POST") {
            // Same-origin browser saves; no CORS or third-party write access is enabled.
            if (
              req.headers.origin &&
              req.headers.origin !== `http://${req.headers.host}` &&
              req.headers.origin !== `https://${req.headers.host}`
            )
              return json(res, 403, {
                error: "Origin does not match this server",
              });
            if (!req.headers["content-type"]?.startsWith("application/json"))
              return json(res, 415, { error: "Expected application/json" });
          }
          const id = session(req, res),
            path = resolve(dataDir, `${id}.json`);
          if (req.method === "GET") {
            await writes.get(id);
            try {
              const saved = JSON.parse(await readFile(path, "utf8"));
              const state = validateFlightState(saved.state);
              return json(
                res,
                200,
                state ? { state, savedAt: saved.savedAt } : { state: null },
              );
            } catch (error) {
              if (error.code === "ENOENT" || error instanceof SyntaxError)
                return json(res, 200, { state: null });
              throw error;
            }
          }
          const chunks = [];
          let size = 0,
            oversize = false;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 8192) oversize = true;
            if (!oversize) chunks.push(chunk);
          }
          if (oversize) return json(res, 413, { error: "Save exceeds 8 KiB" });
          let value;
          try {
            value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return json(res, 400, { error: "Invalid JSON" });
          }
          const state = validateFlightState(value);
          if (!state) return json(res, 400, { error: "Invalid flight state" });
          const savedAt = new Date().toISOString();
          const pending = (writes.get(id) ?? Promise.resolve())
            .catch(() => {})
            .then(async () => {
              await mkdir(dataDir, { recursive: true });
              const temporary = resolve(dataDir, `${id}.${randomUUID()}.tmp`);
              await writeFile(temporary, JSON.stringify({ state, savedAt }), {
                mode: 0o600,
              });
              await rename(temporary, path);
            });
          writes.set(id, pending);
          try {
            await pending;
          } finally {
            if (writes.get(id) === pending) writes.delete(id);
          }
          return json(res, 200, { savedAt });
        }
        return json(res, 404, { error: "API not found" });
      }
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, 405, { error: "Method not allowed" });
      if (serveOnlyIndex && !["/", "/" + indexFile].includes(url.pathname))
        return json(res, 404, { error: "File not found" });
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return json(res, 400, { error: "Invalid path" });
      }
      if (pathname.includes("\0"))
        return json(res, 400, { error: "Invalid path" });
      let path = resolve(
        staticRoot,
        `.${pathname === "/" ? "/" + indexFile : pathname}`,
      );
      if (!path.startsWith(resolve(staticRoot) + sep))
        return json(res, 403, { error: "Path outside game directory" });
      let bytes;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
        if (!extname(pathname) && req.headers.accept?.includes("text/html")) {
          path = resolve(staticRoot, indexFile);
          bytes = await readFile(path);
        } else return json(res, 404, { error: "File not found" });
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      console.error("Voyager server request failed:", error.message);
      if (!res.headersSent)
        json(res, 500, { error: "Server could not complete request" });
      else res.end();
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const standalone = process.argv.includes("--standalone");
  const server = createVoyagerServer({
    staticRoot: standalone ? project : resolve(project, "dist"),
    indexFile: standalone ? "voyager-warp.html" : "index.html",
    serveOnlyIndex: standalone,
    dataDir: process.env.VOYAGER_DATA_DIR ?? resolve(project, "data"),
  });
  const port = Number(process.env.PORT ?? 3000),
    host = process.env.VOYAGER_HOST ?? "127.0.0.1";
  server.on("error", (error) => {
    console.error(`Unable to start Voyager: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `Voyager flight server ready: http://${host}:${port}/ (saves: ${process.env.VOYAGER_DATA_DIR ?? resolve(project, "data")})`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
