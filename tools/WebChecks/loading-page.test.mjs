import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../../Assets/WebGLTemplates/Voyager/', import.meta.url));
const template = (await readFile(root + 'index.html', 'utf8'))
  .replaceAll('{{{ LOADER_FILENAME }}}', 'game.loader.js').replaceAll('{{{ DATA_FILENAME }}}', 'game.data')
  .replaceAll('{{{ FRAMEWORK_FILENAME }}}', 'game.framework.js').replaceAll('{{{ CODE_FILENAME }}}', 'game.wasm');
let browser, server, url;
before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname.replace('/space_exploration_Unity/', '');
    try {
      if (!['', 'index.html', 'styles.css', 'player.js'].includes(path)) {response.writeHead(404); response.end(); return;}
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(path === '' || path === 'index.html' ? template : await readFile(root + path));
    } catch {response.writeHead(500); response.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/space_exploration_Unity/`;
  browser = await chromium.launch({executablePath: process.env.VOYAGER_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader']});
});
after(async () => {await browser?.close(); await new Promise(resolve => server?.close(resolve));});

test('loading page handles a missing Unity loader at a project subpath', async () => {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  try {
    await page.goto(url);
    await page.locator('#retry').waitFor({state: 'visible'});
    assert.match(await page.locator('#loading-text').textContent(), /Unity 加载器下载失败/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mkdir('test-results/pages', {recursive: true});
    await page.screenshot({path: 'test-results/pages/loading-desktop.png', fullPage: true});
  } finally {await page.close();}
});

test('loading page reveals the canvas on a runtime notification and prompts for a new version', async () => {
  // This isolates the page contract; it is not a Unity runtime test.
  const page = await browser.newPage();
  let revision = 'a'.repeat(40);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/version.json?*', route => route.fulfill({json: {revision}}));
  await page.route('**/Build/game.loader.js', route => route.fulfill({contentType: 'text/javascript', body: `
    window.createUnityInstance = async (canvas, config, progress) => {
      window.receivedStreamingPath = config.streamingAssetsUrl;
      progress(1); document.documentElement.dataset.gameReady = 'true';
      window.dispatchEvent(new Event('voyager-ready')); return {};
    };` }));
  try {
    await page.goto(url);
    await page.locator('#loading').waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.getElementById('revision').title.length === 40);
    assert.equal(await page.evaluate(() => window.receivedStreamingPath), 'StreamingAssets');
    revision = 'b'.repeat(40);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('#new-version').waitFor({state: 'visible'});
    assert.match(await page.locator('#new-version').textContent(), /先在游戏中保存/);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('voyager-message', {detail: '航行已保存'})));
    assert.equal(await page.locator('#message').textContent(), '航行已保存');
    assert.deepEqual(errors, []);
  } finally {await page.close();}
});

test('unsupported WebGL shows a useful mobile error without overflowing', async () => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  try {
    await page.goto(url);
    await page.locator('#retry').waitFor({state: 'visible'});
    assert.match(await page.locator('#loading-text').textContent(), /WebAssembly 和 WebGL 2/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({path: 'test-results/pages/loading-mobile.png', fullPage: true});
  } finally {await page.close();}
});
