/**
 * Airplanes — original, deterministic arcade combat rules.
 * Rendering and player flight remain the responsibility of the flight engine.
 * World axes: x east, y south, z up; yaw 0 faces north (-y).
 */

export const WORLD_SIZE = 2048;

export const MISSIONS = Object.freeze({
  channel: Object.freeze({
    id: 'channel', title: '海峡巡逻', label: '海峡巡逻',
    description: '迎击三波敌机，取得 6 次击落。',
    targetKills: 6, duration: 0, waves: Object.freeze([2, 2, 2]),
  }),
  intercept: Object.freeze({
    id: 'intercept', title: '自由猎杀', label: '自由猎杀',
    description: '在海峡上空迎击逐渐增援的战斗机，取得 8 次击落。',
    targetKills: 8, duration: 0, waves: Object.freeze([2, 3, 3]),
  }),
  survival: Object.freeze({
    id: 'survival', title: '守住长空', label: '守住长空',
    description: '坚持飞行 3 分钟，躲避追击并尽可能击落敌机。',
    targetKills: 0, duration: 180, waves: Object.freeze([]),
  }),
});

export const DIFFICULTIES = Object.freeze({
  rookie: Object.freeze({
    id: 'rookie', title: '新兵', label: '新兵',
    enemyHealth: 60, enemySpeed: 82, turnRate: 0.88,
    shotInterval: 0.42, damage: 6, spread: 0.036,
    fireRange: 520, aimCone: 0.19, assistCone: 0.19,
    reinforcementLimit: 4,
  }),
  ace: Object.freeze({
    id: 'ace', title: '王牌', label: '王牌',
    enemyHealth: 84, enemySpeed: 95, turnRate: 1.18,
    shotInterval: 0.32, damage: 8, spread: 0.018,
    fireRange: 620, aimCone: 0.21, assistCone: 0.12,
    reinforcementLimit: 5,
  }),
});

const TAU = Math.PI * 2;
const PLAYER_HEALTH = 100;
const PLAYER_RADIUS = 10;
const GUN_INTERVAL = 0.12;
const SHOT_SPEED = 640;
const SHOT_DAMAGE = 12;
const MAX_STEP = 1 / 120;
const MAX_FRAME = 0.1;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** The nearest periodic image; the renderer still receives continuous coordinates. */
export function shortestOffset(delta) {
  return ((delta + WORLD_SIZE / 2) % WORLD_SIZE + WORLD_SIZE) % WORLD_SIZE - WORLD_SIZE / 2;
}

function rngFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poseOf(p = {}) {
  return {
    x: finite(p.x, 0), y: finite(p.y, 0), z: finite(p.z, 110),
    yaw: finite(p.yaw, 0), pitch: finite(p.pitch, 0), roll: finite(p.roll, 0),
    speed: clamp(finite(p.speed, 92), 0, 400),
  };
}

function interpolatePose(a, b, t) {
  return {
    x: a.x + shortestOffset(b.x - a.x) * t,
    y: a.y + shortestOffset(b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    roll: a.roll + (b.roll - a.roll) * t,
    speed: a.speed + (b.speed - a.speed) * t,
  };
}

/** Segment/sphere collision: fast bullets cannot skip a target between frames. */
function segmentHit(a, b, target, radius) {
  const tx = a.x + shortestOffset(target.x - a.x);
  const ty = a.y + shortestOffset(target.y - a.y);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const t = lengthSquared > 0
    ? clamp(((tx - a.x) * dx + (ty - a.y) * dy + (target.z - a.z) * dz) / lengthSquared, 0, 1)
    : 0;
  const x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
  const ex = tx - x, ey = ty - y, ez = target.z - z;
  return ex * ex + ey * ey + ez * ez <= radius * radius ? { t, x, y, z } : null;
}

function distanceBetween(a, b) {
  return Math.hypot(shortestOffset(a.x - b.x), shortestOffset(a.y - b.y), a.z - b.z);
}

export function createCombat(options = {}) {
  const faction = options.faction === 'luftwaffe' ? 'luftwaffe' : 'raf';
  const enemyFaction = faction === 'raf' ? 'luftwaffe' : 'raf';
  const missionId = Object.hasOwn(MISSIONS, options.mission) ? options.mission : 'channel';
  const difficultyId = Object.hasOwn(DIFFICULTIES, options.difficulty) ? options.difficulty : 'rookie';
  const mission = MISSIONS[missionId];
  const difficulty = DIFFICULTIES[difficultyId];
  const seed = finite(options.seed, 7) >>> 0;
  const state = {};
  let random, serial, initialized, previousPose, playerCooldown, ramCooldown, waveStartedAt;

  function emit(type, details = {}) {
    state.events.push({ type, time: state.elapsed, ...details });
  }

  function effect(type, at, radius = 9, life = 0.4) {
    state.effects.push({
      id: `fx-${++serial}`, type, x: at.x, y: at.y, z: at.z,
      age: 0, life, ttl: life, radius, seed: random(),
    });
  }

  function reset(pose) {
    random = rngFrom(seed);
    serial = 0;
    initialized = false;
    previousPose = null;
    playerCooldown = 0;
    ramCooldown = 0;
    waveStartedAt = 0;
    Object.assign(state, {
      faction, difficulty: difficultyId, mission: missionId,
      status: 'playing', elapsed: 0, wave: 0,
      waveTotal: mission.waves.length, waveCountdown: 0,
      targetKills: mission.targetKills, duration: mission.duration,
      score: 0, enemies: [], projectiles: [], effects: [], events: [],
      player: {
        health: PLAYER_HEALTH, maxHealth: PLAYER_HEALTH,
        kills: 0, shots: 0, hits: 0, heat: 0, overheated: false,
        invulnerable: true, invulnerableUntil: 3, lastHitAt: -1,
      },
    });
    if (pose) initialize(pose);
    return state;
  }

  function spawnWave(pose) {
    state.wave += 1;
    state.waveCountdown = 0;
    waveStartedAt = state.elapsed;
    const requested = mission.duration
      ? Math.min(difficulty.reinforcementLimit, 1 + state.wave)
      : mission.waves[state.wave - 1];
    const count = mission.duration
      ? Math.max(0, requested - state.enemies.length)
      : requested || 0;
    const fx = Math.sin(pose.yaw), fy = -Math.cos(pose.yaw);
    const rx = Math.cos(pose.yaw), ry = Math.sin(pose.yaw);
    for (let i = 0; i < count; i += 1) {
      // The overhead renderer maps roughly one world unit to one logical pixel.
      // Keep the first contact close enough to enter a 200px-tall landscape
      // viewport promptly, rather than announcing opponents beyond the screen.
      const ahead = (state.wave === 1 ? 88 : 96) + i * 14 + random() * 8;
      const across = (i - (count - 1) / 2) * 34 + (random() - 0.5) * 12;
      const speed = difficulty.enemySpeed * (0.94 + random() * 0.12);
      state.enemies.push({
        id: `enemy-${++serial}`, faction: enemyFaction,
        modelId: enemyFaction === 'raf' ? 'spitfire' : 'bf109',
        x: pose.x + fx * ahead + rx * across,
        y: pose.y + fy * ahead + ry * across,
        z: clamp(pose.z + (random() - 0.5) * 12, 50, 320),
        yaw: pose.yaw + (random() - 0.5) * 0.08,
        pitch: 0, roll: 0, speed, baseSpeed: speed,
        health: difficulty.enemyHealth, maxHealth: difficulty.enemyHealth,
        radius: 11, aiMode: 'approach', age: 0,
        fireCooldown: 0.5 + random() * 0.7,
        entryUntil: state.elapsed + 3.5 + i * 0.35,
        breakUntil: 0, nextDecision: state.elapsed + 4 + random(),
        evadeSign: random() < 0.5 ? -1 : 1,
        lastHitAt: -10, altitudeOffset: (random() - 0.5) * 10,
      });
    }
    emit('wave', { wave: state.wave, count });
  }

  function initialize(pose) {
    if (initialized) return state;
    previousPose = poseOf(pose);
    initialized = true;
    spawnWave(previousPose);
    return state;
  }

  function projectile(owner, shotFaction, origin, target, speed, damage, ttl) {
    const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    state.projectiles.push({
      id: `shot-${++serial}`, owner, faction: shotFaction,
      x: origin.x, y: origin.y, z: origin.z,
      prevX: origin.x, prevY: origin.y, prevZ: origin.z,
      vx: dx / length * speed, vy: dy / length * speed, vz: dz / length * speed,
      ttl, age: 0, damage, radius: 1.3,
    });
  }

  function playerAim(pose) {
    const cp = Math.cos(pose.pitch);
    let point = {
      x: pose.x + Math.sin(pose.yaw) * cp * 600,
      y: pose.y - Math.cos(pose.yaw) * cp * 600,
      z: pose.z + Math.sin(pose.pitch) * 600,
    };
    let best = Infinity;
    for (const enemy of state.enemies) {
      if (enemy.health <= 0) continue;
      const dx = shortestOffset(enemy.x - pose.x), dy = shortestOffset(enemy.y - pose.y);
      const horizontal = Math.hypot(dx, dy);
      const error = Math.abs(wrapAngle(Math.atan2(dx, -dy) - pose.yaw));
      const pitchError = Math.abs(Math.atan2(enemy.z - pose.z, horizontal) - pose.pitch);
      // Gentle convergence within the nose cone, never a lock through a wide turn.
      if (horizontal < 620 && horizontal > 18 && error < difficulty.assistCone && pitchError < 0.25) {
        const rank = error * 600 + horizontal * 0.1;
        if (rank < best) {
          best = rank;
          const lead = horizontal / (SHOT_SPEED + pose.speed);
          point = {
            x: pose.x + dx + Math.sin(enemy.yaw) * enemy.speed * lead,
            y: pose.y + dy - Math.cos(enemy.yaw) * enemy.speed * lead,
            z: enemy.z + Math.sin(enemy.pitch) * enemy.speed * lead,
          };
        }
      }
    }
    return point;
  }

  function updatePlayerGun(dt, pose, firing) {
    const player = state.player;
    playerCooldown = Math.max(0, playerCooldown - dt);
    if (!firing || player.overheated) player.heat = Math.max(0, player.heat - dt * 0.29);
    if (player.overheated && player.heat <= 0.28) {
      player.overheated = false;
      emit('gun-ready');
    }
    if (!firing || player.overheated || playerCooldown > 0) return;
    const target = playerAim(pose);
    const fx = Math.sin(pose.yaw), fy = -Math.cos(pose.yaw);
    const rx = Math.cos(pose.yaw), ry = Math.sin(pose.yaw);
    for (const side of [-1, 1]) {
      const origin = { x: pose.x + fx * 14 + rx * side * 3.4,
        y: pose.y + fy * 14 + ry * side * 3.4, z: pose.z + 0.5 };
      projectile('player', faction, origin, target, SHOT_SPEED + pose.speed, SHOT_DAMAGE, 1.35);
    }
    player.shots += 2;
    player.heat = Math.min(1, player.heat + 0.047);
    playerCooldown = GUN_INTERVAL;
    emit('player-fire', { x: pose.x, y: pose.y, z: pose.z });
    if (player.heat >= 1) {
      player.overheated = true;
      emit('overheat');
    }
  }

  function updateEnemy(enemy, dt, pose) {
    enemy.age += dt;
    // Keep actors in the player's nearest world image, also after several map laps.
    enemy.x = pose.x + shortestOffset(enemy.x - pose.x);
    enemy.y = pose.y + shortestOffset(enemy.y - pose.y);
    const dx = pose.x - enemy.x, dy = pose.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (state.elapsed > enemy.entryUntil && state.elapsed >= enemy.nextDecision) {
      enemy.nextDecision = state.elapsed + 0.8 + random() * 0.5;
      const threatened = state.elapsed - enemy.lastHitAt < 1.1;
      if (distance < 85 || threatened) {
        enemy.breakUntil = state.elapsed + 1.1 + random() * 0.8;
        enemy.evadeSign = random() < 0.5 ? -1 : 1;
      }
    }
    let desiredYaw;
    if (state.elapsed < enemy.entryUntil) {
      enemy.aiMode = 'approach';
      desiredYaw = enemy.yaw;
    } else if (state.elapsed < enemy.breakUntil) {
      enemy.aiMode = 'evade';
      desiredYaw = Math.atan2(dx, -dy) + enemy.evadeSign * 1.45;
    } else {
      enemy.aiMode = 'attack';
      const lead = clamp(distance / 550, 0, 0.6);
      desiredYaw = Math.atan2(dx + Math.sin(pose.yaw) * pose.speed * lead,
        -(dy - Math.cos(pose.yaw) * pose.speed * lead));
    }
    const turn = clamp(wrapAngle(desiredYaw - enemy.yaw), -difficulty.turnRate * dt, difficulty.turnRate * dt);
    enemy.yaw = wrapAngle(enemy.yaw + turn);
    const bank = -turn / Math.max(dt, 0.001) * 0.55;
    enemy.roll += (bank - enemy.roll) * Math.min(1, dt * 4);
    const desiredZ = clamp(pose.z + enemy.altitudeOffset + (enemy.aiMode === 'evade' ? 8 : 0), 50, 320);
    const climb = clamp((desiredZ - enemy.z) * 0.8, -26, 26);
    enemy.z += climb * dt;
    enemy.pitch = Math.atan2(climb, enemy.speed);
    // Close all the way into gun range. Boosting only beyond the render horizon
    // would strand a slower pursuer at that threshold forever.
    const catchUp = enemy.aiMode === 'approach' ? 1 : distance > 350 ? 1.35 : distance > 200 ? 1.16 : 1;
    enemy.speed = enemy.baseSpeed * Math.max(catchUp, enemy.aiMode === 'evade' ? 1.08 : 1);
    enemy.x += Math.sin(enemy.yaw) * enemy.speed * dt;
    enemy.y -= Math.cos(enemy.yaw) * enemy.speed * dt;
    enemy.fireCooldown = Math.max(0, enemy.fireCooldown - dt);
    const bearing = Math.atan2(pose.x - enemy.x, -(pose.y - enemy.y));
    const facing = Math.abs(wrapAngle(bearing - enemy.yaw));
    if (state.elapsed < 6 || enemy.age < 2 || enemy.aiMode !== 'attack' || enemy.fireCooldown > 0
      || distance < 60 || distance > difficulty.fireRange || facing > difficulty.aimCone) return;
    const bulletSpeed = 520 + enemy.speed;
    const leadTime = distance / bulletSpeed;
    const spread = difficulty.spread * distance;
    const target = {
      x: pose.x + Math.sin(pose.yaw) * pose.speed * leadTime + (random() - 0.5) * spread * 2,
      y: pose.y - Math.cos(pose.yaw) * pose.speed * leadTime + (random() - 0.5) * spread * 2,
      z: pose.z + Math.sin(pose.pitch) * pose.speed * leadTime + (random() - 0.5) * spread,
    };
    projectile(enemy.id, enemy.faction, {
      x: enemy.x + Math.sin(enemy.yaw) * 14,
      y: enemy.y - Math.cos(enemy.yaw) * 14,
      z: enemy.z,
    }, target, bulletSpeed, difficulty.damage, 1.2);
    enemy.fireCooldown = difficulty.shotInterval * (0.85 + random() * 0.4);
    emit('enemy-fire', { enemyId: enemy.id, x: enemy.x, y: enemy.y, z: enemy.z });
  }

  function destroyEnemy(enemy) {
    state.player.kills += 1;
    state.score += 200 + state.wave * 20;
    effect('explosion', enemy, 22, 1.1);
    emit('kill', { enemyId: enemy.id, x: enemy.x, y: enemy.y, z: enemy.z, kills: state.player.kills });
  }

  function damagePlayer(amount, at) {
    if (state.player.invulnerable || state.player.health <= 0) return;
    state.player.health = Math.max(0, state.player.health - amount);
    state.player.lastHitAt = state.elapsed;
    effect('hit', at, 8, 0.28);
    emit('player-hit', { damage: amount, health: state.player.health, x: at.x, y: at.y, z: at.z });
  }

  function updateProjectiles(dt, pose) {
    const alive = [];
    for (const shot of state.projectiles) {
      shot.prevX = pose.x + shortestOffset(shot.x - pose.x);
      shot.prevY = pose.y + shortestOffset(shot.y - pose.y);
      shot.prevZ = shot.z;
      shot.x = shot.prevX + shot.vx * dt;
      shot.y = shot.prevY + shot.vy * dt;
      shot.z += shot.vz * dt;
      shot.ttl -= dt;
      shot.age = (shot.age || 0) + dt;
      const from = { x: shot.prevX, y: shot.prevY, z: shot.prevZ };
      let consumed = false;
      if (shot.owner === 'player') {
        let nearest = null;
        for (const enemy of state.enemies) {
          if (enemy.health <= 0 || enemy.faction === shot.faction) continue;
          const hit = segmentHit(from, shot, enemy, enemy.radius + (shot.radius || 0));
          if (hit && (!nearest || hit.t < nearest.hit.t)) nearest = { enemy, hit };
        }
        if (nearest) {
          const { enemy, hit } = nearest;
          enemy.health = Math.max(0, enemy.health - shot.damage);
          enemy.lastHitAt = state.elapsed;
          state.player.hits += 1;
          state.score += 10;
          effect('hit', hit, 5, 0.22);
          emit('hit', { enemyId: enemy.id, damage: shot.damage, ...hit });
          if (enemy.health === 0) destroyEnemy(enemy);
          consumed = true;
        }
      } else if (shot.faction !== faction) {
        const hit = segmentHit(from, shot, pose, PLAYER_RADIUS + (shot.radius || 0));
        if (hit) {
          damagePlayer(shot.damage, hit);
          consumed = true;
        }
      }
      if (!consumed && shot.ttl > 0 && shot.z > -20 && shot.z < 650) alive.push(shot);
    }
    state.projectiles = alive;
    state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  }

  function updateRamming(dt, pose) {
    ramCooldown = Math.max(0, ramCooldown - dt);
    if (ramCooldown > 0) return;
    for (const enemy of state.enemies) {
      if (distanceBetween(pose, enemy) > 14) continue;
      damagePlayer(difficultyId === 'ace' ? 18 : 12, pose);
      enemy.health = Math.max(0, enemy.health - 32);
      enemy.breakUntil = state.elapsed + 2;
      enemy.yaw = wrapAngle(enemy.yaw + Math.PI / 2);
      enemy.lastHitAt = state.elapsed;
      effect('hit', enemy, 11, 0.4);
      if (enemy.health === 0) destroyEnemy(enemy);
      ramCooldown = 1;
      break;
    }
    state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  }

  function advanceEffects(dt) {
    for (const item of state.effects) {
      item.age += dt;
      item.ttl = Math.max(0, item.life - item.age);
    }
    state.effects = state.effects.filter((item) => item.age < item.life);
  }

  function finish(status, pose) {
    state.status = status;
    state.waveCountdown = 0;
    if (status === 'won') state.score += 500 + Math.round(state.player.health * 5);
    else effect('explosion', pose, 30, 1.8);
    emit(status === 'won' ? 'victory' : 'defeat', { score: state.score });
  }

  function advanceMission(dt, pose) {
    if (state.player.health <= 0) return finish('lost', pose);
    if ((mission.targetKills && state.player.kills >= mission.targetKills)
      || (mission.duration && state.elapsed >= mission.duration)) return finish('won', pose);
    if (state.waveCountdown > 0) {
      state.waveCountdown = Math.max(0, state.waveCountdown - dt);
      if (state.waveCountdown === 0) spawnWave(pose);
    } else if (state.enemies.length === 0) {
      if (mission.duration || state.wave < mission.waves.length) {
        state.waveCountdown = 3;
        emit('wave-clear', { wave: state.wave });
      }
    } else if (mission.duration && state.elapsed - waveStartedAt >= 30
      && state.enemies.length < difficulty.reinforcementLimit) {
      spawnWave(pose);
    }
  }

  function step(delta, playerPose, input = {}) {
    const pose = poseOf(playerPose);
    initialize(pose);
    state.events = [];
    const dt = clamp(finite(delta, 0), 0, MAX_FRAME);
    if (state.status !== 'playing') {
      advanceEffects(dt);
      return state;
    }
    if (dt <= 0) return state;
    const count = Math.max(1, Math.ceil(dt / MAX_STEP));
    const substep = dt / count;
    for (let index = 0; index < count && state.status === 'playing'; index += 1) {
      const currentPose = interpolatePose(previousPose, pose, (index + 1) / count);
      state.elapsed += substep;
      state.player.invulnerable = state.elapsed < state.player.invulnerableUntil;
      advanceEffects(substep);
      for (const enemy of state.enemies) updateEnemy(enemy, substep, currentPose);
      updatePlayerGun(substep, currentPose, Boolean(input.firing));
      updateProjectiles(substep, currentPose);
      updateRamming(substep, currentPose);
      advanceMission(substep, currentPose);
    }
    previousPose = pose;
    return state;
  }

  reset();
  return { state, initialize, step, reset };
}
