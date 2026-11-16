import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createScene, DEFAULT_PARAMS } from '../src/engine/scene.js';
import { drawVoxelActors } from '../src/engine/actor-renderer.js';

const params = { ...DEFAULT_PARAMS, intro: false, clouds: 0, altitude: 110, flameStyle: 'pixel' };
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadOriginal() {
  const dir = new URL('../vendor/upstream/fly-v35/', import.meta.url);
  const jet = dataModule(await readFile(new URL('jet-model.ts', dir), 'utf8'));
  const cockpit = dataModule(await readFile(new URL('cockpit.ts', dir), 'utf8'));
  const code = (await readFile(new URL('scene.ts', dir), 'utf8'))
    .replace(/\.\/jet-model\.ts\?v=[^'"]+/, jet)
    .replace(/\.\/cockpit\.ts\?v=[^'"]+/, cockpit);
  return import(dataModule(code));
}

test('default migration preserves upstream pixels in all three camera modes', async () => {
  const upstream = await loadOriginal();
  const before = upstream.createScene(params);
  const after = createScene(params);
  before.resize(160, 100);
  after.resize(160, 100);
  for (const view of ['top', 'chase', 'cockpit']) {
    before.setParams({ ...params, view });
    after.setParams({ ...params, view });
    for (let i = 0; i < 8; i++) {
      before.step(0.05);
      after.step(0.05);
    }
    assert.deepEqual(after.render(), before.render(), `pixel regression in ${view}`);
    assert.equal(after.view, view);
  }
});

test('manual battle flight remains straight with neutral controls and exposes an isolated pose', () => {
  const scene = createScene(params, { hidePlayer: true, manualControl: true });
  scene.resize(160, 100);
  const first = scene.getFlightState();
  scene.setKeys(0, 0, false);
  for (let i = 0; i < 50; i++) scene.step(0.05);
  const pose = scene.getFlightState();
  assert.equal(pose.yaw, first.yaw);
  assert.ok(pose.x > first.x && pose.y < first.y);
  assert.ok(Number.isFinite(pose.vx) && Number.isFinite(pose.vy));
  pose.x = -99999;
  assert.notEqual(scene.getFlightState().x, pose.x);
  assert.equal(scene.isPointVisible(80, 50, 0), false);
  const bytes = scene.render();
  const lead = scene.getFlightState();
  const point = scene.projectPoint(lead.x, lead.y, lead.z);
  assert.equal(point.visible, true);
  assert.equal(scene.isPointVisible(point.x, point.y, point.depth), true);
  const before = bytes.slice();
  const model = { width: 3, length: 3, height: 1, voxels: [{ x: 0, y: 0, z: 0, color: 0xff00ff00 }] };
  assert.equal(scene.drawActors([{ ...lead, scale: 2, model }]), bytes);
  assert.notDeepEqual(bytes, before, 'external voxel must change the rendered frame');
  assert.equal(scene.flames.count, 0, 'hidden modern plane must not produce smooth flames');
  assert.equal(scene.projectPoint(NaN, 0, 0).visible, false);
  assert.equal(scene.isPointVisible(-1, 0, 0), false);
  scene.resize(160, 100);
  assert.equal(scene.isPointVisible(point.x, point.y, point.depth), false);
});

test('actor depth is independent of list order and respects world occlusion', () => {
  const width = 40, height = 40;
  const pixels = new Uint32Array(width * height);
  const depth = new Float32Array(width * height);
  const target = {
    width, height, pixels, depth,
    project: (x, y, z) => ({ x: 20 + x, y: 20 - z, depth: y, scale: 1, visible: true }),
    visible: () => true,
  };
  const actor = (y, color) => ({ x: 0, y, z: 0, model: { width: 1, length: 1, height: 1, voxels: [{ x: 0, y: 0, z: 0, color }] } });
  const near = actor(1, 0xff00ff00), far = actor(5, 0xff0000ff);
  drawVoxelActors([near, far], target);
  const expected = pixels.slice();
  assert.equal(pixels[20 * width + 20], 0xff00ff00);
  pixels.fill(0);
  drawVoxelActors([far, near], target);
  assert.deepEqual(pixels, expected);
  pixels.fill(0);
  assert.equal(drawVoxelActors([near], { ...target, visible: () => false }), 0);
  assert.equal(pixels.some(value => value !== 0), false);
});
