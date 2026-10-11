import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
const expected = JSON.parse(await readFile(process.argv[2] || 'site/version.json', 'utf8'));
assert.equal(expected.kind, 'unity-webgl-game');
const root = process.env.VOYAGER_PUBLIC_URL || 'https://dns0129.github.io/space_exploration_Unity/';
const evidence = {url: root, revision: expected.revision, checkedAt: new Date().toISOString(), requests: []};
async function request(path) {
  const response = await fetch(new URL(path, root), {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  evidence.requests.push({path, status: response.status});
  assert.equal(response.status, 200, path);
  return response;
}
try {
  let actual;
  for (let attempt = 0; attempt < 18; attempt++) {
    try { actual = await (await request('version.json?t=' + Date.now())).json(); } catch { actual = null; }
    if (actual?.revision === expected.revision) break;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  assert.equal(actual?.revision, expected.revision, 'The public game must match the uploaded Unity build.');
  assert.equal(actual.kind, 'unity-webgl-game');
  const html = await (await request('index.html')).text();
  assert.ok(html.includes('window.voyagerConfig') && !html.includes('{{{'), 'A compiled Unity template is required.');
  // Check all exported URLs; the browser check subsequently loads the complete player.
  for (const asset of expected.assets.filter(asset => asset.size > 0)) {
    const response = await request(asset.path);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.ok(first.value?.length > 0, asset.path);
    if (asset.path.endsWith('.wasm')) assert.equal(Buffer.from(first.value).subarray(0, 4).toString('hex'), '0061736d');
    await reader.cancel();
  }
  evidence.success = true;
  console.log(`Public Unity WebGL game verified: ${root} (${expected.revision}).`);
} catch (error) { evidence.success = false; evidence.error = error.message; throw error; }
finally {
  await mkdir('test-results/public', {recursive: true});
  await writeFile('test-results/public/deployment.json', JSON.stringify(evidence, null, 2));
}
