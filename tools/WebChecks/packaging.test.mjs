import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareWebGL} from '../prepare-webgl-site.mjs';

test('publication cannot package source code or an uncommitted Unity build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voyager-package-check-'));
  try {
    await assert.rejects(prepareWebGL(root, join(root, 'output')), /No Unity WebGL build/);
    await writeFile(join(root, 'build-info.json'), JSON.stringify({revision: 'a'.repeat(40), unityVersion: '2022.3.62f1', sourceDirty: true}));
    await assert.rejects(prepareWebGL(root, join(root, 'output')), /uncommitted changes/);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('publication rejects an uncompiled template and an invalid WebAssembly player', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voyager-package-check-'));
  try {
    await writeFile(join(root, 'build-info.json'), JSON.stringify({revision: 'a'.repeat(40), unityVersion: '2022.3.62f1', sourceDirty: false}));
    await writeFile(join(root, 'index.html'), 'window.voyagerConfig = "{{{ LOADER_FILENAME }}}";');
    await assert.rejects(prepareWebGL(root, join(root, 'output')), /Voyager WebGL template/);
    await writeFile(join(root, 'index.html'), 'window.voyagerConfig = {};');
    await mkdir(join(root, 'Build'));
    for (const name of ['game.wasm', 'game.data', 'game.loader.js', 'game.framework.js']) await writeFile(join(root, 'Build', name), 'not a Unity build');
    await assert.rejects(prepareWebGL(root, join(root, 'output')), /WebAssembly player is missing or invalid/);
  } finally {await rm(root, {recursive: true, force: true});}
});
