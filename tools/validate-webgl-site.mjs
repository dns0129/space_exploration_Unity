import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
const folder = resolve(process.argv[2] || 'site');
const version = JSON.parse(await readFile(join(folder, 'version.json'), 'utf8'));
if (version.kind !== 'unity-webgl-game' || !/^[a-f0-9]{40}$/.test(version.revision) || version.sourceDirty || !version.assets?.length)
  throw new Error('A verified, committed Unity WebGL game is required.');
for (const asset of version.assets) {
  if (!asset.path || asset.path.startsWith('/') || asset.path.split('/').includes('..')) throw new Error('Invalid asset path.');
  const bytes = await readFile(join(folder, asset.path));
  if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Build asset changed: ${asset.path}`);
}
console.log(`Verified all ${version.assets.length} files for Unity build ${version.revision}.`);
