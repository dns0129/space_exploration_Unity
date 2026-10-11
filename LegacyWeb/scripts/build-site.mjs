import { build } from "vite";
import { readFile, writeFile, rename, copyFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const project = fileURLToPath(new URL("../", import.meta.url));
const revision =
  process.env.GITHUB_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: project,
    encoding: "utf8",
  }).trim();
if (!/^[a-f0-9]{40}$/.test(revision))
  throw new Error("A complete Git revision is required for deployment.");
const base = process.env.VOYAGER_SITE_BASE || "/space_exploration/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
  throw new Error("Website base must be an absolute path ending in /.");
const output = join(project, "dist-site");
// Every site build publishes a fresh offline package from the same source.
// Export first: Vite clears dist-site, so the ZIP is copied after its build.
execFileSync(process.execPath, [join(project, "scripts/export-standalone.mjs")], {
  cwd: project,
  stdio: "inherit",
});
await build({
  root: project,
  base,
  define: {
    "import.meta.env.VITE_PUBLIC_SITE": JSON.stringify("true"),
    "import.meta.env.VITE_SITE_REVISION": JSON.stringify(revision),
  },
  build: {
    outDir: output,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: join(project, "index.html"),
        site: join(project, "site.html"),
      },
    },
  },
});
await rename(join(output, "index.html"), join(output, "game.html"));
await rename(join(output, "site.html"), join(output, "index.html"));
await writeFile(join(output, ".nojekyll"), "");
await mkdir(join(output, "downloads"), { recursive: true });
const downloadFile = join(output, "downloads/voyager-warp.zip");
await copyFile(join(project, "dist-standalone/voyager-warp.zip"), downloadFile);
const hash = createHash("sha256");
for await (const chunk of createReadStream(downloadFile)) hash.update(chunk);
const download = {
  revision,
  url: base + "downloads/voyager-warp.zip",
  size: (await stat(downloadFile)).size,
  sha256: hash.digest("hex"),
};
await writeFile(
  join(output, "version.json"),
  JSON.stringify({ revision, builtAt: new Date().toISOString(), download }) + "\n",
);
await mkdir(join(output, "legal"), { recursive: true });
for (const filename of ["ASSETS.md", "THIRD_PARTY_NOTICES.md"])
  await copyFile(join(project, filename), join(output, "legal", filename));
const home = await readFile(join(output, "index.html"), "utf8");
const game = await readFile(join(output, "game.html"), "utf8");
if (!home.includes(base + "assets/") || !game.includes(base + "assets/"))
  throw new Error("Website assets are missing the project path.");
console.log(
  `Website built for ${base} at revision ${revision.slice(0, 7)} with ${(download.size / 1024 / 1024).toFixed(1)} MiB offline download. Public website uses browser-local saves.`,
);
