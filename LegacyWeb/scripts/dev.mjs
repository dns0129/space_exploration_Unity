import { spawn } from "node:child_process";
import { createVoyagerServer } from "../server/server.mjs";
const server = createVoyagerServer();
const port = Number(process.env.VOYAGER_API_PORT ?? 3000);
server.on("error", (error) => {
  console.error(`Backend startup failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "0.0.0.0",
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, VOYAGER_API_PORT: String(port) },
    },
  );
  const stop = () => {
    child.kill("SIGTERM");
    server.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    server.close(() => {
      process.exitCode = code ?? 0;
    });
  });
});
