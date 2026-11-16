import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// Runs against the real production UI and read-only debug snapshots. It never
// changes simulation state, spawns test-only enemies, or forces a victory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results');
const started = Date.now();
const report = { checks: [], screenshots: [], canvasSamples: [], pageErrors: [], consoleErrors: [], failedRequests: [] };
let server;
let serverLog = '';
let serverError;
let browser;
let desktop;
let mobile;

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function startServer() {
  const port = Number(process.env.BROWSER_SMOKE_PORT || await freePort());
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-16000); };
  server.stdout.on('data', record);
  server.stderr.on('data', record);
  server.on('error', (error) => { serverError = error; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Preview server exited (${server.exitCode}): ${serverLog}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return url;
    } catch { /* The first request can precede the listening event. */ }
    await delay(100);
  }
  throw new Error(`Preview server did not start: ${serverLog}`);
}

function monitor(page, label) {
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', (error) => report.pageErrors.push({ page: label, message: error.message, stack: error.stack }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ page: label, message: message.text() });
  });
  page.on('requestfailed', (request) => report.failedRequests.push({ page: label, url: request.url(), failure: request.failure()?.errorText }));
}

async function visible(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
}

async function waitMode(page, mode) {
  await page.waitForFunction((expected) => window.__airplanesDebug?.mode === expected, mode, { timeout: 60000 });
}

async function waitGame(page, mode) {
  await visible(page, '#game-screen');
  await page.locator('#loading-panel').waitFor({ state: 'hidden', timeout: 90000 });
  await waitMode(page, mode);
  await page.waitForFunction(() => {
    const debug = window.__airplanesDebug;
    return debug && !debug.paused && debug.frames > 2 && debug.pose;
  }, null, { timeout: 60000 });
  await page.locator('#error-banner').waitFor({ state: 'hidden' });
}

async function snapshot(page, name, fullPage = false) {
  const filename = `${name}.png`;
  await page.screenshot({ path: resolve(output, filename), fullPage, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function verifyCanvas(page, label) {
  const sample = await page.locator('#game-canvas').evaluate((canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 32 || canvas.height < 32) return { width: canvas.width, height: canvas.height, opaque: 0, colours: 0 };
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const step = Math.max(1, Math.floor((data.length / 4) / 4096));
    let opaque = 0, samples = 0;
    const colours = new Set();
    for (let pixel = 0; pixel < data.length / 4; pixel += step) {
      const i = pixel * 4;
      samples++;
      if (data[i + 3] > 0) {
        opaque++;
        colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
    }
    return { width: canvas.width, height: canvas.height, opaque, samples, colours: colours.size };
  });
  report.canvasSamples.push({ label, ...sample });
  assert.ok(sample.width >= 32 && sample.height >= 32, `${label}: canvas has a usable resolution`);
  assert.ok(sample.opaque > 100 && sample.colours > 8, `${label}: terrain and aircraft produce a nonempty, varied pixel frame: ${JSON.stringify(sample)}`);
}

async function noHorizontalOverflow(page, label) {
  const bounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(bounds.document <= bounds.viewport + 1 && bounds.body <= bounds.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(bounds)}`);
}

async function pauseAndCheckTime(page, useTouch = false) {
  const activate = (selector) => useTouch ? page.locator(selector).tap() : page.locator(selector).click();
  await activate('#game-pause');
  await visible(page, '#pause-panel');
  await page.waitForFunction(() => window.__airplanesDebug?.paused === true);
  const before = await page.evaluate(() => ({ elapsed: window.__airplanesDebug.state?.elapsed, pose: window.__airplanesDebug.pose }));
  await delay(650);
  const after = await page.evaluate(() => ({ elapsed: window.__airplanesDebug.state?.elapsed, pose: window.__airplanesDebug.pose }));
  if (before.elapsed !== undefined) assert.equal(after.elapsed, before.elapsed, 'Pause freezes combat simulation time');
  for (const field of ['x', 'y', 'z', 'yaw']) assert.equal(after.pose[field], before.pose[field], `Pause freezes the flight ${field}`);
}

async function leaveToHome(page, alreadyPaused = false, useTouch = false) {
  const activate = (selector) => useTouch ? page.locator(selector).tap() : page.locator(selector).click();
  if (!alreadyPaused) {
    await activate('#game-exit');
    await visible(page, '#pause-panel');
  }
  await activate('#leave-game');
  await visible(page, '#home-screen');
  await waitMode(page, 'home');
}

async function checkDesktop(url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'dark' });
  desktop = await context.newPage();
  monitor(desktop, 'desktop');
  await desktop.goto(url, { waitUntil: 'domcontentloaded' });
  await visible(desktop, '#home-screen');
  await waitMode(desktop, 'home');
  assert.equal(await desktop.locator('.version-card').count(), 2, 'Two game versions are available');
  assert.ok(await desktop.locator('#start-free').isVisible(), 'Original free-flight entry is visible');
  assert.ok(await desktop.locator('.battle-card a[href="#hangar"]').isVisible(), 'Combat hangar entry is visible');
  await noHorizontalOverflow(desktop, 'desktop home');
  await snapshot(desktop, 'home-desktop', true);
  report.checks.push('Desktop: version entrance contains original free flight and WWII combat.');

  await desktop.locator('#start-free').click();
  await waitGame(desktop, 'free');
  await verifyCanvas(desktop, 'free/top');
  await snapshot(desktop, 'free-desktop');
  for (const label of ['追尾', '座舱', '俯视']) {
    const transitionStart = await desktop.evaluate(() => window.__airplanesDebug.pose.time);
    await desktop.locator('#change-view').click();
    await desktop.waitForFunction((expected) => document.querySelector('#change-view')?.textContent.includes(expected), label);
    // A slow CI renderer clamps frame dt, so simulation seconds are more
    // reliable than wall-clock sleeps for the 1.4-second camera transition.
    await desktop.waitForFunction((start) => window.__airplanesDebug.pose.time >= start + 1.5, transitionStart);
    await verifyCanvas(desktop, `free/${label}`);
    if (label === '座舱') await snapshot(desktop, 'free-cockpit-desktop');
  }
  const originalTime = await desktop.locator('#change-time').textContent();
  await desktop.locator('#change-time').click();
  await desktop.waitForFunction((before) => document.querySelector('#change-time')?.textContent !== before, originalTime);
  await pauseAndCheckTime(desktop);
  await desktop.locator('#resume-game').click();
  await desktop.waitForFunction(() => window.__airplanesDebug?.paused === false);
  await leaveToHome(desktop);
  report.checks.push('Desktop: free flight renders all three views, changes time of day, pauses, resumes, and exits.');

  await desktop.locator('.battle-card a[href="#hangar"]').click();
  await visible(desktop, '#hangar-screen');
  await waitMode(desktop, 'hangar');
  const skinNames = new Set();
  for (const faction of ['raf', 'luftwaffe']) {
    await desktop.locator(`[data-faction="${faction}"]`).click();
    await desktop.waitForFunction((id) => document.querySelector(`[data-faction="${id}"]`)?.getAttribute('aria-pressed') === 'true', faction);
    assert.equal(await desktop.locator('#skin-options button').count(), 4, `${faction}: four liveries`);
    for (let i = 0; i < 4; i++) {
      const option = desktop.locator('#skin-options button').nth(i);
      skinNames.add((await option.textContent()).trim());
      await option.click();
      assert.equal(await option.getAttribute('aria-pressed'), 'true', `${faction}: livery ${i + 1} selected`);
    }
    assert.match(await desktop.locator('#aircraft-name').textContent(), faction === 'raf' ? /Spitfire|喷火/i : /Bf\s*109/i);
    await snapshot(desktop, `hangar-${faction}-desktop`, true);
  }
  assert.equal(skinNames.size, 8, 'Eight distinct liveries across both factions');
  await desktop.locator('[data-faction="raf"]').click();
  await desktop.locator('#skin-options button').first().click();
  await desktop.locator('[data-difficulty="rookie"]').click();
  await desktop.locator('#mission-options button').first().click();
  await noHorizontalOverflow(desktop, 'desktop hangar');
  report.checks.push('Desktop: both factions, distinct aircraft, and all eight liveries can be selected.');

  await desktop.locator('#start-combat').click();
  await waitGame(desktop, 'combat');
  await visible(desktop, '#combat-hud');
  await desktop.waitForFunction(() => {
    const state = window.__airplanesDebug?.state;
    return state?.player.health > 0 && state.enemies.length > 0;
  });
  assert.ok(Number.parseFloat(await desktop.locator('#health-label').textContent()) > 0, 'HUD displays player health');
  await verifyCanvas(desktop, 'combat/desktop');
  await desktop.locator('#game-canvas').click({ position: { x: 400, y: 450 } });
  const firingBefore = await desktop.evaluate(() => ({ shots: window.__airplanesDebug.state.player.shots, heat: window.__airplanesDebug.state.player.heat }));
  await desktop.keyboard.down('Space');
  try {
    await desktop.waitForFunction((before) => {
      const player = window.__airplanesDebug?.state?.player;
      return player && player.shots > before.shots && player.heat > before.heat;
    }, firingBefore, { timeout: 10000 });
  } finally { await desktop.keyboard.up('Space'); }
  await snapshot(desktop, 'combat-desktop');
  await desktop.waitForFunction(() => window.__airplanesDebug?.state?.elapsed >= 1.5);
  await pauseAndCheckTime(desktop);
  const previousElapsed = await desktop.evaluate(() => window.__airplanesDebug.state.elapsed);
  await desktop.locator('#restart-game').click();
  await waitGame(desktop, 'combat');
  const reset = await desktop.evaluate(() => window.__airplanesDebug.state);
  assert.ok(reset.elapsed < previousElapsed, 'Restart resets elapsed mission time');
  assert.equal(reset.player.kills, 0, 'Restart resets kills');
  assert.equal(reset.player.shots, 0, 'Restart clears firing input and shots');
  assert.equal(reset.player.heat, 0, 'Restart resets gun temperature');
  assert.equal(reset.player.health, reset.player.maxHealth, 'Restart restores full health');
  await leaveToHome(desktop);
  await desktop.locator('.battle-card a[href="#hangar"]').click();
  await waitMode(desktop, 'hangar');
  await visible(desktop, '#hangar-screen');
  report.checks.push('Desktop: live enemies and health, keyboard firing/heat, pause freeze, reset, and return to hangar.');
  await context.close();
  desktop = undefined;
}

async function touchHold(page, session, selector, action) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} has a touch target`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0, radiusX: 5, radiusY: 5, force: 1 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  try { await action(point); }
  finally { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

async function mobileInputDiagnostics(page) {
  return page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    touchEventAvailable: 'ontouchstart' in window,
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    anyPointerCoarse: matchMedia('(any-pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    controls: Object.fromEntries(['#touch-controls', '#joystick', '#touch-fire', '#touch-boost'].map(selector => {
      const el = document.querySelector(selector);
      if (!el) return [selector, { missing: true }];
      const css = getComputedStyle(el), rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return [selector, {
        hidden: el.hidden, display: css.display, visibility: css.visibility,
        opacity: css.opacity, pointerEvents: css.pointerEvents,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        receivesCentreHit: Boolean(hit && (hit === el || el.contains(hit))),
      }];
    })),
  }));
}

async function checkMobile(url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'zh-CN', colorScheme: 'dark' });
  mobile = await context.newPage();
  monitor(mobile, 'mobile');
  const session = await context.newCDPSession(mobile);
  // Chromium 151 CI can lose the context's hasTouch emulation after full-page
  // screenshots. Re-declare the actual emulated device through CDP; never mock
  // navigator or force the application's controls visible. The same session
  // dispatches the real touch events used by the joystick and fire checks.
  const enableTouchDevice = () => session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await enableTouchDevice();
  await mobile.goto(url, { waitUntil: 'domcontentloaded' });
  await waitMode(mobile, 'home');
  await noHorizontalOverflow(mobile, 'mobile home');
  await snapshot(mobile, 'home-mobile', true);
  await enableTouchDevice();
  await mobile.locator('.battle-card a[href="#hangar"]').tap();
  await waitMode(mobile, 'hangar');
  await mobile.locator('[data-faction="luftwaffe"]').tap();
  assert.equal(await mobile.locator('#skin-options button').count(), 4);
  await mobile.locator('#skin-options button').nth(2).tap();
  await noHorizontalOverflow(mobile, 'mobile hangar');
  await snapshot(mobile, 'hangar-mobile', true);
  await enableTouchDevice();
  await mobile.locator('#start-combat').tap();
  await waitGame(mobile, 'combat');
  report.mobileInput = await mobileInputDiagnostics(mobile);
  assert.ok(report.mobileInput.maxTouchPoints > 0, `Mobile context advertises touch input: ${JSON.stringify(report.mobileInput)}`);
  // Fail promptly with capability/CSS evidence instead of letting an obscured
  // control time out while the unpiloted aircraft is attacked by the AI.
  for (const selector of ['#touch-controls', '#joystick', '#touch-fire', '#touch-boost']) {
    assert.ok(await mobile.locator(selector).isVisible(), `Mobile control must be visible: ${selector}; ${JSON.stringify(report.mobileInput)}`);
  }
  for (const selector of ['#joystick', '#touch-fire', '#touch-boost']) {
    const box = await mobile.locator(selector).boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, `Mobile control has a usable touch target: ${selector}`);
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 391 && box.y + box.height <= 845, `Mobile control stays in viewport: ${selector}`);
    assert.ok(report.mobileInput.controls[selector].receivesCentreHit, `Mobile control must receive touches at its centre: ${selector}; ${JSON.stringify(report.mobileInput.controls[selector])}`);
  }
  await noHorizontalOverflow(mobile, 'mobile combat');
  await verifyCanvas(mobile, 'combat/mobile');
  const yawBefore = await mobile.evaluate(() => window.__airplanesDebug.pose.yaw);
  await touchHold(mobile, session, '#joystick', async (point) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 35 }] });
    await mobile.waitForFunction((before) => Math.abs(window.__airplanesDebug.pose.yaw - before) > 0.03, yawBefore, { timeout: 10000 });
  });
  const shotsBefore = await mobile.evaluate(() => window.__airplanesDebug.state.player.shots);
  await touchHold(mobile, session, '#touch-fire', async () => {
    await mobile.waitForFunction((before) => {
      const player = window.__airplanesDebug.state.player;
      return player.shots > before && player.heat > 0;
    }, shotsBefore, { timeout: 10000 });
  });
  await snapshot(mobile, 'combat-mobile');
  await pauseAndCheckTime(mobile, true);
  await mobile.locator('#resume-game').tap();
  await mobile.waitForFunction(() => !window.__airplanesDebug.paused);
  await leaveToHome(mobile, false, true);
  report.checks.push('Mobile: no horizontal overflow; touch joystick changes heading; touch fire raises shots/heat; pause/resume/exit work.');
  await session.detach();
  await context.close();
  mobile = undefined;
}

try {
  await mkdir(output, { recursive: true });
  const url = await startServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  await checkDesktop(url);
  await checkMobile(url);
  assert.equal(report.pageErrors.length, 0, `Unhandled browser errors: ${JSON.stringify(report.pageErrors)}`);
  report.ok = true;
  console.log(`Browser smoke passed (${report.checks.length} scenario groups). Screenshots: test-results/`);
} catch (error) {
  report.ok = false;
  report.error = { message: error.message, stack: error.stack };
  for (const [page, name] of [[desktop, 'failure-desktop'], [mobile, 'failure-mobile']]) {
    if (page && !page.isClosed()) {
      try { await snapshot(page, name, true); } catch { /* Preserve the original failure. */ }
    }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* Cleanup also runs after launch failures. */ }
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'close').catch(() => {});
    const forceStop = setTimeout(() => {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    }, 2000);
    forceStop.unref();
    server.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(forceStop); }
  }
  report.durationMs = Date.now() - started;
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'browser-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(output, 'server.log'), serverLog);
}
