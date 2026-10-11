import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const root = new URL("https://dns0129.github.io/space_exploration/");
const expected = process.env.GITHUB_SHA;
assert.match(expected ?? "", /^[a-f0-9]{40}$/, "An exact target commit is required");
const evidence = { expectedRevision: expected, checkedAt: null, requests: [], version: null, download: null };
async function request(path, options = {}) {
  const url = new URL(path, root);
  url.searchParams.set("verify", expected);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000), ...options });
  evidence.requests.push({ url: url.href, method: options.method ?? "GET", status: response.status });
  return response;
}
async function get(path, json = false) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} must return public HTTP 200`);
  return json ? response.json() : response.text();
}
async function verifyDownload(download) {
  assert.equal(download?.revision, expected, "Offline download must come from the deployed source revision");
  assert.equal(download.url, root.pathname + "downloads/voyager-warp.zip", "Offline download must use the public site path");
  assert(Number.isSafeInteger(download.size) && download.size > 0, "Offline download must declare its exact byte size");
  assert.match(download.sha256, /^[a-f0-9]{64}$/, "Offline download must publish its SHA-256");
  const head = await request(download.url, { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
  assert.equal(head.status, 200, "Public offline download must return HTTP 200");
  assert.equal(Number(head.headers.get("content-length")), download.size, "Public ZIP size must match deployment metadata");

  const response = await request(download.url, {
    headers: { Range: "bytes=0-3", "Accept-Encoding": "identity" },
  });
  assert([200, 206].includes(response.status), "Public offline download must serve a ZIP byte range");
  if (response.status === 206)
    assert.equal(response.headers.get("content-range"), `bytes 0-3/${download.size}`, "ZIP byte range must describe the published package size");
  assert(response.body, "Public ZIP response must have a body");
  // Some CDNs ignore Range. Read only the ZIP header and cancel immediately
  // rather than buffering a complete full-resolution download in the verifier.
  const reader = response.body.getReader();
  const signature = new Uint8Array(4);
  let offset = 0;
  try {
    while (offset < signature.length) {
      const { value, done } = await reader.read();
      if (done) break;
      const length = Math.min(value.length, signature.length - offset);
      signature.set(value.subarray(0, length), offset);
      offset += length;
    }
  } finally {
    await reader.cancel();
  }
  assert.deepEqual([...signature], [0x50, 0x4b, 0x03, 0x04], "Public offline download must contain a real ZIP header");
  evidence.download = { ...download, rangeStatus: response.status, signature: "504b0304" };
}
await mkdir("test-results/public", { recursive: true });
try {
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      evidence.version = await get("version.json", true);
      if (evidence.version.revision === expected) break;
    } catch (error) {
      console.log(`Public version check ${attempt + 1}: ${error.message}`);
    }
    if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 15000));
  }
  assert.equal(evidence.version?.revision, expected, "Public version.json must match the deployed commit");
  const home = await get("");
  const game = await get("game.html");
  const downloaded = new Map();
  for (const [name, html] of [["home", home], ["game", game]]) {
    const entries = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    assert(entries.length > 0, `Public ${name} must load a built JavaScript entry`);
    const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(match => match[1]);
    let revisionEmbedded = false;
    for (const path of new Set([...entries, ...preloads])) {
      if (!downloaded.has(path)) downloaded.set(path, await get(path));
      const asset = downloaded.get(path);
      assert(asset.length > 1000, `Public asset ${path} must be available`);
      revisionEmbedded ||= asset.includes(expected);
    }
    assert(revisionEmbedded, `Public ${name} JavaScript must embed the exact build revision`);
  }
  await verifyDownload(evidence.version.download);
  evidence.checkedAt = new Date().toISOString();
  console.log(`PASS public home/game/assets/download HTTP 200; ZIP size and signature match; version.json revision ${expected}`);
} finally {
  await writeFile("test-results/public/deployment.json", JSON.stringify(evidence, null, 2) + "\n");
}
