import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat, MISSIONS, DIFFICULTIES, shortestOffset } from '../src/game/combat.js';
import { createScene, DEFAULT_PARAMS } from '../src/engine/scene.js';
import { getAircraftSpec } from '../src/game/aircraft-specs.js';
import { actorPointToWorld } from '../src/engine/actor-renderer.js';

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
  assert.ok(DIFFICULTIES.ace.damageScale > DIFFICULTIES.rookie.damageScale);
});

test('first contact starts ahead beyond the default viewport, deterministically as the opposing faction', () => {
  const pose = startPose();
  const a = createCombat({ faction: 'raf', seed: 11 });
  const b = createCombat({ faction: 'raf', seed: 11 });
  a.initialize(pose);
  b.step(0, pose);
  assert.deepEqual(a.state.enemies, b.state.enemies);
  assert.equal(a.state.enemies.length, 2);
  for (const enemy of a.state.enemies) {
    const distance = Math.hypot(enemy.x - pose.x, enemy.y - pose.y);
    assert.ok(distance >= 450 && distance <= 650);
    assert.ok(enemy.y < pose.y);
    assert.ok(Math.abs(enemy.z - pose.z) < 12);
    assert.equal(enemy.faction, 'luftwaffe');
    assert.equal(enemy.modelId, 'bf109');
    assert.equal(enemy.aiMode, 'ingress');
    assert.equal(enemy.enteredAt, null);
    assert.ok(170 + enemy.y - pose.y + enemy.viewRadius < 0, 'whole aircraft is outside the view');
  }
  const german = createCombat({ faction: 'luftwaffe' });
  german.initialize(pose);
  assert.equal(german.state.enemies[0].modelId, 'spitfire');
  assert.equal(german.state.enemies[0].faction, 'raf');
});

test('enemies are born fully offscreen and fly continuously through an edge in the real desktop and mobile cameras', () => {
  const params = {
    ...DEFAULT_PARAMS, speed: 92, boost: 1.45, agility: 1.55, altitude: 95,
    ceiling: 180, clearance: 7, bank: 40, spread: 1, jetScale: 0.8,
    cameraFollow: 0.8, view: 'top', clouds: 0.18, land: 0.33, seed: 7,
    afterburner: 0, flameStyle: 'pixel', trails: false, wingmen: 0,
    shadow: true, followPointer: false, invertY: false, stunts: false, intro: false,
  };
  for (const [width, height, faction, dt] of [
    [340, 233, 'raf', 1 / 60], [340, 233, 'luftwaffe', 0.05],
    [520, 340, 'raf', 1 / 60], [360, 200, 'raf', 1 / 60], [180, 320, 'luftwaffe', 1 / 60],
  ]) {
    const scene = createScene(params, { hidePlayer: true, manualControl: true });
    scene.resize(width, height);
    // Match app initialization exactly: no flight or camera prewarming step.
    scene.render();
    const combat = createCombat({ seed: 7, faction,
      getView: () => ({ width: scene.width, height: scene.height, project: scene.projectPoint }),
    });
    combat.initialize(scene.getFlightState());
    const appeared = new Set();
    let previous = new Map();
    for (const enemy of combat.state.enemies) {
      const p = scene.projectPoint(enemy.x, enemy.y, enemy.z), r = enemy.viewRadius * p.scale;
      assert.ok(p.x + r < 0 || p.x - r >= width || p.y + r < 0 || p.y - r >= height,
        `Born outside the viewport including geometry: ${JSON.stringify({ width, height, p, r })}`);
      assert.deepEqual(enemy.spawnProjection, {
        x: p.x, y: p.y, scale: p.scale, width, height, radius: enemy.viewRadius,
      });
      previous.set(enemy.id, { x: enemy.x, y: enemy.y, z: enemy.z, speed: enemy.speed });
    }
    for (let frame = 0; frame < Math.ceil(3 / dt); frame += 1) {
      scene.setKeys(0, 0, false);
      scene.step(dt);
      scene.render();
      combat.step(dt, scene.getFlightState());
      for (const enemy of combat.state.enemies) {
        const last = previous.get(enemy.id);
        const moved = Math.hypot(shortestOffset(enemy.x - last.x), shortestOffset(enemy.y - last.y), enemy.z - last.z);
        // A frame may end just after ingress decelerates to attack speed.
        const frameSpeed = Math.max(last.speed, enemy.speed);
        assert.ok(moved <= Math.hypot(frameSpeed, 26) * dt + 0.1, `Ingress never teleports: ${moved}`);
        const p = scene.projectPoint(enemy.x, enemy.y, enemy.z);
        const r = enemy.viewRadius * p.scale;
        if (combat.state.elapsed < 1) {
          assert.ok(p.x + r < 0 || p.x - r >= width || p.y + r < 0 || p.y - r >= height,
            `The whole plane remains offscreen during the first second, including the first app frame: ${JSON.stringify({ width, height, faction, time: combat.state.elapsed, p, r })}`);
          assert.equal(enemy.enteredAt, null);
        }
        if (p.visible && !appeared.has(enemy.id)) {
          assert.ok(combat.state.elapsed >= 1, 'Radar warning precedes visible entry by at least one second');
          const edgeDistance = Math.min(p.x, p.y, width - p.x, height - p.y);
          assert.ok(edgeDistance < 16, `First visible centre crosses a screen edge: ${JSON.stringify(p)}`);
          appeared.add(enemy.id);
        }
        previous.set(enemy.id, { x: enemy.x, y: enemy.y, z: enemy.z, speed: enemy.speed });
      }
    }
    assert.equal(appeared.size, 2, 'Both real aircraft enter within three seconds');
    assert.equal(combat.state.player.health, 100);
    assert.equal(combat.state.projectiles.length, 0);
    // A later wave uses the new viewport and player position instead of cached
    // dimensions or the initial heading.
    clearWave(combat, scene.getFlightState());
    scene.resize(height, width);
    for (let frame = 0; frame < 210 && combat.state.wave === 1; frame++) {
      scene.setKeys(0.25, 0, false); scene.step(1 / 60); scene.render();
      combat.step(1 / 60, scene.getFlightState());
    }
    assert.equal(combat.state.wave, 2);
    for (const enemy of combat.state.enemies) {
      const p = scene.projectPoint(enemy.x, enemy.y, enemy.z), r = enemy.viewRadius * p.scale;
      assert.ok(p.x + r < 0 || p.x - r >= scene.width || p.y + r < 0 || p.y - r >= scene.height,
        'Reinforcements also begin completely outside the resized, moving camera');
    }
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

test('each aircraft fires its complete real armament from the same rolled and pitched gun ports as the model', () => {
  const pose = { ...startPose(), yaw: 0.65, pitch: 0.18, roll: -0.4 };
  for (const faction of ['raf', 'luftwaffe']) {
    const spec = getAircraftSpec(faction === 'raf' ? 'spitfire' : 'bf109');
    const combat = createCombat({ faction });
    combat.initialize(pose);
    combat.state.enemies = [];
    for (let i = 0; i < 4; i++) combat.step(1 / 120, pose, { firing: true });
    const shots = combat.state.projectiles;
    assert.equal(shots.length, faction === 'raf' ? 8 : 4);
    assert.equal(new Set(shots.map(s => s.mountId)).size, spec.gunMounts.length);
    for (const shot of shots) {
      const mount = spec.gunMounts.find(m => m.id === shot.mountId);
      const origin = actorPointToWorld(pose, mount, spec.modelScale);
      assert.ok(Math.hypot(shot.originX - origin.x, shot.originY - origin.y, shot.originZ - origin.z) < 1e-9);
      assert.equal(shot.tracer, true, 'The first round at every gun port is visible');
      assert.equal(shot.kind, mount.kind);
      assert.equal(shot.calibreMm, mount.calibreMm);
    }
    assert.equal(shots.filter(s => s.kind === 'cannon').length, faction === 'raf' ? 0 : 2);
    assert.ok(combat.state.effects.some(e => e.type === 'muzzle' && e.mountId));
  }
});

test('independent barrel cadence produces periodic tracers and the 109 cannons fire more slowly than its nose guns', () => {
  const pose = startPose();
  for (const faction of ['raf', 'luftwaffe']) {
    const spec = getAircraftSpec(faction === 'raf' ? 'spitfire' : 'bf109');
    const combat = createCombat({ faction });
    combat.initialize(pose); combat.state.enemies = [];
    tick(combat, 1, pose, { firing: true });
    const shots = combat.state.projectiles;
    assert.equal(shots.length, combat.state.player.shots, 'Non-tracers stay in the physical simulation');
    assert.ok(shots.some(s => !s.tracer) && shots.some(s => s.tracer));
    assert.ok(shots.filter(s => s.tracer).length < shots.length / 2, 'A stream is not a solid laser line');
    for (const mount of spec.gunMounts) {
      const count = shots.filter(s => s.mountId === mount.id).length;
      assert.ok(Math.abs(count - mount.roundsPerMinute / 60) <= 1, `${mount.id}: ${count} rounds in one second`);
    }
    if (faction === 'luftwaffe') {
      assert.ok(combat.state.player.machineGunShots > combat.state.player.cannonShots * 1.6);
      const gun = shots.find(s => s.kind === 'machine-gun'), cannon = shots.find(s => s.kind === 'cannon');
      assert.ok(Math.hypot(gun.vx, gun.vy, gun.vz) > Math.hypot(cannon.vx, cannon.vy, cannon.vz));
      assert.ok(cannon.damage > gun.damage);
    }
  }
});

test('AI uses the opposing aircraft gun ports and mixed armament in short bursts', () => {
  const pose = startPose();
  for (const faction of ['raf', 'luftwaffe']) {
    const combat = createCombat({ faction }); combat.initialize(pose);
    const enemy = combat.state.enemies[0];
    Object.assign(enemy, { x: pose.x, y: pose.y + 350, z: pose.z, yaw: 0,
      enteredAt: 0, entryUntil: 0, age: 7, nextDecision: 100, fireCooldown: 0 });
    combat.state.enemies = [enemy]; combat.state.elapsed = 7;
    combat.step(0.05, pose);
    const spec = getAircraftSpec(enemy.modelId);
    const shots = combat.state.projectiles.filter(s => s.owner === enemy.id);
    assert.deepEqual(new Set(shots.map(s => s.mountId)), new Set(spec.gunMounts.map(m => m.id)));
    assert.ok(enemy.burstUntil < combat.state.elapsed + 0.6, 'AI fires bounded bursts rather than permanently holding the trigger');
  }
});

test('a fast bullet hits the traversed target instead of tunneling through', () => {
  const combat = createCombat();
  const pose = startPose();
  combat.initialize(pose);
  const target = combat.state.enemies[0];
  Object.assign(target, { x: 1000, y: 800, z: 110, health: 12, speed: 0, baseSpeed: 0 });
  combat.state.enemies = [target];
  combat.state.projectiles.push(makeShot({ x: 920, y: 800, vx: 3200, tracer: false }));
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

test('a bounded-turn pilot in either aircraft can complete a rookie patrol using actual guns and collisions', () => {
  for (const faction of ['raf', 'luftwaffe']) {
    const combat = createCombat({ faction, difficulty: 'rookie', seed: 7 });
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
      faction, health: combat.state.player.health, kills: combat.state.player.kills, elapsed: combat.state.elapsed,
    }));
    assert.equal(combat.state.player.kills, 6);
    assert.ok(combat.state.player.hits > 0);
    assert.ok(combat.state.player.hits <= combat.state.player.shots);
  }
});
