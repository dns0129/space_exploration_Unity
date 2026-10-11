import { chromium } from '@playwright/test';
import { createVoyagerServer } from '../server/server.mjs';
import { world } from '../shared/flight-state.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import * as THREE from 'three';

const baselineIndex = process.argv.indexOf('--baseline');
const hardware = process.argv.includes('--hardware');
const quick = process.argv.includes('--quick');
const roots = baselineIndex >= 0
  ? [['baseline', resolve(process.argv[baselineIndex + 1])], ['current', resolve('dist')]]
  : [['current', resolve('dist')]];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: hardware ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'],
});
const results = [];
await mkdir('test-results/performance', { recursive: true });
try {
  for (const [version, staticRoot] of roots) {
    const dataDir = await mkdtemp(join(tmpdir(), 'voyager-performance-'));
    const server = createVoyagerServer({ staticRoot, dataDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      for (const [device, width, height, deviceScaleFactor] of (quick ? [['desktop',1440,960,1]] : [['desktop',1440,960,1], ['mobile',412,915,2.625]])) {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, baseURL: origin });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.goto(origin);
        await page.locator('#canvas-host[data-ready="true"]').waitFor({ timeout: 45000 });
        for (const [target, altitude] of (quick ? [['earth',1100]] : [['earth',1100], ['mars',1100], ['jupiter',3000]])) {
          if (await page.locator('#canvas-host[data-mode="flight"]').count()) {
            // A baseline with a different config uses local saves; don't require a server POST.
            await page.getByRole('button', { name: '行星观测', exact: true }).click();
            await page.locator('#canvas-host[data-mode="observe"][data-ready="true"]').waitFor();
          }
          const body = world.bodies.find(body => body.id === target);
          const radial = new THREE.Vector3(0,0,-1), forward = new THREE.Vector3(1,0,0.25).normalize();
          const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, radial));
          const state = { version: 2, worldLayoutVersion: world.layoutVersion, systemId: 'solar',
            position: new THREE.Vector3().fromArray(body.position).addScaledVector(radial, body.radius + altitude / world.unitsKm).toArray(),
            velocity: [0,0,0], orientation: orientation.toArray(), target, camera: 'cockpit', assist: true, elapsed: 0 };
          await page.evaluate(state => localStorage.setItem('voyager-flight-v1', JSON.stringify(state)), state);
          await page.request.post('/api/flight/save', { data: state });
          await page.reload();
          await page.locator('#canvas-host[data-ready="true"]').waitFor({ timeout: 45000 });
          await page.getByRole('button', { name: '自由航行', exact: true }).click();
          await page.locator('#canvas-host[data-mode="flight"]').waitFor();
          await page.locator('#loading-overlay').waitFor({ state: 'hidden' });
          await page.locator('#flight-quality').selectOption('high');
          await page.locator('#flight-resume').click();
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 12000)));
          const sample = await page.evaluate(async () => {
            const samples = []; let previous = performance.now(); const start = previous;
            while (performance.now() - start < 8000) {
              const now = await new Promise(resolve => requestAnimationFrame(resolve));
              samples.push(now - previous); previous = now;
            }
            samples.sort((a,b) => a-b);
            const mean = samples.reduce((a,b) => a+b,0) / samples.length;
            const canvas = document.querySelector('canvas');
            return { fps: Math.round(10000 / mean) / 10,
              medianMs: Math.round(samples[Math.floor(samples.length * .5)] * 10) / 10,
              p95Ms: Math.round(samples[Math.floor(samples.length * .95)] * 10) / 10,
              frames: samples.length, renderScale: canvas.dataset.renderScale ?? 'fixed',
              canvas: [canvas.width,canvas.height], graphicsRenderer: canvas.dataset.graphicsRenderer ?? 'not exposed by baseline',
              destination: document.querySelector('#flight-target').textContent, altitude: document.querySelector('#flight-altitude').textContent };
          });
          if (sample.destination !== ({ earth: '地球', mars: '火星', jupiter: '木星' })[target]
            || !sample.altitude.startsWith(altitude.toLocaleString('en-US') + ' km')) throw new Error(`Wrong scene: ${JSON.stringify(sample)}`);
          const result = { version, device, target, ...sample };
          results.push(result); console.log(JSON.stringify(result));
          // Persist measurements before assertions so a slow scenario remains diagnosable.
          await writeFile('test-results/performance/metrics.json', JSON.stringify({
            renderer: hardware ? 'Chromium system backend (see graphicsRenderer)' : 'Chromium SwiftShader (CPU, no hardware GPU)',
            compositor: hardware ? 'system' : 'software', results }, null, 2));
          if (version === 'current' && (sample.fps < 55 || sample.p95Ms > 22)) throw new Error(`Frame budget exceeded: ${JSON.stringify(result)}`);
          if (version === 'current') await page.screenshot({ path: `test-results/performance/${device}-${target}.png` });
        }
        if (errors.length) throw new Error(errors.join('\n'));
        await context.close();
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  }
} finally { await browser.close(); }
