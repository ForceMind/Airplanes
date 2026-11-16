import { actorPointToWorld } from '../engine/actor-renderer.js';

// This game retains the existing arcade world/time scale. These are explicit
// game multipliers, not claimed historical muzzle velocities or damage values.
export const BALLISTIC_SPEED_SCALE = 0.9;
export const CONVERGENCE_DISTANCE = 380;

/** Use the identical yaw/pitch/roll basis as the visible aircraft geometry. */
export function muzzleWorldPosition(pose, mount, modelScale) {
  return actorPointToWorld(pose, mount, modelScale);
}

export function createGunStates(spec) {
  return spec.gunMounts.map((mount, index) => ({
    mountId: mount.id, index, fired: 0,
    // Small trigger/lock offsets keep separate barrels from becoming one
    // identical, frame-synchronised sheet of tracers.
    cooldown: (index % 4) * 0.003,
  }));
}

export function gameBallistics(mount, platformSpeed, owner, enemyDamageScale) {
  const cannon = mount.kind === 'cannon';
  const playerDamage = cannon ? 9 : 1.65;
  return {
    speed: mount.muzzleVelocity * BALLISTIC_SPEED_SCALE + platformSpeed,
    damage: owner === 'player' ? playerDamage : playerDamage * enemyDamageScale,
    interval: 60 / mount.roundsPerMinute,
    radius: cannon ? 1.3 : 0.7,
    tracerEvery: cannon ? 3 : 5,
    ttl: cannon ? 1.5 : 1.25,
  };
}
