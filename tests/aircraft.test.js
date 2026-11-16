import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, getAircraft, getSkin, createAircraftModel, drawAircraftPreview } from '../src/game/aircraft.js';
import { AIRCRAFT_SPECS, getAircraftSpec, MODEL_UNITS_PER_METRE } from '../src/game/aircraft-specs.js';
import { createPropellerVoxels } from '../src/engine/propeller.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const shape = m => m.voxels.map(v => `${v.x}/${v.y}/${v.z}`).join(';');

function preview(model, options = {}) {
  const pixels = [];
  const ctx = {
    canvas: { width: 260, height: 180 }, save() {}, restore() {}, clearRect() {},
    fillRect(x, y, w, h) { pixels.push({ x, y, w, h, color: this.fillStyle }); },
  };
  drawAircraftPreview(ctx, model, options);
  return pixels;
}

test('1940 variants preserve all eight saved skin IDs and identify creative palettes', () => {
  assert.deepEqual(AIRCRAFT.map(a => a.faction), ['raf', 'luftwaffe']);
  assert.deepEqual(AIRCRAFT.map(a => a.name), ['Spitfire Mk Ia', 'Bf 109 E-4']);
  assert.deepEqual(AIRCRAFT.flatMap(a => a.skins.map(s => s.id)), [
    'raf-classic', 'raf-coastal', 'raf-night', 'raf-silver',
    'luftwaffe-grey', 'luftwaffe-desert', 'luftwaffe-winter', 'luftwaffe-night',
  ]);
  for (const aircraft of AIRCRAFT) {
    for (const [index, skin] of aircraft.skins.entries()) {
      assert.equal(getSkin(aircraft.id, skin.id), skin);
      if (index > 0) assert.match(skin.description, /创意涂装/);
      for (const value of Object.values(skin.colors)) assert.match(value, /^#[0-9a-f]{6}$/i);
    }
  }
});

test('fuselage length and wing span retain real proportions to within one voxel', () => {
  assert.equal(MODEL_UNITS_PER_METRE, 5);
  assert.deepEqual(getAircraftSpec('spitfire').dimensions, { wingspanMetres: 11.23, lengthMetres: 9.12 });
  assert.deepEqual(getAircraftSpec('bf109').dimensions, { wingspanMetres: 9.87, lengthMetres: 8.74 });
  for (const aircraft of AIRCRAFT) {
    const model = createAircraftModel(aircraft.id), spec = getAircraftSpec(aircraft.id);
    const { wingspanMetres, lengthMetres } = spec.dimensions;
    close(model.width / spec.unitsPerMetre, wingspanMetres, 1 / spec.unitsPerMetre);
    close(model.length / spec.unitsPerMetre, lengthMetres, 1 / spec.unitsPerMetre);
    close(model.width / model.length, wingspanMetres / lengthMetres, .02);
    assert.ok(model.voxels.length < 3000, 'keep each detailed aircraft within the software renderer budget');
    assert.equal(model.pivotY, 0);
    assert.equal(model.pivotK, 0);
    assert.equal(model.modelScale, .72);
    assert.equal(new Set(model.voxels.map(v => `${v.x},${v.y},${v.z}`)).size, model.voxels.length);
    for (const v of model.voxels) {
      assert.ok([v.x, v.y, v.z].every(Number.isFinite));
      assert.equal(v.color >>> 24, 255);
      assert.ok(v.x >= model.bounds.minX && v.x <= model.bounds.maxX);
      assert.ok(v.y >= model.bounds.minY && v.y <= model.bounds.maxY);
      assert.ok(v.z >= model.bounds.minZ && v.z <= model.bounds.maxZ);
    }
  }
  assert.ok(createAircraftModel('spitfire').width > createAircraftModel('bf109').width);
});

test('elliptical and straight-tapered wings have different measurable silhouettes and cooling layouts', () => {
  const spitfire = createAircraftModel('spitfire'), bf109 = createAircraftModel('bf109');
  const edge = (m, x) => Math.max(...m.voxels.filter(v => v.part === 'wing' && v.x === x).map(v => v.y));
  // The elliptical leading edge bows forward at midspan; E's edge is straight
  // apart from the rounding error of the one-unit model grid.
  const spitfireBow = edge(spitfire, 15.5) - (edge(spitfire, 3.5) + edge(spitfire, 27.5)) / 2;
  const bf109Bow = edge(bf109, 14) - (edge(bf109, 4) + edge(bf109, 24)) / 2;
  assert.ok(spitfireBow >= 1.5);
  assert.ok(Math.abs(bf109Bow) <= .5);
  assert.ok(spitfire.voxels.filter(v => v.part === 'radiator').every(v => v.x > 0));
  assert.ok(spitfire.voxels.filter(v => v.part === 'oil-cooler').every(v => v.x < 0));
  for (const side of [-1, 1]) assert.ok(bf109.voxels.some(v => v.part === 'radiator' && v.x * side > 0));
  assert.ok(bf109.voxels.some(v => v.part === 'tail-strut'));
  assert.ok(!spitfire.voxels.some(v => v.part === 'tail-strut'));
  assert.notEqual(shape(spitfire), shape(bf109));
  assert.equal(shape(spitfire), shape(createAircraftModel('spitfire', 'raf-night')));
  assert.ok(spitfire.voxels.some((v, i) => v.color !== createAircraftModel('spitfire', 'raf-night').voxels[i].color));
});

test('eight A-wing Brownings and E-4 cowling guns / wing cannons use visible shared muzzle coordinates', () => {
  const spitfire = getAircraftSpec('spitfire'), bf109 = getAircraftSpec('bf109');
  assert.equal(spitfire.gunMounts.length, 8);
  assert.ok(spitfire.gunMounts.every(m => m.kind === 'machine-gun' && m.calibreMm === 7.7));
  for (const side of [-1, 1]) assert.equal(spitfire.gunMounts.filter(m => m.x * side > 0).length, 4);
  assert.equal(bf109.gunMounts.filter(m => m.kind === 'machine-gun' && Math.abs(m.x) < 2 && m.calibreMm === 7.92).length, 2);
  assert.equal(bf109.gunMounts.filter(m => m.kind === 'cannon' && Math.abs(m.x) > 8 && m.calibreMm === 20).length, 2);
  for (const spec of Object.values(AIRCRAFT_SPECS)) {
    const model = createAircraftModel(spec.id);
    assert.equal(model.gunMounts, spec.gunMounts);
    const ports = model.voxels.filter(v => v.part === 'gun-port');
    assert.equal(ports.length, spec.gunMounts.length);
    for (const mount of spec.gunMounts) {
      assert.ok(ports.some(p => p.x === mount.x && p.y === mount.y && p.z === mount.z));
      assert.ok(spec.gunMounts.some(m => m.x === -mount.x && m.y === mount.y && m.z === mount.z));
      assert.ok(mount.roundsPerMinute > 0 && mount.muzzleVelocity > 0);
    }
  }
});

test('static airframes have spinners and no frozen propeller cross; moving mesh has three blades', () => {
  for (const id of ['spitfire', 'bf109']) {
    const model = createAircraftModel(id), hub = model.propeller;
    assert.equal(hub.bladeCount, 3);
    assert.equal(hub.x, 0);
    assert.equal(hub.rotationSign, -1);
    assert.ok(model.voxels.some(v => v.part === 'spinner'));
    const ahead = model.voxels.filter(v => v.y >= hub.y - .3);
    assert.ok(ahead.length > 0);
    assert.ok(ahead.every(v => v.part === 'spinner' && Math.hypot(v.x - hub.x, v.z - hub.z) <= hub.hubRadius));
    assert.ok(!model.voxels.some(v => v.part === 'propeller' || 'bladeIndex' in v));
    const blades = createPropellerVoxels(hub, .25);
    assert.deepEqual([...new Set(blades.map(v => v.bladeIndex))], [0, 1, 2]);
    assert.ok(blades.every(v => v.y === hub.y));
    for (let i = 0; i < 3; i++) assert.ok(blades.some(v => v.bladeIndex === i && Math.hypot(v.x - hub.x, v.z - hub.z) >= hub.radius * .95));
  }
});

test('caching and unknown selections preserve immutable faction-specific defaults', () => {
  assert.equal(createAircraftModel('spitfire'), createAircraftModel('spitfire', 'raf-classic'));
  assert.equal(createAircraftModel('bf109', 'raf-classic').skinId, 'luftwaffe-grey');
  assert.equal(getAircraft('missing').id, 'spitfire');
  assert.equal(getAircraftSpec('missing'), AIRCRAFT_SPECS.spitfire);
  assert.equal(createAircraftModel('missing', 'missing'), createAircraftModel('spitfire'));
  assert.ok(Object.isFrozen(createAircraftModel('bf109').voxels));
  assert.ok(Object.isFrozen(getAircraftSpec('bf109').gunMounts[0]));
});

test('animated preview and shared muzzle markers fit mobile cards over different viewpoints', () => {
  for (const id of ['spitfire', 'bf109']) {
    const model = createAircraftModel(id);
    const count = model.voxels.length + createPropellerVoxels(model.propeller).length;
    for (const rotation of [0, -.48, 1.8, -Math.PI / 2]) {
      for (const elevation of [.16, .78, 1]) {
        const pixels = preview(model, { rotation, elevation, showHardpoints: true, time: 1.234 });
        assert.equal(pixels.length, count + model.gunMounts.length * 2);
        for (const p of pixels) {
          assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 260 && p.y + p.h <= 180, `${id}: ${JSON.stringify(p)}`);
        }
      }
    }
    const still = preview(model, { propellerPhase: .2 });
    const turning = preview(model, { time: .123 });
    assert.equal(still.length, count);
    assert.notDeepEqual(still, turning);
  }
});
