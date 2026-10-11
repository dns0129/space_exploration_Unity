import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp, mkdir, mkdtemp, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareWebGL} from './prepare-webgl-site.mjs';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
async function git(args, cwd = root) {
  const result = await execute('git', args, {cwd, maxBuffer: 4 * 1024 * 1024});
  return result.stdout.trim();
}
const version = await prepareWebGL(process.argv[2]);
const head = await git(['rev-parse', 'HEAD']);
if (head !== version.revision) throw new Error('The build is from a different commit. Rebuild the current main before publishing.');
if (await git(['status', '--porcelain'])) throw new Error('Commit source changes and rebuild before publishing. Unity may generate settings and asset metadata during its first import.');
const remote = await git(['remote', 'get-url', 'origin']);
if (!/github\.com[/:]dns0129\/space_exploration_Unity(?:\.git)?$/.test(remote)) throw new Error('Origin must be dns0129/space_exploration_Unity.');
const main = (await git(['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0];
if (head !== main) throw new Error('Push this source commit to main before publishing its WebGL build.');
const temporary = await mkdtemp(join(tmpdir(), 'voyager-pages-'));
try {
  const exists = await git(['ls-remote', 'origin', 'refs/heads/gh-pages']);
  if (exists) {
    await git(['clone', '--depth', '1', '--branch', 'gh-pages', remote, temporary]);
    // Keep Git history and replace the site with this verified Unity build.
    for (const name of await readdir(temporary)) if (name !== '.git') await rm(join(temporary, name), {recursive: true, force: true});
  } else {
    await git(['init', '--initial-branch=gh-pages'], temporary);
    await git(['remote', 'add', 'origin', remote], temporary);
  }
  const name = await git(['config', 'user.name']), email = await git(['config', 'user.email']);
  await git(['config', 'user.name', name], temporary); await git(['config', 'user.email', email], temporary);
  await mkdir(join(temporary, 'site'), {recursive: true});
  await cp(join(root, 'dist-pages'), join(temporary, 'site'), {recursive: true});
  await mkdir(join(temporary, '.github/workflows'), {recursive: true});
  await cp(join(root, '.github/workflows/deploy-pages.yml'), join(temporary, '.github/workflows/deploy-pages.yml'));
  await mkdir(join(temporary, 'tools'), {recursive: true});
  for (const file of ['verify-public-site.mjs', 'validate-webgl-site.mjs']) await cp(join(root, 'tools', file), join(temporary, 'tools', file));
  await cp(join(root, 'tools/WebChecks'), join(temporary, 'tools/WebChecks'), {
    recursive: true, filter: source => !source.split(/[\\/]/).includes('node_modules')
  });
  await git(['add', '--all'], temporary);
  await git(['commit', '-m', `Publish Unity WebGL from ${version.revision}`], temporary);
  await git(['push', 'origin', 'HEAD:gh-pages'], temporary);
  console.log('Uploaded Unity WebGL. Enable Settings → Pages → Source: GitHub Actions once.');
  console.log('Deployment workflow: https://github.com/dns0129/space_exploration_Unity/actions/workflows/deploy-pages.yml');
  console.log('Expected game URL after successful deployment: https://dns0129.github.io/space_exploration_Unity/');
} finally { await rm(temporary, {recursive: true, force: true}); }
