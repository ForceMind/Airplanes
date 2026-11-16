import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene, DEFAULT_PARAMS } from '../src/engine/scene.js';
import { createAircraftModel } from '../src/game/aircraft.js';
import { createCombat } from '../src/game/combat.js';
import { drawVoxelActors } from '../src/engine/actor-renderer.js';

const settings = { ...DEFAULT_PARAMS, clouds: 0, altitude: 110, intro: false, followPointer: false, afterburner: 0, trails: false };
const marker = { width: 5, length: 5, height: 3, voxels: [{ x: 0, y: 0, z: 0, color: 0xff11edfa }] };
function makeScene(view, width = 240, height = 150) {
  const scene = createScene({ ...settings, view }, { hidePlayer: true, manualControl: true });
  scene.resize(width, height); scene.step(.05); scene.render(); return scene;
}
for (const view of ['top', 'chase', 'cockpit']) test(`WWII actors use real world projection and occlusion in ${view}`, () => {
  const scene = makeScene(view); const pose = scene.getFlightState();
  const ahead = view === 'top' ? 35 : 110;
  const actor = { ...pose, x: pose.x + Math.sin(pose.yaw) * ahead,
    y: pose.y - Math.cos(pose.yaw) * ahead, model: marker, scale: 3 };
  const projected = scene.projectPoint(actor.x, actor.y, actor.z);
  assert.equal(projected.visible, true);
  const before = scene.render().slice();
  const after = scene.drawActors([actor]);
  assert.notDeepEqual(after, before, `${view} must draw an external actor rather than silently no-op`);
  assert.equal(scene.isPointVisible(projected.x, projected.y, projected.depth + 10000), false);
  assert.equal(scene.flames.count, 0);
  assert.equal(scene.getCameraState().view, view);
});
test('cockpit transition hides the player airframe instead of drawing it over the windscreen', () => {
  const scene = makeScene('cockpit'); const pose = scene.getFlightState();
  const before = scene.render().slice();
  const after = scene.drawActors([{ ...pose, isPlayer: true, model: createAircraftModel('spitfire'), scale: .72 }]);
  assert.deepEqual(after, before);
  assert.equal(scene.getCameraState().playerOpacity, 0);
  assert.ok(scene.getCameraState().cockpitOpacity > .99);
});
test('WWII camera cycling retains gun configuration, shots, health and mission state', () => {
  const scene = makeScene('top'); const combat = createCombat({ faction: 'luftwaffe' });
  combat.initialize(scene.getFlightState());
  let lastShots = 0;
  for (const expected of ['chase', 'cockpit', 'top']) {
    const snapshot = JSON.stringify(combat.state);
    const previousWave = combat.state.wave;
    scene.toggleView();
    assert.equal(JSON.stringify(combat.state), snapshot, 'a camera command cannot reset combat');
    for (let i = 0; i < 45; i++) { scene.step(.05); combat.step(.05, scene.getFlightState(), { firing: i < 5 }); }
    scene.render();
    assert.equal(scene.view, expected); assert.equal(combat.state.player.aircraftId, 'bf109');
    assert.ok(combat.state.player.shots > lastShots); lastShots = combat.state.player.shots;
    assert.ok(combat.state.player.cannonShots > 0 && combat.state.player.machineGunShots > 0);
    assert.ok(combat.state.wave >= previousWave); assert.equal(combat.state.status, 'playing');
  }
});
test('perspective reinforcements start beyond the actual viewport without wrapping through the map seam', () => {
  for (const view of ['chase', 'cockpit']) for (const [width, height] of [[320,180],[180,320]]) {
    const scene = makeScene(view, width, height); const pose = scene.getFlightState();
    const combat = createCombat({ getView: () => ({ view: scene.view, width, height, project: scene.projectPoint }) });
    combat.initialize(pose);
    for (const enemy of combat.state.enemies) {
      const p = scene.projectPoint(enemy.x, enemy.y, enemy.z), radius = enemy.viewRadius * p.scale;
      assert.ok(p.scale <= 0 || p.x + radius < 0 || p.y + radius < 0 || p.x - radius >= width || p.y - radius >= height);
      assert.ok(Math.hypot(enemy.x-pose.x,enemy.y-pose.y) < 1024);
    }
  }
});
test('a fading player cannot paint through a nearer opaque aircraft', () => {
  const pixels = new Uint32Array(1600), depth = new Float32Array(1600);
  const target = { width:40,height:40,pixels,depth,visible:()=>true,
    project:(x,y,z)=>({x:20+x,y:20-z,depth:y,scale:1,visible:true}) };
  const actor = (y,color,opacity=1)=>({x:0,y,z:0,opacity,model:{width:1,length:1,height:1,voxels:[{x:0,y:0,z:0,color}]}});
  drawVoxelActors([actor(8,0xff0000ff,.5),actor(2,0xff00ff00)],target);
  assert.equal(pixels[820],0xff00ff00);
});
