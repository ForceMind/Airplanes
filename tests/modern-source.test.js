import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { buildModernPage, SOURCE_SHA256, hash } from '../scripts/import-modern.mjs';
const source = await readFile(new URL('../vendor/upstream/fighter-guns-v9/index.html', import.meta.url));
test('combat fork snapshot is exact, intact and contains the supplied native three-view battle engine', () => {
  assert.equal(hash(source), SOURCE_SHA256);
  const text = source.toString();
  for (const token of ['toggleView:', '"cockpit"', 'fireMissile:', 'get combat()', 'getAchievements', 'exportRun:', 'Skill tree']) assert.ok(text.includes(token), token);
  const scripts = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1); assert.doesNotThrow(()=>new Script(scripts[0][1]));
});
test('runtime import is deterministic, namespaced, offline and calls the real native camera', async () => {
  const built = buildModernPage(source);
  assert.equal(built, await readFile(new URL('../modern/index.html',import.meta.url),'utf8'));
  assert.ok(built.includes('window.__airplanesCycleView=()=>{rt.toggleView();mc.current(rt.view,7)}'));
  assert.ok(built.includes('airplanes-modern-v9-slots'));
  assert.ok(built.includes("connect-src 'none'"));
  assert.equal(/<script[^>]+src=["']https?:/.test(built),false);
  assert.ok(built.includes('Bundled license information'));
});
test('upstream changes fail closed rather than silently importing different code', () => {
  assert.throws(()=>buildModernPage(Buffer.concat([source,Buffer.from('changed')])),/Upstream bytes changed/);
});
