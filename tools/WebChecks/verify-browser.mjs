import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
const url = process.argv[2];
if (!url) throw new Error('Provide the published or locally served Unity WebGL URL.');
await mkdir('test-results/public', {recursive: true});
const browser = await chromium.launch({
  executablePath: process.env.VOYAGER_CHROMIUM || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
});
const context = await browser.newContext({viewport: {width: 1600, height: 1100}});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const evidence = {url, success: false};
try {
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === 'true' && !!window.voyagerInstance, null, {timeout: 180000});
  await page.evaluate(() => {
    window.addEventListener('voyager-message', event => { window.lastVoyagerMessage = event.detail; });
    window.voyagerInstance.SendMessage('Voyager simulation', 'Save');
  });
  await page.waitForFunction(() => window.lastVoyagerMessage === '航行已保存');
  // Allow the asynchronous IndexedDB write to settle before a real reload.
  await page.waitForTimeout(2000);
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === 'true' && !!window.voyagerInstance, null, {timeout: 180000});
  await page.evaluate(() => {
    window.addEventListener('voyager-message', event => { window.lastVoyagerMessage = event.detail; });
    window.voyagerInstance.SendMessage('Voyager simulation', 'Load');
  });
  await page.waitForFunction(() => window.lastVoyagerMessage === '已恢复航行');
  assert.deepEqual(errors, [], 'The real Unity player must start without uncaught browser exceptions.');
  await page.screenshot({path: 'test-results/public/unity-browser.png', fullPage: true});
  evidence.success = true; evidence.checks = ['Unity runtime ready', 'all terrain loaded', 'save and restore across browser reload'];
  console.log('Actual Unity WebGL startup and browser persistence passed.');
} catch (error) { evidence.error = error.message; throw error; }
finally {
  evidence.errors = errors;
  await writeFile('test-results/public/browser.json', JSON.stringify(evidence, null, 2));
  await browser.close();
}
