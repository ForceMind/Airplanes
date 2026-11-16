import test from 'node:test';
import assert from 'node:assert/strict';
import { createPropellerVoxels, propellerPhase } from '../src/engine/propeller.js';
import { actorAxes, actorPointToWorld, drawVoxelActors } from '../src/engine/actor-renderer.js';
import { createFlameLayer } from '../src/engine/flame-layer.js';
import { createScene, DEFAULT_PARAMS } from '../src/engine/scene.js';

const propeller = Object.freeze({ x: 0, y: 8, z: 1, radius: 8, bladeCount: 3, hubRadius: 1.2, bladeColor: 0xff342e29, tipColor: 0xff59c4e8 });
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} / ${b}`);

test('three real blades keep 120-degree spacing and turn in the hub x/z plane', () => {
  const points = createPropellerVoxels(propeller, .31);
  assert.deepEqual([...new Set(points.map(p => p.bladeIndex))], [0, 1, 2]);
  assert.ok(points.length < 150, 'moving mesh stays small');
  for (const point of points) assert.equal(point.y, propeller.y);
  const ends = [0, 1, 2].map(index => {
    const blade = points.filter(p => p.bladeIndex === index);
    const p = blade[blade.length - 1];
    return [p.x - propeller.x, p.z - propeller.z];
  });
  for (let i = 0; i < 3; i++) close(dot(ends[i], ends[(i + 1) % 3]) / Math.hypot(...ends[i]) / Math.hypot(...ends[(i + 1) % 3]), -.5, 'blade separation');
  const rotated = createPropellerVoxels(propeller, .31 + Math.PI / 2);
  points.forEach((p, i) => {
    close(rotated[i].x - propeller.x, -(p.z - propeller.z), 'quarter-turn x');
    close(rotated[i].z - propeller.z, p.x - propeller.x, 'quarter-turn z');
    assert.equal(rotated[i].y, p.y);
  });
});

test('blade plane and muzzle transform follow aircraft yaw, pitch and bank', () => {
  const actor = { x: 160, y: 225, z: 105, yaw: .81, pitch: .29, roll: -.67, scale: .72 };
  const { r, f, u } = actorAxes(actor);
  for (const axis of [r, f, u]) close(Math.hypot(...axis), 1, 'unit axis');
  close(dot(r, f), 0, 'right/forward perpendicular');
  close(dot(u, f), 0, 'up/forward perpendicular');
  const hub = actorPointToWorld(actor, propeller);
  for (const p of createPropellerVoxels(propeller, 1.12)) {
    const world = actorPointToWorld(actor, p);
    const delta = [world.x - hub.x, world.y - hub.y, world.z - hub.z];
    close(dot(delta, f), 0, 'blade stays perpendicular to aircraft shaft');
    close(Math.hypot(...delta), Math.hypot(p.x - propeller.x, p.z - propeller.z) * actor.scale, 'physical radius under rotation');
  }
});

function target() {
  const width = 70, height = 70;
  return {
    width, height, pixels: new Uint32Array(width * height).fill(0xffc0b090), depth: new Float32Array(width * height),
    project: (x, y, z) => ({ x: 35 + x * 2, y: 35 - z * 2, depth: y, scale: 2, visible: true }),
    visible: () => true,
  };
}

test('propeller pixels change with time and remain occluded by nearer airframes', () => {
  const model = { width: 20, length: 20, height: 20, voxels: [], propeller };
  const a = { x: 0, y: 0, z: 0, model, scale: 1, speed: 92, time: .013 };
  const first = target(), second = target();
  drawVoxelActors([a], first);
  drawVoxelActors([{ ...a, time: .027 }], second);
  assert.notDeepEqual(first.pixels, second.pixels, 'flight time drives actual moving blade geometry');
  assert.notEqual(propellerPhase(.013, 92, propeller), propellerPhase(.027, 92, propeller));
  const cover = [];
  for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) cover.push({ x, y: 11, z, color: 0xff887766 });
  const foreground = { ...a, model: { width: 24, length: 24, height: 24, voxels: cover } };
  const covered = target(), baseline = target(), reversed = target();
  drawVoxelActors([foreground], baseline);
  drawVoxelActors([a, foreground], covered);
  drawVoxelActors([foreground, a], reversed);
  assert.deepEqual(covered.pixels, baseline.pixels, 'opaque aircraft covers both blade and exposure blur');
  assert.deepEqual(reversed.pixels, baseline.pixels, 'propeller depth is independent of actor order');
  const terrain = target();
  assert.equal(drawVoxelActors([a], { ...terrain, visible: () => false }), 0, 'world depth also covers propellers');
});

test('battle-hidden jets cannot emit flames, trails or formation silhouettes even with jet settings enabled', () => {
  const base = { ...DEFAULT_PARAMS, intro: false, clouds: 0, view: 'top', flameStyle: 'realistic' };
  const quiet = createScene({ ...base, afterburner: 0, wingmen: 0, trails: false }, { hidePlayer: true, manualControl: true });
  const jets = createScene({ ...base, afterburner: 1, wingmen: 2, trails: true }, { hidePlayer: true, manualControl: true });
  for (const scene of [quiet, jets]) {
    scene.resize(180, 120);
    scene.setKeys(.2, 0, true);
    for (let i = 0; i < 40; i++) scene.step(.05);
  }
  assert.deepEqual(jets.render(), quiet.render());
  assert.equal(jets.flames.count, 0);
});

test('disposing the jet overlay erases all old flames, including outside the last scissor box', () => {
  const width = 200, height = 100;
  const alpha = new Uint8Array(width * height);
  let scissors = false, box = [0, 0, width, height], deleted = 0;
  const paint = value => {
    const [x, y, w, h] = scissors ? box : [0, 0, width, height];
    for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) alpha[py * width + px] = value;
  };
  const gl = new Proxy({
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    enable: key => { if (key === 'SCISSOR_TEST') scissors = true; },
    disable: key => { if (key === 'SCISSOR_TEST') scissors = false; },
    scissor: (...args) => { box = args; }, clear: () => paint(0), drawArrays: () => paint(255),
    deleteProgram: () => { deleted++; },
  }, { get: (object, key) => key in object ? object[key] : /^[A-Z_]+$/.test(key) ? key : () => {} });
  const layer = createFlameLayer({ width, height, getContext: () => gl });
  const data = new Float32Array(32);
  for (let i = 0; i < 2; i++) data.set([40 + i * 110, 30, 40 + i * 110, 40, 40 + i * 110, 50, 1, 1, 1, 1, 1, 1, 1, i, 1, 1], i * 16);
  layer.draw(2, data, 1, 0);
  assert.ok(alpha.some(value => value > 0), 'actual simulated GL frame contains both separated flames');
  layer.dispose();
  assert.equal(alpha.some(value => value > 0), false, 'overlay becomes fully transparent');
  layer.draw(2, data, 1, 1);
  layer.dispose();
  assert.equal(alpha.some(value => value > 0), false, 'disposed overlay cannot draw again');
  assert.equal(deleted, 1, 'disposal is idempotent');
});
