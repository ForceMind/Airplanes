import test from 'node:test';
import assert from 'node:assert/strict';
import { readSelection, saveSelection, saveRecord } from '../src/game/preferences.js';
function storage() { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) }; }
test('invalid stored configuration recovers to a playable selection', () => {
  const saved = storage(); saved.setItem('airplanes.preferences.v1', '{broken');
  assert.equal(readSelection(saved).faction, 'raf');
  saved.setItem('airplanes.preferences.v1', JSON.stringify({ faction: 'invalid', mission: 'missing', difficulty: 99 }));
  assert.equal(readSelection(saved).mission, 'channel');
  assert.equal(readSelection(saved).difficulty, 'rookie');
});
test('selected skins and difficulty survive reload while records remain scoped', () => {
  const saved = storage(); const chosen = { faction: 'luftwaffe', mission: 'intercept', difficulty: 'ace', skins: { raf: 'raf-night', luftwaffe: 'luftwaffe-winter' } };
  assert.equal(saveSelection(chosen, saved), true); assert.deepEqual(readSelection(saved), chosen);
  assert.equal(saveRecord(chosen, 700, saved).best, 700);
  assert.equal(saveRecord(chosen, 100, saved).best, 700);
  assert.equal(saveRecord({ ...chosen, difficulty: 'rookie' }, 200, saved).best, 200);
});
test('disabled storage does not prevent playing or completing a game', () => {
  const disabled = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readSelection(disabled).mission, 'channel');
  assert.equal(saveSelection({}, disabled), false);
  assert.equal(saveRecord({ faction: 'raf', mission: 'channel', difficulty: 'rookie' }, 400, disabled).saved, false);
});
