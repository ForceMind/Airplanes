import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, MISSIONS, DIFFICULTIES, shortestOffset } from '../src/game/combat.js';
import { createScene, DEFAULT_PARAMS } from '../src/engine/scene.js';

const startPose = () => ({ x: 1000, y: 1000, z: 110, yaw: 0, pitch: 0, roll: 0, speed: 92 });

function tick(combat, seconds, pose = startPose(), input = {}) {
  for (let t = 0; t < seconds - 1e-8; t += 0.05) combat.step(Math.min(0.05, seconds - t), pose, input);
}

function makeShot(overrides = {}) {
  return {
    id: 'test-shot', owner: 'player', faction: 'raf',
    x: 1000, y: 800, z: 110, prevX: 1000, prevY: 800, prevZ: 110,
    vx: 0, vy: 0, vz: 0, damage: 100, ttl: 1, radius: 1.3,
    ...overrides,
  };
}

function clearWave(combat, pose) {
  combat.state.projectiles.push(...combat.state.enemies.map((enemy, i) => makeShot({
    id: `clear-${i}`, x: enemy.x, y: enemy.y, z: enemy.z,
    faction: combat.state.faction,
  })));
  combat.step(1 / 120, pose);
}

test('all mission and difficulty choices are real configurations', () => {
  assert.deepEqual(Object.keys(MISSIONS), ['channel', 'intercept', 'survival']);
  assert.equal(MISSIONS.channel.targetKills, 6);
  assert.equal(MISSIONS.intercept.waves.reduce((a, b) => a + b, 0), 8);
  assert.equal(MISSIONS.survival.duration, 180);
  assert.ok(DIFFICULTIES.ace.damage > DIFFICULTIES.rookie.damage);
});

test('first contact is ahead, near the player, deterministic, and the opposing faction', () => {
  const pose = startPose();
  const a = createCombat({ faction: 'raf', seed: 11 });
  const b = createCombat({ faction: 'raf', seed: 11 });
  a.initialize(pose);
  b.step(0, pose);
  assert.deepEqual(a.state.enemies, b.state.enemies);
  assert.equal(a.state.enemies.length, 2);
  for (const enemy of a.state.enemies) {
    const distance = Math.hypot(enemy.x - pose.x, enemy.y - pose.y);
    assert.ok(distance >= 80 && distance <= 125);
    assert.ok(enemy.y < pose.y);
    assert.ok(Math.abs(enemy.z - pose.z) < 12);
    assert.equal(enemy.faction, 'luftwaffe');
    assert.equal(enemy.modelId, 'bf109');
  }
  const german = createCombat({ faction: 'luftwaffe' });
  german.initialize(pose);
  assert.equal(german.state.enemies[0].modelId, 'spitfire');
  assert.equal(german.state.enemies[0].faction, 'raf');
});

test('initial enemies enter the real overhead viewport within two seconds on desktop and mobile', () => {
  const params = {
    ...DEFAULT_PARAMS, speed: 92, boost: 1.45, agility: 1.55, altitude: 95,
    ceiling: 180, clearance: 7, bank: 40, spread: 1, jetScale: 0.8,
    cameraFollow: 0.8, view: 'top', clouds: 0.18, land: 0.33, seed: 7,
    afterburner: 0, flameStyle: 'pixel', trails: false, wingmen: 0,
    shadow: true, followPointer: false, invertY: false, stunts: false, intro: false,
  };
  for (const [width, height] of [[520, 340], [360, 200], [180, 320]]) {
    const scene = createScene(params, { hidePlayer: true, manualControl: true });
    scene.resize(width, height);
    const combat = createCombat({ seed: 7 });
    combat.initialize(scene.getFlightState());
    for (let frame = 0; frame < 120; frame += 1) {
      scene.setKeys(0, 0, false);
      scene.step(1 / 60);
      combat.step(1 / 60, scene.getFlightState());
    }
    scene.render();
    for (const enemy of combat.state.enemies) {
      const point = scene.projectPoint(enemy.x, enemy.y, enemy.z);
      assert.ok(point.visible && point.x > 15 && point.x < width - 15 && point.y > 15 && point.y < height - 15,
        JSON.stringify({ width, height, point }));
    }
    assert.equal(combat.state.player.health, 100);
    assert.equal(combat.state.projectiles.length, 0);
  }
});

test('the player gun overheats, stops spending shots, cools, and fires again', () => {
  const combat = createCombat();
  const pose = startPose();
  for (let i = 0; i < 90 && !combat.state.player.overheated; i += 1) combat.step(0.05, pose, { firing: true });
  assert.equal(combat.state.player.overheated, true);
  assert.ok(combat.state.player.heat > 0.95);
  const shots = combat.state.player.shots;
  tick(combat, 0.5, pose, { firing: true });
  assert.equal(combat.state.player.shots, shots);
  tick(combat, 2.2, pose, { firing: false });
  assert.equal(combat.state.player.overheated, false);
  assert.ok(combat.state.player.heat <= 0.28);
  combat.step(0.05, pose, { firing: true });
  assert.ok(combat.state.player.shots > shots);
});

test('a fast bullet hits the traversed target instead of tunneling through', () => {
  const combat = createCombat();
  const pose = startPose();
  combat.initialize(pose);
  const target = combat.state.enemies[0];
  Object.assign(target, { x: 1000, y: 800, z: 110, health: 12, speed: 0, baseSpeed: 0 });
  combat.state.enemies = [target];
  combat.state.projectiles.push(makeShot({ x: 920, y: 800, vx: 3200 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.player.kills, 1);
  assert.equal(combat.state.player.hits, 1);
  assert.equal(combat.state.enemies.length, 0);
  assert.ok(combat.state.effects.some((effect) => effect.type === 'explosion'));
});

test('shots and targets remain collidable across the repeating map seam', () => {
  const combat = createCombat();
  const pose = { ...startPose(), x: 2040 };
  combat.initialize(pose);
  const target = combat.state.enemies[0];
  Object.assign(target, { x: 2, y: 800, z: 110, health: 12, speed: 0, baseSpeed: 0 });
  combat.state.enemies = [target];
  combat.state.projectiles.push(makeShot({ x: 2030, y: 800, vx: 700 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.player.kills, 1);
  assert.equal(shortestOffset(2 - 2040), 10);
  assert.equal(shortestOffset(2040 - 2), -10);
});

test('initial spawn immunity expires and friendly projectiles do not damage the player', () => {
  const combat = createCombat();
  const pose = startPose();
  combat.initialize(pose);
  combat.state.projectiles.push(makeShot({ owner: 'enemy-test', faction: 'luftwaffe', x: pose.x, y: pose.y, damage: 6 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.player.health, 100);
  assert.equal(combat.state.projectiles.length, 0);
  tick(combat, 3.1, pose);
  combat.state.projectiles.push(makeShot({ owner: 'enemy-test', faction: 'raf', x: pose.x, y: pose.y, damage: 50 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.player.health, 100);
  combat.state.projectiles.push(makeShot({ owner: 'enemy-test', faction: 'luftwaffe', x: pose.x, y: pose.y, damage: 6 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.player.health, 94);
});

test('AI turns and fires from its aircraft, with a reaction window before attacks', () => {
  const combat = createCombat({ difficulty: 'ace' });
  const pose = startPose();
  combat.initialize(pose);
  tick(combat, 5.5, pose);
  assert.equal(combat.state.projectiles.some((shot) => shot.owner !== 'player'), false);
  let enemyFired = false;
  for (let i = 0; i < 300 && combat.state.status === 'playing'; i += 1) {
    combat.step(0.05, pose);
    enemyFired ||= combat.state.events.some((event) => event.type === 'enemy-fire');
  }
  assert.ok(enemyFired);
  assert.ok(combat.state.enemies.some((enemy) => Math.abs(enemy.yaw) > 0.2));
});

test('a distant pursuer closes into gun range instead of hovering beyond it', () => {
  const combat = createCombat({ difficulty: 'rookie' });
  const pose = startPose();
  combat.initialize(pose);
  const enemy = combat.state.enemies[0];
  Object.assign(enemy, { x: pose.x, y: pose.y + 800, z: pose.z, yaw: 0, entryUntil: 0 });
  combat.state.enemies = [enemy];
  let fired = false;
  for (let i = 0; i < 40 * 20 && combat.state.status === 'playing'; i += 1) {
    pose.y -= pose.speed * 0.05;
    combat.step(0.05, pose);
    fired ||= combat.state.events.some((event) => event.type === 'enemy-fire');
  }
  assert.ok(fired);
});

test('all patrol waves spawn, six kills win, and a completed mission cannot keep scoring', () => {
  const combat = createCombat();
  const pose = startPose();
  combat.initialize(pose);
  for (let wave = 1; wave <= 3; wave += 1) {
    assert.equal(combat.state.wave, wave);
    clearWave(combat, pose);
    if (wave < 3) {
      assert.equal(combat.state.status, 'playing');
      assert.ok(combat.state.waveCountdown > 0);
      tick(combat, 3.1, pose);
    }
  }
  assert.equal(combat.state.player.kills, 6);
  assert.equal(combat.state.status, 'won');
  const result = { score: combat.state.score, elapsed: combat.state.elapsed, shots: combat.state.player.shots };
  tick(combat, 2, pose, { firing: true });
  assert.deepEqual({ score: combat.state.score, elapsed: combat.state.elapsed, shots: combat.state.player.shots }, result);
});

test('lethal incoming fire ends the sortie and reset creates a clean deterministic replay', () => {
  const combat = createCombat({ seed: 29 });
  const pose = startPose();
  combat.initialize(pose);
  const originalEnemies = structuredClone(combat.state.enemies);
  tick(combat, 3.1, pose);
  combat.state.projectiles.push(makeShot({ owner: 'enemy-test', faction: 'luftwaffe', x: pose.x, y: pose.y, damage: 100 }));
  combat.step(0.05, pose);
  assert.equal(combat.state.status, 'lost');
  assert.equal(combat.state.player.health, 0);
  const sameState = combat.state;
  combat.reset(pose);
  assert.equal(combat.state, sameState);
  assert.equal(combat.state.status, 'playing');
  assert.equal(combat.state.player.health, 100);
  assert.deepEqual(combat.state.enemies, originalEnemies);
  assert.equal(combat.state.projectiles.length, 0);
});

test('survival ends at three minutes, not at a kill quota', () => {
  const combat = createCombat({ mission: 'survival' });
  const pose = startPose();
  combat.initialize(pose);
  combat.state.player.kills = 20;
  combat.step(0.05, pose);
  assert.equal(combat.state.status, 'playing');
  for (let i = 0; i < 1801 && combat.state.status === 'playing'; i += 1) {
    // Keep the area clear here to isolate the timed mission from damage tests.
    combat.state.enemies = [];
    combat.state.projectiles = [];
    combat.step(0.1, pose);
  }
  assert.equal(combat.state.status, 'won');
  assert.ok(combat.state.elapsed >= 180 && combat.state.elapsed < 180.02);
  assert.ok(combat.state.wave > 3);
});

test('invalid timing cannot create negative time or non-finite state', () => {
  const combat = createCombat({ mission: 'unknown', difficulty: 'unknown' });
  const pose = startPose();
  for (const delta of [NaN, Infinity, -1, undefined]) combat.step(delta, pose);
  assert.equal(combat.state.elapsed, 0);
  assert.equal(combat.state.mission, 'channel');
  combat.step(10, pose);
  assert.ok(combat.state.elapsed <= 0.10001);
  for (const enemy of combat.state.enemies) assert.ok(Number.isFinite(enemy.x + enemy.y + enemy.z));
});

test('a bounded-turn pilot can complete a rookie patrol using the actual guns and collisions', () => {
  const combat = createCombat({ difficulty: 'rookie', seed: 7 });
  const pose = startPose();
  combat.initialize(pose);
  const dt = 1 / 60;
  for (let i = 0; i < 120 * 60 && combat.state.status === 'playing'; i += 1) {
    const target = combat.state.enemies[0];
    if (target) {
      const desired = Math.atan2(shortestOffset(target.x - pose.x), -shortestOffset(target.y - pose.y));
      const angle = Math.atan2(Math.sin(desired - pose.yaw), Math.cos(desired - pose.yaw));
      pose.yaw += Math.max(-1.25 * dt, Math.min(1.25 * dt, angle));
    }
    pose.x += Math.sin(pose.yaw) * pose.speed * dt;
    pose.y -= Math.cos(pose.yaw) * pose.speed * dt;
    combat.step(dt, pose, { firing: true });
  }
  assert.equal(combat.state.status, 'won', JSON.stringify({
    health: combat.state.player.health, kills: combat.state.player.kills, elapsed: combat.state.elapsed,
  }));
  assert.equal(combat.state.player.kills, 6);
  assert.ok(combat.state.player.hits > 0);
  assert.ok(combat.state.player.hits <= combat.state.player.shots);
});
