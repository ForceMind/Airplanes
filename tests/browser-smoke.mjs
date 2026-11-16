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
const report = {
  checks: [], screenshots: [], canvasSamples: [], aircraftSamples: [],
  flameSamples: [], ingressSamples: [], weaponSamples: [], boostSamples: [],
  pageErrors: [], consoleErrors: [], failedRequests: [],
};
const aircraftExpectations = {
  raf: { id: 'spitfire', variant: 'Spitfire Mk Ia', machineGuns: 8, cannons: 0, calibres: [7.7] },
  luftwaffe: { id: 'bf109', variant: 'Bf 109 E-4', machineGuns: 2, cannons: 2, calibres: [7.92, 20] },
};
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

async function verifyAircraft(page, faction, label) {
  const expected = aircraftExpectations[faction];
  const spec = await page.evaluate(() => window.__airplanesDebug.aircraftSpec);
  assert.equal(spec.id, expected.id, `${label}: the selected faction uses the correct airframe`);
  assert.equal(spec.variant, expected.variant, `${label}: exact historical variant`);
  assert.ok((await page.locator('#aircraft-name').textContent()).includes(expected.variant), `${label}: the hangar names the exact variant`);
  assert.equal(spec.gunMounts.length, expected.machineGuns + expected.cannons, `${label}: actual hardpoint count`);
  assert.equal(new Set(spec.gunMounts.map(mount => mount.id)).size, spec.gunMounts.length, `${label}: every gun has its own mount ID`);
  assert.equal(spec.gunMounts.filter(mount => mount.kind === 'machine-gun').length, expected.machineGuns, `${label}: machine-gun hardpoints`);
  assert.equal(spec.gunMounts.filter(mount => mount.kind === 'cannon').length, expected.cannons, `${label}: cannon hardpoints`);
  assert.deepEqual([...new Set(spec.gunMounts.map(mount => mount.calibreMm))].sort((a, b) => a - b), expected.calibres, `${label}: gun calibres`);
  for (const side of [-1, 1]) {
    assert.equal(spec.gunMounts.filter(mount => Math.sign(mount.x) === side).length, spec.gunMounts.length / 2, `${label}: guns are distributed across both sides`);
  }
  assert.equal(spec.propeller.bladeCount, 3, `${label}: three-blade propeller`);
  assert.match(await page.locator('#aircraft-propeller').textContent(), /3\s*叶/, `${label}: propeller specification is visible`);
  assert.equal((await page.locator('#aircraft-armament').textContent()).trim(), spec.armamentLabel, `${label}: visible armament matches the actual gun mounts`);
  assert.equal((await page.locator('#aircraft-span').textContent()).trim(), `${spec.dimensions.wingspanMetres.toFixed(2)} m`, `${label}: wingspan is displayed`);
  assert.equal((await page.locator('#aircraft-length').textContent()).trim(), `${spec.dimensions.lengthMetres.toFixed(2)} m`, `${label}: length is displayed`);
  report.aircraftSamples.push({ label, variant: spec.variant, dimensions: spec.dimensions, bladeCount: spec.propeller.bladeCount, gunMounts: spec.gunMounts });
  return spec;
}

async function verifyNoJetFlame(page, label, expectedMode = 'combat') {
  const sample = await page.evaluate(() => {
    const debug = window.__airplanesDebug;
    const canvas = document.querySelector('#flame-canvas');
    return { mode: debug.mode, elapsed: debug.state?.elapsed, flameCount: debug.flameCount, hidden: canvas.hidden, display: getComputedStyle(canvas).display };
  });
  report.flameSamples.push({ label, ...sample });
  assert.equal(sample.mode, expectedMode, `${label}: expected game mode`);
  assert.equal(sample.flameCount, 0, `${label}: no jet flames are emitted`);
  assert.equal(sample.hidden, true, `${label}: the old flame surface is hidden`);
  assert.equal(sample.display, 'none', `${label}: CSS cannot reveal a stale flame framebuffer`);
}

async function observeIngress(page, label) {
  const initial = await page.evaluate(() => {
    const state = window.__airplanesDebug.state;
    return { elapsed: state.elapsed, enemies: state.enemies.map(enemy => ({
      id: enemy.id, aiMode: enemy.aiMode, enteredAt: enemy.enteredAt,
      x: enemy.x, y: enemy.y, z: enemy.z, spawnProjection: enemy.spawnProjection,
    })) };
  });
  assert.ok(initial.enemies.length > 0, `${label}: a real mission wave exists`);
  for (const enemy of initial.enemies) {
    const projected = enemy.spawnProjection;
    assert.ok(projected && [projected.x, projected.y, projected.scale, projected.width, projected.height, projected.radius].every(Number.isFinite), `${label}/${enemy.id}: immutable birth projection is available`);
    assert.ok(projected.width > 0 && projected.height > 0 && projected.radius > 0 && projected.scale >= 0, `${label}/${enemy.id}: usable birth projection`);
    const radius = projected.radius * projected.scale;
    const outside = projected.scale === 0 || projected.x + radius < 0 || projected.y + radius < 0
      || projected.x - radius >= projected.width || projected.y - radius >= projected.height;
    assert.ok(outside, `${label}/${enemy.id}: the complete aircraft starts outside the actual viewport: ${JSON.stringify(projected)}`);
    assert.equal(enemy.aiMode, 'ingress', `${label}/${enemy.id}: enemies begin in the inbound flight phase`);
    assert.equal(enemy.enteredAt, null, `${label}/${enemy.id}: the first observation precedes visible entry`);
  }
  const ids = initial.enemies.map(enemy => enemy.id);
  // Wait on simulation time and observed entry, without moving an enemy or
  // advancing the game clock. Slow software rendering needs the full wall timeout.
  await page.waitForFunction(({ ids: expectedIds, start }) => {
    const state = window.__airplanesDebug?.state;
    return state && (expectedIds.every(id => Number.isFinite(state.enemies.find(enemy => enemy.id === id)?.enteredAt))
      || state.elapsed >= start + 10 || state.status !== 'playing');
  }, { ids, start: initial.elapsed }, { timeout: 60000 });
  const entered = await page.evaluate((expectedIds) => {
    const state = window.__airplanesDebug.state;
    return { elapsed: state.elapsed, enemies: state.enemies.filter(enemy => expectedIds.includes(enemy.id)).map(enemy => ({
      id: enemy.id, aiMode: enemy.aiMode, enteredAt: enemy.enteredAt, x: enemy.x, y: enemy.y, z: enemy.z,
    })) };
  }, ids);
  report.ingressSamples.push({ label, initial, entered });
  assert.equal(entered.enemies.length, ids.length, `${label}: the same enemy IDs remain through entry`);
  for (const enemy of entered.enemies) {
    const before = initial.enemies.find(item => item.id === enemy.id);
    assert.ok(Number.isFinite(enemy.enteredAt) && enemy.enteredAt > initial.elapsed && enemy.enteredAt <= entered.elapsed, `${label}/${enemy.id}: the same aircraft flies into view: ${JSON.stringify(enemy)}`);
    assert.ok(Math.hypot(enemy.x - before.x, enemy.y - before.y, enemy.z - before.z) > 1, `${label}/${enemy.id}: entry follows real movement`);
  }
}

async function collectWeaponEvidence(page, spec, before, label) {
  const expectedMounts = spec.gunMounts.map(({ id, kind, calibreMm }) => ({ id, kind, calibreMm }));
  const evidence = await page.evaluate(({ mounts, start }) => new Promise((resolveEvidence) => {
    // This observer only copies live projectiles. It never modifies debug data,
    // the simulation, inputs, enemy positions, or the application clock.
    const seen = new Map();
    let frame = 0, timer;
    const finish = (reason) => {
      cancelAnimationFrame(frame); clearTimeout(timer);
      const state = window.__airplanesDebug.state;
      resolveEvidence({ reason, elapsed: state.elapsed, player: { ...state.player }, projectiles: [...seen.values()] });
    };
    const sample = () => {
      const state = window.__airplanesDebug.state;
      for (const shot of state.projectiles) {
        if (shot.owner === 'player' && !seen.has(shot.id)) seen.set(shot.id, {
          id: shot.id, mountId: shot.mountId, kind: shot.kind, calibreMm: shot.calibreMm, tracer: shot.tracer,
          originX: shot.originX, originY: shot.originY, originZ: shot.originZ,
        });
      }
      const shots = [...seen.values()];
      const kinds = [...new Set(mounts.map(mount => mount.kind))];
      const complete = mounts.every(mount => shots.some(shot => shot.mountId === mount.id))
        && kinds.every(kind => shots.some(shot => shot.kind === kind && shot.tracer === true)
          && shots.some(shot => shot.kind === kind && shot.tracer === false));
      if (complete && state.elapsed >= start + .4) finish('complete');
      else if (state.elapsed >= start + 1.5 || state.status !== 'playing' || window.__airplanesDebug.paused) finish('simulation-limit');
      else frame = requestAnimationFrame(sample);
    };
    timer = setTimeout(() => finish('wall-timeout'), 45000);
    sample();
  }), { mounts: expectedMounts, start: before.elapsed });
  const byMount = expectedMounts.map(mount => {
    const shots = evidence.projectiles.filter(shot => shot.mountId === mount.id);
    return { ...mount, count: shots.length, tracer: shots.filter(shot => shot.tracer === true).length, nonTracer: shots.filter(shot => shot.tracer === false).length };
  });
  const summary = { label, aircraftId: spec.id, reason: evidence.reason, before, elapsed: evidence.elapsed, player: evidence.player, mounts: byMount, projectileSamples: evidence.projectiles.slice(0, 16) };
  report.weaponSamples.push(summary);
  assert.equal(evidence.reason, 'complete', `${label}: observe every barrel and intermittent tracers within real firing: ${JSON.stringify(summary)}`);
  assert.ok(evidence.player.shots > before.shots && evidence.player.heat > before.heat, `${label}: real firing raises shot count and heat`);
  for (const mount of expectedMounts) {
    const shots = evidence.projectiles.filter(shot => shot.mountId === mount.id);
    assert.ok(shots.length > 0, `${label}: live rounds originate from ${mount.id}`);
    assert.ok(shots.every(shot => shot.kind === mount.kind && shot.calibreMm === mount.calibreMm), `${label}/${mount.id}: rounds retain their own weapon type and calibre`);
    assert.ok(shots.every(shot => [shot.originX, shot.originY, shot.originZ].every(Number.isFinite)), `${label}/${mount.id}: real muzzle coordinates are recorded`);
  }
  assert.deepEqual([...new Set(evidence.projectiles.map(shot => shot.mountId))].sort(), expectedMounts.map(mount => mount.id).sort(), `${label}: all configured barrels fire, with no synthetic extra streams`);
  for (const kind of new Set(expectedMounts.map(mount => mount.kind))) {
    assert.ok(evidence.projectiles.some(shot => shot.kind === kind && shot.tracer === true), `${label}/${kind}: visible tracer rounds`);
    assert.ok(evidence.projectiles.some(shot => shot.kind === kind && shot.tracer === false), `${label}/${kind}: untraced rounds remain in the ballistics simulation`);
  }
  if (spec.id === 'bf109') {
    assert.ok(evidence.player.cannonShots > before.cannonShots, `${label}: real cannon fire`);
    assert.ok(evidence.player.machineGunShots - before.machineGunShots > evidence.player.cannonShots - before.cannonShots, `${label}: machine guns and cannons use distinct firing rates`);
  } else assert.equal(evidence.player.cannonShots, 0, `${label}: Mk Ia fires its eight machine guns`);
}

async function verifyBoostWithoutFlame(page, before, label) {
  await page.waitForFunction((start) => {
    const pose = window.__airplanesDebug.pose;
    return pose.time >= start.time + .35 && pose.speed > start.speed + 8;
  }, before, { timeout: 30000 });
  const after = await page.evaluate(() => window.__airplanesDebug.pose);
  report.boostSamples.push({ label, before, after });
  await verifyNoJetFlame(page, label);
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
  const freeFlame = await desktop.evaluate(() => ({ mode: window.__airplanesDebug.mode, flameCount: window.__airplanesDebug.flameCount, hidden: document.querySelector('#flame-canvas').hidden }));
  report.flameSamples.push({ label: 'desktop/free-before-combat', ...freeFlame });
  assert.equal(freeFlame.hidden, false, 'Original free flight keeps its jet-flame surface available');
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
  await verifyNoJetFlame(desktop, 'desktop/free-disposed', 'home');
  report.checks.push('Desktop: free flight renders all three views, changes time of day, pauses, resumes, and exits.');

  await desktop.locator('.battle-card a[href="#hangar"]').click();
  await visible(desktop, '#hangar-screen');
  await waitMode(desktop, 'hangar');
  const skinNames = new Set();
  let rafSpec;
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
    const spec = await verifyAircraft(desktop, faction, `desktop/${faction}`);
    if (faction === 'raf') rafSpec = spec;
    await desktop.locator('#toggle-hardpoints').click();
    assert.equal(await desktop.locator('#toggle-hardpoints').getAttribute('aria-pressed'), 'true', `${faction}: show gun positions is enabled`);
    assert.match(await desktop.locator('#toggle-hardpoints').textContent(), /隐藏枪位/);
    await visible(desktop, '#hardpoint-legend');
    await snapshot(desktop, `hangar-${faction}-desktop`, true);
    await desktop.locator('#toggle-hardpoints').click();
    assert.equal(await desktop.locator('#toggle-hardpoints').getAttribute('aria-pressed'), 'false', `${faction}: gun-position overlay can be hidden`);
    assert.match(await desktop.locator('#toggle-hardpoints').textContent(), /查看枪位/);
    assert.equal(await desktop.locator('#hardpoint-legend').isVisible(), false, `${faction}: gun-position legend is hidden`);
  }
  assert.equal(skinNames.size, 8, 'Eight distinct liveries across both factions');
  await desktop.locator('[data-faction="raf"]').click();
  await desktop.locator('#skin-options button').first().click();
  await desktop.locator('[data-difficulty="rookie"]').click();
  await desktop.locator('#mission-options button').first().click();
  await noHorizontalOverflow(desktop, 'desktop hangar');
  report.checks.push('Desktop: Spitfire Mk Ia and Bf 109 E-4, eight/four hardpoints, three-blade specifications, all eight liveries, and gun-position toggles.');

  await desktop.locator('#start-combat').click();
  await waitGame(desktop, 'combat');
  await observeIngress(desktop, 'desktop/RAF-wave');
  await verifyNoJetFlame(desktop, 'desktop/free-to-combat');
  await visible(desktop, '#combat-hud');
  await desktop.waitForFunction(() => {
    const state = window.__airplanesDebug?.state;
    return state?.player.health > 0 && state.enemies.length > 0;
  });
  assert.ok(Number.parseFloat(await desktop.locator('#health-label').textContent()) > 0, 'HUD displays player health');
  assert.equal((await desktop.locator('#weapon-hud').textContent()).trim(), rafSpec.armamentLabel, 'RAF combat HUD names the eight Brownings');
  assert.equal(await desktop.evaluate(() => window.__airplanesDebug.state.player.aircraftId), rafSpec.id, 'The selected RAF aircraft is used in combat');
  await verifyCanvas(desktop, 'combat/desktop');
  await desktop.locator('#game-canvas').click({ position: { x: 400, y: 450 } });
  const firingBefore = await desktop.evaluate(() => ({ elapsed: window.__airplanesDebug.state.elapsed, ...window.__airplanesDebug.state.player }));
  await desktop.keyboard.down('Space');
  try {
    await collectWeaponEvidence(desktop, rafSpec, firingBefore, 'desktop/RAF-keyboard-fire');
    await snapshot(desktop, 'combat-desktop');
  } finally { await desktop.keyboard.up('Space'); }
  const boostBefore = await desktop.evaluate(() => window.__airplanesDebug.pose);
  await desktop.keyboard.down('Shift');
  try { await verifyBoostWithoutFlame(desktop, boostBefore, 'desktop/RAF-keyboard-boost'); }
  finally { await desktop.keyboard.up('Shift'); }
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
  await verifyNoJetFlame(desktop, 'desktop/combat-restart');
  await leaveToHome(desktop);
  await desktop.locator('.battle-card a[href="#hangar"]').click();
  await waitMode(desktop, 'hangar');
  await visible(desktop, '#hangar-screen');
  report.checks.push('Desktop: offscreen enemies fly into view; all eight RAF guns fire traced/untraced rounds; free-to-combat and boost emit no jet flames; pause, reset, and return work.');
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
  const bf109Spec = await verifyAircraft(mobile, 'luftwaffe', 'mobile/luftwaffe');
  await mobile.locator('#toggle-hardpoints').tap();
  assert.equal(await mobile.locator('#toggle-hardpoints').getAttribute('aria-pressed'), 'true', 'Mobile gun-position toggle responds to touch');
  await visible(mobile, '#hardpoint-legend');
  await noHorizontalOverflow(mobile, 'mobile hangar');
  await snapshot(mobile, 'hangar-mobile', true);
  await enableTouchDevice();
  await mobile.locator('#toggle-hardpoints').tap();
  assert.equal(await mobile.locator('#toggle-hardpoints').getAttribute('aria-pressed'), 'false', 'Mobile gun-position overlay can be hidden');
  await mobile.locator('#start-combat').tap();
  await waitGame(mobile, 'combat');
  await observeIngress(mobile, 'mobile/Bf109-wave');
  await verifyNoJetFlame(mobile, 'mobile/combat-start');
  assert.equal((await mobile.locator('#weapon-hud').textContent()).trim(), bf109Spec.armamentLabel, 'Bf 109 combat HUD names both MG 17 and MG FF/M');
  assert.equal(await mobile.evaluate(() => window.__airplanesDebug.state.player.aircraftId), bf109Spec.id, 'The selected Bf 109 is used in combat');
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
  const firingBefore = await mobile.evaluate(() => ({ elapsed: window.__airplanesDebug.state.elapsed, ...window.__airplanesDebug.state.player }));
  await touchHold(mobile, session, '#touch-fire', async () => {
    await collectWeaponEvidence(mobile, bf109Spec, firingBefore, 'mobile/Bf109-touch-fire');
    await snapshot(mobile, 'combat-mobile');
  });
  const boostBefore = await mobile.evaluate(() => window.__airplanesDebug.pose);
  await touchHold(mobile, session, '#touch-boost', async () => {
    await verifyBoostWithoutFlame(mobile, boostBefore, 'mobile/Bf109-touch-boost');
  });
  await pauseAndCheckTime(mobile, true);
  await mobile.locator('#resume-game').tap();
  await mobile.waitForFunction(() => !window.__airplanesDebug.paused);
  await leaveToHome(mobile, false, true);
  report.checks.push('Mobile: no overflow; gun-position toggle and joystick work; Bf 109 touch fire uses all four MG/cannon mounts with intermittent tracers and distinct rates; boost has no jet flame; pause/resume/exit work.');
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
