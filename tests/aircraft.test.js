import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, getAircraft, getSkin, createAircraftModel, drawAircraftPreview } from '../src/game/aircraft.js';

test('both factions have four unique, selectable liveries', () => {
  assert.deepEqual(AIRCRAFT.map((a) => a.faction), ['raf', 'luftwaffe']);
  const ids = AIRCRAFT.flatMap((a) => a.skins.map((s) => s.id));
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  for (const aircraft of AIRCRAFT) {
    for (const skin of aircraft.skins) {
      assert.equal(getSkin(aircraft.id, skin.id), skin);
      for (const value of Object.values(skin.colors)) assert.match(value, /^#[0-9a-f]{6}$/i);
    }
  }
});

test('models contain centred, bounded, opaque propeller-aircraft geometry', () => {
  for (const aircraft of AIRCRAFT) {
    const model = createAircraftModel(aircraft.id);
    assert.ok(model.voxels.length >= 1500 && model.voxels.length <= 3000, `${aircraft.id}: ${model.voxels.length} voxels`);
    assert.ok(model.width >= 30 && model.width <= 38);
    assert.ok(model.length >= 40 && model.length <= 48);
    assert.ok(model.height >= 8 && model.height <= 13);
    assert.equal(model.pivotY, 0);
    assert.equal(model.pivotK, 0);
    const keys = new Set();
    for (const v of model.voxels) {
      assert.ok([v.x, v.y, v.z].every(Number.isInteger));
      assert.equal(v.color >>> 24, 255);
      assert.ok(v.x >= model.bounds.minX && v.x <= model.bounds.maxX);
      assert.ok(v.y >= model.bounds.minY && v.y <= model.bounds.maxY);
      assert.ok(v.z >= model.bounds.minZ && v.z <= model.bounds.maxZ);
      keys.add(`${v.x},${v.y},${v.z}`);
    }
    assert.equal(keys.size, model.voxels.length);
    assert.ok(model.propeller.y > 20);
    assert.ok(model.voxels.some((v) => v.y === model.propeller.y && Math.abs(v.x) >= 5));
    assert.ok(model.voxels.some((v) => v.y < -12 && v.z >= 6));
  }
});

test('two aircraft have distinct silhouettes; skins change colour without changing geometry', () => {
  const spitfire = createAircraftModel('spitfire');
  const bf109 = createAircraftModel('bf109');
  const shape = (m) => m.voxels.map((v) => `${v.x}/${v.y}/${v.z}`).join(';');
  assert.notEqual(shape(spitfire), shape(bf109));
  const night = createAircraftModel('spitfire', 'raf-night');
  assert.equal(shape(spitfire), shape(night));
  assert.ok(spitfire.voxels.some((v, i) => v.color !== night.voxels[i].color));
});

test('model caching and unknown selections preserve valid faction-specific defaults', () => {
  assert.equal(createAircraftModel('spitfire'), createAircraftModel('spitfire', 'raf-classic'));
  assert.equal(createAircraftModel('bf109', 'raf-classic').skinId, 'luftwaffe-grey');
  assert.equal(getAircraft('missing').id, 'spitfire');
  assert.equal(createAircraftModel('missing', 'missing'), createAircraftModel('spitfire'));
  assert.ok(Object.isFrozen(createAircraftModel('bf109').voxels));
});

test('preview paints both models and keeps projected pixels inside a mobile card', () => {
  for (const id of ['spitfire', 'bf109']) {
    const pixels = [];
    const ctx = {
      canvas: { width: 260, height: 180 }, save() {}, restore() {}, clearRect() {},
      fillRect(x, y, w, h) { pixels.push({ x, y, w, h }); },
    };
    const model = createAircraftModel(id);
    drawAircraftPreview(ctx, model);
    assert.equal(pixels.length, model.voxels.length);
    for (const p of pixels) {
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 260 && p.y + p.h <= 180, JSON.stringify(p));
    }
  }
});
