import {cp, mkdir, readFile, writeFile, rm, readdir, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join, resolve, relative, sep, isAbsolute} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function prepareWebGL(buildPath = join(root, 'Builds/WebGL'), outputPath = join(root, 'dist-pages')) {
  const build = resolve(buildPath), output = resolve(outputPath);
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path));
  };
  if (contains(output, build)) throw new Error('The site output must not contain the Unity build.');
  if (contains(output, root)) throw new Error('The site output must not contain the repository.');
  let info;
  try { info = JSON.parse(await readFile(join(build, 'build-info.json'), 'utf8')); }
  catch { throw new Error('No Unity WebGL build found. In Unity choose Voyager → Build WebGL for GitHub Pages first.'); }
  if (!/^[a-f0-9]{40}$/.test(info.revision) || !/^2022\.3\./.test(info.unityVersion)) throw new Error('Invalid Unity build metadata.');
  if (info.sourceDirty) throw new Error('This build contains uncommitted changes. Commit the Unity source, then rebuild before publishing.');
  const html = await readFile(join(build, 'index.html'), 'utf8');
  if (html.includes('{{{') || !html.includes('window.voyagerConfig')) throw new Error('Build must use the Voyager WebGL template.');
  const binaries = await readdir(join(build, 'Build'));
  const wasm = binaries.find(name => name.endsWith('.wasm'));
  if (!wasm || !binaries.some(name => name.endsWith('.data')) || !binaries.some(name => name.endsWith('.loader.js')) || !binaries.some(name => name.endsWith('.framework.js')))
    throw new Error('Uncompressed Unity .wasm, .data, .loader.js and .framework.js are required for GitHub Pages.');
  const wasmBytes = await readFile(join(build, 'Build', wasm));
  if (!wasmBytes.subarray(0, 8).equals(Buffer.from([0,97,115,109,1,0,0,0])) || wasmBytes.length < 100000)
    throw new Error('The WebAssembly player is missing or invalid.');
  const world = JSON.parse(await readFile(join(build, 'StreamingAssets/Voyager/world.json'), 'utf8'));
  for (const body of world.bodies) {
    if (body.terrain && (await stat(join(build, 'StreamingAssets/Voyager/Terrain', body.terrain.file))).size !== body.terrain.width * body.terrain.height)
      throw new Error(`Missing or truncated terrain: ${body.terrain.file}`);
  }
  await rm(output, {recursive: true, force: true});
  await cp(build, output, {recursive: true});
  await mkdir(join(output, 'legal'), {recursive: true});
  for (const name of ['ASSETS.md', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, 'LegacyWeb', name), join(output, 'legal', name));
  await cp(join(root, 'docs/fonts/OFL.txt'), join(output, 'legal/FONT-LICENSE.txt'));
  await writeFile(join(output, '.nojekyll'), '');
  const assets = [];
  async function inventory(folder) {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await inventory(path);
      else {
        const bytes = await readFile(path);
        if (bytes.length >= 95 * 1024 * 1024) throw new Error(`File too large for GitHub: ${relative(output, path)}. Reduce texture sizes and rebuild.`);
        assets.push({path: relative(output, path).replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
      }
    }
  }
  await inventory(output);
  if (assets.reduce((sum, asset) => sum + asset.size, 0) > 950 * 1024 * 1024) throw new Error('The game exceeds the GitHub Pages site size limit.');
  const version = {...info, kind: 'unity-webgl-game', assets};
  await writeFile(join(output, 'version.json'), JSON.stringify(version, null, 2) + '\n');
  console.log(`Prepared Unity WebGL files for ${info.revision} at ${output}.`);
  return version;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareWebGL(process.argv[2], process.argv[3]);
