import { createScene, DEFAULT_PARAMS } from './engine/scene.js';
import { createFlameLayer } from './engine/flame-layer.js';
import { AIRCRAFT, getAircraft, getSkin, createAircraftModel, drawAircraftPreview } from './game/aircraft.js';
import { createCombat, MISSIONS } from './game/combat.js';
import { readSelection, saveSelection, saveRecord } from './game/preferences.js';
import { createAudio } from './game/audio.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrappedDelta = x => ((x + 1024) % 2048 + 2048) % 2048 - 1024;
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const safeStore = () => { try { return window.localStorage; } catch { return null; } };
const selection = readSelection(safeStore());
const audio = createAudio();
const canvas = $('#game-canvas'), context = canvas.getContext('2d', { alpha: false });
const effectsCanvas = $('#effects-canvas'), effectsContext = effectsCanvas.getContext('2d');
const fireCanvas = $('#flame-canvas');
const radarContext = $('#radar-canvas').getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = matchMedia('(any-pointer: coarse)');
function updateInputMode() {
  document.documentElement.classList.toggle('touch-input', navigator.maxTouchPoints > 0 || coarsePointer.matches);
}
updateInputMode();
coarsePointer.addEventListener('change', updateInputMode);
let mode = 'home', scene = null, combat = null, paused = false, frameId = 0, frames = 0;
let image = null, flameLayer = null, params = null, lastFrame = 0, frameTime = 0, lastHUD = 0, resultShown = false;
let runToken = 0, previewAngle = -.5, playerModel = null, enemyModel = null, pointerPressed = false;
let messageUntil = 0, fps = 0, heroScene = null, heroImage = null, heroFrame = 0, heroLast = 0;
let freeSkinIndex = 0, lastShotCount = 0, oldKills = 0, previousHealth = 100;
const held = new Set();
const joystick = { pointer: null, x: 0, y: 0 };
const touch = { fire: false, boost: false };
const freeSkins = [
  { name: '原版', bodyColor: '#545969', accentColor: '#f0580e', canopyColor: '#1e8ca0' },
  { name: '极地银', bodyColor: '#becad0', accentColor: '#3c7694', canopyColor: '#3c93a6' },
  { name: '暮色红', bodyColor: '#703b3e', accentColor: '#e6b277', canopyColor: '#6a90aa' },
  { name: '午夜蓝', bodyColor: '#27384c', accentColor: '#aa9a6d', canopyColor: '#4d93ae' },
];
const sourceParams = {
  ...DEFAULT_PARAMS, speed: 92, boost: 1.8, agility: 1.25, altitude: 110, ceiling: 300,
  clearance: 7, bank: 52, spread: 1, jetScale: .6, cameraFollow: .6,
  view: 'top', chaseDistance: 2.6, chaseAngle: 12, chaseSize: .19, transition: 1.4,
  timeOfDay: 'day', clouds: .45, land: .33, seed: 7, afterburner: 1,
  flameStyle: 'realistic', trails: true, wingmen: 0, shadow: true,
  followPointer: true, invertY: true, stunts: true, intro: false,
};

Object.defineProperty(window, '__airplanesDebug', { get: () => ({ mode, paused, state: combat?.state || null, pose: scene?.getFlightState() || null, frames }) });
function reportError(error) {
  console.error(error);
  const banner = $('#error-banner');
  banner.textContent = `飞行暂时中断：${error?.message || '未知错误'}。请刷新页面重试。`;
  banner.hidden = false;
  $('#loading-panel').hidden = true;
}
window.addEventListener('error', event => { if (event.error) reportError(event.error); });
window.addEventListener('unhandledrejection', event => reportError(event.reason));

function persist() { saveSelection(selection, safeStore()); }
function selectedAircraft() { return getAircraft(selection.faction === 'raf' ? 'spitfire' : 'bf109'); }
function missionList() { return Array.isArray(MISSIONS) ? MISSIONS : Object.values(MISSIONS); }
function selectedMission() { return missionList().find(m => m.id === selection.mission) || missionList()[0]; }

function updateHangar() {
  const aircraft = selectedAircraft();
  const skin = getSkin(aircraft.id, selection.skins[selection.faction]);
  selection.skins[selection.faction] = skin.id;
  $('#aircraft-name').textContent = aircraft.name;
  $('#aircraft-subtitle').textContent = aircraft.subtitle;
  $('#aircraft-description').textContent = aircraft.description;
  $('#aircraft-number').textContent = selection.faction === 'raf' ? '01' : '02';
  $('[data-faction="raf"]').setAttribute('aria-pressed', String(selection.faction === 'raf'));
  $('[data-faction="luftwaffe"]').setAttribute('aria-pressed', String(selection.faction === 'luftwaffe'));
  $('#skin-options').replaceChildren(...aircraft.skins.map(item => {
    const button = document.createElement('button'); button.className = 'skin-option';
    button.type = 'button'; button.dataset.skin = item.id;
    button.setAttribute('aria-pressed', String(item.id === skin.id));
    button.setAttribute('aria-label', item.name);
    const colors = document.createElement('span'); colors.className = 'skin-colors'; colors.setAttribute('aria-hidden', 'true');
    for (const color of [item.colors.body, item.colors.accent, item.colors.underside]) { const swatch = document.createElement('i'); swatch.style.background = color; colors.append(swatch); }
    const name = document.createElement('span'); name.textContent = item.name; button.append(colors, name);
    button.addEventListener('click', () => { selection.skins[selection.faction] = item.id; persist(); updateHangar(); });
    return button;
  }));
  $('#skin-description').textContent = skin.description;
  $('#mission-options').replaceChildren(...missionList().map((item, index) => {
    const button = document.createElement('button'); button.className = 'mission-option'; button.type = 'button'; button.dataset.mission = item.id;
    button.setAttribute('aria-pressed', String(item.id === selection.mission));
    const copy = document.createElement('span'); const title = document.createElement('b'); const desc = document.createElement('small');
    title.textContent = item.name || item.title; desc.textContent = item.description;
    copy.append(title, desc); const number = document.createElement('span'); number.className = 'mission-index'; number.textContent = `0${index + 1}`;
    button.append(copy, number); button.addEventListener('click', () => { selection.mission = item.id; persist(); updateHangar(); }); return button;
  }));
  $$('[data-difficulty]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.difficulty === selection.difficulty)));
  const preview = $('#hangar-preview');
  drawAircraftPreview(preview.getContext('2d'), createAircraftModel(aircraft.id, skin.id), { width: preview.width, height: preview.height, rotation: previewAngle });
}
$$('[data-faction]').forEach(button => button.addEventListener('click', () => { selection.faction = button.dataset.faction; persist(); updateHangar(); }));
$$('[data-difficulty]').forEach(button => button.addEventListener('click', () => { selection.difficulty = button.dataset.difficulty; persist(); updateHangar(); }));
$('#rotate-preview').addEventListener('click', () => { previewAngle += Math.PI / 4; updateHangar(); });

function drawBattleCard() {
  const card = $('#battle-preview'), ctx = card.getContext('2d');
  const plane = document.createElement('canvas'); plane.width = 300; plane.height = 220;
  drawAircraftPreview(plane.getContext('2d'), createAircraftModel('spitfire', 'raf-classic'), { width: 300, height: 220, rotation: -.7 });
  ctx.clearRect(0, 0, card.width, card.height);
  ctx.drawImage(plane, 10, -10, 310, 228);
  drawAircraftPreview(plane.getContext('2d'), createAircraftModel('bf109', 'luftwaffe-grey'), { width: 300, height: 220, rotation: -.7 });
  ctx.globalAlpha = .75; ctx.drawImage(plane, 250, -2, 260, 191); ctx.globalAlpha = 1;
}
function startHero() {
  if (heroFrame || mode !== 'home') return;
  try {
    const hero = $('#hero-canvas'), heroCtx = hero.getContext('2d', { alpha: false });
    if (!heroScene) {
      heroScene = createScene({ ...sourceParams, flameStyle: 'pixel', wingmen: 1, clouds: .28, jetScale: .85 });
      heroScene.resize(hero.width, hero.height); heroScene.step(.05);
    }
    heroLast = performance.now();
    function draw(now) {
      heroFrame = 0;
      if (mode !== 'home' || document.hidden) return;
      const dt = Math.min(.05, (now - heroLast) / 1000); heroLast = now;
      heroScene.step(dt);
      const bytes = heroScene.render();
      if (!heroImage) heroImage = new ImageData(bytes, hero.width, hero.height);
      heroCtx.putImageData(heroImage, 0, 0);
      const free = $('#free-preview').getContext('2d'); free.imageSmoothingEnabled = false;
      free.drawImage(hero, 0, 0, $('#free-preview').width, $('#free-preview').height);
      if (!reducedMotion.matches) heroFrame = requestAnimationFrame(draw);
    }
    heroFrame = requestAnimationFrame(draw);
  } catch (error) { reportError(error); }
}
function stopHero() { if (heroFrame) cancelAnimationFrame(heroFrame); heroFrame = 0; }
function route() {
  const hash = location.hash.slice(1);
  if (hash === 'free' || hash === 'combat') { if (mode !== hash) startGame(hash); return; }
  if (hash === 'versions' && mode === 'home') return;
  stopGame(); mode = hash === 'hangar' ? 'hangar' : 'home';
  $('#home-screen').hidden = mode !== 'home'; $('#hangar-screen').hidden = mode !== 'hangar'; $('#game-screen').hidden = true;
  document.body.classList.remove('is-playing');
  if (mode === 'hangar') { stopHero(); updateHangar(); window.scrollTo(0, 0); }
  else { requestAnimationFrame(startHero); }
}
window.addEventListener('hashchange', route);
$('#start-free').addEventListener('click', () => { location.hash = 'free'; });
$('#start-combat').addEventListener('click', () => { location.hash = 'combat'; });

function clearInput() {
  held.clear(); touch.fire = false; touch.boost = false; joystick.x = 0; joystick.y = 0; joystick.pointer = null;
  $('#joystick-thumb').style.transform = '';
  $$('.touch-button').forEach(button => button.classList.remove('held'));
  scene?.setKeys(0, 0, false);
  if (pointerPressed) scene?.release(); pointerPressed = false;
  scene?.pointerLeave();
}
function stopGame() {
  runToken++; cancelAnimationFrame(frameId); frameId = 0; clearInput();
  flameLayer?.dispose(); flameLayer = null; scene = null; combat = null; image = null;
  paused = false; audio.flight(0, false);
}
function resizeGame() {
  if (!scene) return;
  const w = $('#game-screen').clientWidth, h = $('#game-screen').clientHeight;
  const px = mode === 'free' ? 3 : clamp(Math.round(Math.sqrt(w * h / 95000)), 2, 5);
  const cw = Math.ceil(w / px), ch = Math.ceil(h / px);
  if (canvas.width !== cw || canvas.height !== ch || scene.width !== cw || scene.height !== ch) {
    canvas.width = cw; canvas.height = ch; scene.resize(cw, ch); image = null;
  }
  effectsCanvas.width = w; effectsCanvas.height = h;
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  fireCanvas.width = Math.round(w * dpr); fireCanvas.height = Math.round(h * dpr);
}
new ResizeObserver(resizeGame).observe($('#game-screen'));

async function startGame(nextMode) {
  stopHero(); stopGame(); const token = ++runToken;
  mode = nextMode; paused = false; frames = 0; resultShown = false; freeSkinIndex = 0;
  $('#game-pause').textContent = 'Ⅱ'; $('#game-pause').setAttribute('aria-label', '暂停游戏');
  frameTime = 0; lastHUD = 0; oldKills = 0; previousHealth = 100; lastShotCount = 0;
  $('#home-screen').hidden = true; $('#hangar-screen').hidden = true; $('#game-screen').hidden = false;
  $('#loading-panel').hidden = false; $('#pause-panel').hidden = true; $('#result-panel').hidden = true;
  $('#combat-hud').hidden = mode !== 'combat'; $('#free-toolbar').hidden = mode !== 'free';
  $('#touch-fire').hidden = mode !== 'combat'; $('#touch-roll').hidden = mode !== 'free';
  $('#error-banner').hidden = true; document.body.classList.add('is-playing');
  $('#mode-title').textContent = mode === 'free' ? '净空体验' : '1940 · 海峡空战';
  $('#mode-subtitle').textContent = mode === 'free' ? 'CLEAR SKIES' : `${selection.faction === 'raf' ? 'ROYAL AIR FORCE' : 'LUFTWAFFE'} / ${selectedAircraft().name.split('·')[0]}`;
  $('#desktop-hint').textContent = mode === 'free' ? 'WASD / 方向键操控 · Shift 加速 · 空格切换视角 · 点击翻滚 · P 暂停' : 'A D / ← → 转向 · W S / ↑ ↓ 升降 · 空格 / 按住鼠标射击 · Shift 加速 · P 暂停';
  $('#change-view').textContent = '视角：俯视'; $('#change-time').textContent = '时段：白昼'; $('#change-free-skin').textContent = '涂装：原版';
  // Let the loading state paint before the deterministic world is generated.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (token !== runToken) return;
  try {
    params = mode === 'free' ? { ...sourceParams } : {
      ...sourceParams, flameStyle: 'pixel', afterburner: 0, trails: false, wingmen: 0,
      intro: false, stunts: false, followPointer: false, invertY: false, agility: 1.55,
      jetScale: .8, cameraFollow: .8, clouds: .18, altitude: 95, ceiling: 180, bank: 40, boost: 1.45,
    };
    scene = createScene(params, { hidePlayer: mode === 'combat', manualControl: mode === 'combat' });
    resizeGame();
    if (mode === 'combat') {
      playerModel = createAircraftModel(selectedAircraft().id, selection.skins[selection.faction]);
      enemyModel = createAircraftModel(selection.faction === 'raf' ? 'bf109' : 'spitfire', selection.faction === 'raf' ? 'luftwaffe-grey' : 'raf-classic');
      combat = createCombat({ faction: selection.faction, difficulty: selection.difficulty, mission: selection.mission, seed: 7 });
      combat.initialize(scene.getFlightState());
      $('#mission-hud-title').textContent = selectedMission().name || selectedMission().title;
      showMessage('保持航向 · 前方发现敌机', 4);
    } else {
      try { flameLayer = createFlameLayer(fireCanvas); } catch { flameLayer = null; }
      if (!flameLayer) { params.flameStyle = 'pixel'; scene.setParams(params); }
    }
    $('#loading-panel').hidden = true;
    lastFrame = performance.now(); frameId = requestAnimationFrame(frame);
  } catch (error) { reportError(error); }
}

function worldPoint(x, y, z, pose) { return { x: pose.x + wrappedDelta(x - pose.x), y: pose.y + wrappedDelta(y - pose.y), z }; }
function projectWorld(x, y, z, pose) { const p = worldPoint(x, y, z, pose); return scene.projectPoint(p.x, p.y, p.z); }
function actorFor(entity, model, pose, scale = .72) { return { ...entity, ...worldPoint(entity.x, entity.y, entity.z, pose), model, scale }; }
function frame(now) {
  frameId = 0;
  if (!scene || !['free', 'combat'].includes(mode)) return;
  try {
    const wallDt = Math.max(0, (now - lastFrame) / 1000);
    const dt = clamp(wallDt, 0, .05); lastFrame = now;
    if (!paused && !resultShown) {
      frameTime += dt;
      const turn = clamp((held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0) + joystick.x, -1, 1);
      const climb = clamp((held.has('ArrowUp') || held.has('KeyW') ? 1 : 0) - (held.has('ArrowDown') || held.has('KeyS') ? 1 : 0) - joystick.y, -1, 1);
      scene.setKeys(turn, climb, held.has('ShiftLeft') || held.has('ShiftRight') || touch.boost);
      scene.step(dt);
      const pose = scene.getFlightState();
      if (combat) combat.step(dt, pose, { firing: held.has('Space') || touch.fire || pointerPressed });
      const bytes = scene.render();
      if (combat) {
        const actors = [actorFor(pose, playerModel, pose), ...combat.state.enemies.map(enemy => actorFor(enemy, enemyModel, pose))];
        scene.drawActors(actors);
      }
      if (!image || image.data.buffer !== bytes.buffer) image = new ImageData(bytes, canvas.width, canvas.height);
      context.putImageData(image, 0, 0);
      if (mode === 'free' && flameLayer) flameLayer.draw(scene.flames.count, scene.flames.data, fireCanvas.width / canvas.width, now / 1000);
      if (combat) { drawCombatEffects(pose); processEvents(); }
      else effectsContext.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
      frames++;
      fps += ((wallDt > 0 ? 1 / wallDt : 60) - fps) * .03;
      if (now - lastHUD > 90) { updateHUD(pose); lastHUD = now; }
      audio.flight(pose.speed, true);
      if (combat && combat.state.status !== 'playing') finishCombat();
    } else { audio.flight(0, false); }
    frameId = requestAnimationFrame(frame);
  } catch (error) { paused = true; reportError(error); }
}

function drawCombatEffects(pose) {
  const ctx = effectsContext, sx = effectsCanvas.width / canvas.width, sy = effectsCanvas.height / canvas.height;
  ctx.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
  ctx.save(); ctx.scale(sx, sy); ctx.lineCap = 'round';
  for (const bullet of combat.state.projectiles) {
    const p = projectWorld(bullet.x, bullet.y, bullet.z, pose);
    if (!p.visible || !scene.isPointVisible(p.x, p.y, p.depth)) continue;
    const trail = projectWorld(bullet.x - bullet.vx * .025, bullet.y - bullet.vy * .025, bullet.z - bullet.vz * .025, pose);
    ctx.strokeStyle = bullet.owner === 'player' ? '#fff2bd' : '#ff956a'; ctx.lineWidth = bullet.owner === 'player' ? 1.05 : .8;
    ctx.beginPath(); ctx.moveTo(trail.x, trail.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  for (const effect of combat.state.effects) {
    const p = projectWorld(effect.x, effect.y, effect.z, pose); if (!p.visible) continue;
    const t = clamp(effect.age / effect.life, 0, 1), explosion = effect.type === 'explosion';
    const radius = Math.max(1, (effect.radius || 8) * p.scale * (explosion ? .5 + t * 1.7 : .4 + t));
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = t < .25 ? '#fff3bc' : t < .65 ? '#ef9956' : '#57545a';
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    if (explosion) for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + t; ctx.fillRect(p.x + Math.cos(a) * radius * 1.25, p.y + Math.sin(a) * radius * 1.25, 2, 2); }
  }
  ctx.globalAlpha = 1;
  for (const enemy of combat.state.enemies) {
    const p = projectWorld(enemy.x, enemy.y, enemy.z + 13, pose); if (!p.visible || p.x < 10 || p.y < 15 || p.x > canvas.width - 10 || p.y > canvas.height - 12) continue;
    if (!scene.isPointVisible(p.x, p.y, p.depth)) continue;
    ctx.fillStyle = '#192a3499'; ctx.fillRect(p.x - 8, p.y - 4, 16, 1.5);
    ctx.fillStyle = '#ef9076'; ctx.fillRect(p.x - 8, p.y - 4, 16 * clamp(enemy.health / enemy.maxHealth, 0, 1), 1.5);
  }
  const aim = scene.projectPoint(pose.x + Math.sin(pose.yaw) * 62, pose.y - Math.cos(pose.yaw) * 62, pose.z);
  if (aim.visible) {
    ctx.strokeStyle = combat.state.player.overheated ? '#f9a481bb' : '#fff0c5aa'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.arc(aim.x, aim.y, 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(aim.x - 7, aim.y); ctx.lineTo(aim.x - 2, aim.y); ctx.moveTo(aim.x + 2, aim.y); ctx.lineTo(aim.x + 7, aim.y); ctx.moveTo(aim.x, aim.y - 7); ctx.lineTo(aim.x, aim.y - 2); ctx.stroke();
  }
  // A rapidly spinning propeller is a translucent disk perpendicular to the fuselage.
  for (const actor of [actorFor(pose, playerModel, pose), ...combat.state.enemies.map(e => actorFor(e, enemyModel, pose))]) {
    const prop = actor.model.propeller; if (!prop) continue;
    const forward = prop.y * actor.scale;
    const center = scene.projectPoint(actor.x + Math.sin(actor.yaw) * forward, actor.y - Math.cos(actor.yaw) * forward, actor.z + prop.z * actor.scale);
    if (!center.visible || !scene.isPointVisible(center.x, center.y, center.depth)) continue;
    ctx.globalAlpha = .24; ctx.strokeStyle = '#dce5d2'; ctx.lineWidth = 1.1;
    const r = (prop.radius || 9) * actor.scale * center.scale;
    ctx.beginPath(); ctx.ellipse(center.x, center.y, Math.max(.6, r), Math.max(.6, r * .25), -actor.yaw, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();
  const hitAge = combat.state.elapsed - (combat.state.player.lastHitAt ?? -100);
  if (hitAge >= 0 && hitAge < .35) { ctx.fillStyle = `rgba(196,63,38,${(.35 - hitAge) * .24})`; ctx.fillRect(0, 0, effectsCanvas.width, effectsCanvas.height); }
  drawRadar(pose);
}
function drawRadar(pose) {
  const ctx = radarContext, n = 132, c = n / 2, radius = 58;
  ctx.clearRect(0, 0, n, n); ctx.fillStyle = '#122633bc'; ctx.beginPath(); ctx.arc(c, c, radius + 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8cdb52b'; ctx.lineWidth = 1;
  for (const r of [radius, radius / 2]) { ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(c, c - radius); ctx.lineTo(c, c + radius); ctx.moveTo(c - radius, c); ctx.lineTo(c + radius, c); ctx.stroke();
  const cos = Math.cos(pose.yaw), sin = Math.sin(pose.yaw);
  for (const e of combat.state.enemies) {
    const dx = wrappedDelta(e.x - pose.x), dy = wrappedDelta(e.y - pose.y);
    let x = (dx * cos + dy * sin) * .12, y = (-dx * sin + dy * cos) * .12;
    const length = Math.hypot(x, y); if (length > radius - 3) { x *= (radius - 3) / length; y *= (radius - 3) / length; }
    ctx.fillStyle = '#ed8c70'; ctx.beginPath(); ctx.arc(c + x, c + y, length > radius ? 2 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#e9dbb4'; ctx.beginPath(); ctx.moveTo(c, c - 5); ctx.lineTo(c + 4, c + 4); ctx.lineTo(c, c + 2); ctx.lineTo(c - 4, c + 4); ctx.closePath(); ctx.fill();
}
function processEvents() {
  const state = combat.state;
  if (state.player.shots > lastShotCount) audio.effect('shot'); lastShotCount = state.player.shots;
  if (state.player.kills > oldKills) { audio.effect('explosion'); showMessage(`击落确认 +${state.player.kills - oldKills}`, 1.9); } oldKills = state.player.kills;
  if (state.player.health < previousHealth) audio.effect('hit'); previousHealth = state.player.health;
  if (state.player.overheated) { $('#combat-message').textContent = '机枪过热 · 松开射击以冷却'; messageUntil = state.elapsed + .2; }
  else if (state.elapsed > messageUntil) $('#combat-message').textContent = '';
}
function showMessage(text, seconds) { $('#combat-message').textContent = text; messageUntil = (combat?.state.elapsed || 0) + seconds; }
function updateHUD(pose) {
  $('#speed-label').textContent = String(Math.round(pose.speed || params.speed));
  $('#altitude-label').textContent = String(Math.round(pose.z)); $('#fps-label').textContent = `${Math.round(fps)} FPS`;
  if (combat) {
    const state = combat.state, p = state.player;
    $('#health-label').textContent = String(Math.max(0, Math.ceil(p.health)));
    $('#health-fill').style.width = `${clamp(p.health / p.maxHealth, 0, 1) * 100}%`;
    $('#health-fill').style.background = p.health < 30 ? '#ed6b5e' : '#b5dbbb';
    const heat = clamp(p.heat * 100, 0, 100);
    $('#heat-label').textContent = p.overheated ? '过热' : `${Math.round(heat)}%`;
    $('#heat-fill').style.width = `${heat}%`; $('#heat-fill').style.background = p.overheated ? '#ed6b5e' : '#e5c58c';
    $('#kills-label').textContent = String(p.kills).padStart(2, '0'); $('#score-label').textContent = String(state.score).padStart(4, '0');
    $('#mission-progress').textContent = state.waveCountdown > 0 ? `下一波 ${Math.ceil(state.waveCountdown)} 秒` : selection.mission === 'survival' ? `坚守 ${Math.max(0, 180 - Math.floor(state.elapsed))} 秒` : `第 ${state.wave} / ${state.waveTotal} 波 · 剩余 ${state.enemies.length}`;
    $('#mission-timer').textContent = clock(state.elapsed);
  } else $('#change-view').textContent = `视角：${{ top: '俯视', chase: '追尾', cockpit: '座舱' }[scene.view]}`;
}
function finishCombat() {
  resultShown = true; clearInput(); const state = combat.state, won = state.status === 'won';
  $('#result-panel').hidden = false;
  $('#result-eyebrow').textContent = won ? 'SORTIE COMPLETE' : 'AIRCRAFT LOST';
  $('#result-title').textContent = won ? '任务完成。平安归航。' : '这次航程，到此为止。';
  $('#result-description').textContent = won ? `你完成了${selectedMission().name || selectedMission().title}，在海峡上空守住了自己的航线。` : '重新选择战术，下一次出击仍有机会。';
  $('#result-score').textContent = String(state.score); $('#result-kills').textContent = String(state.player.kills);
  $('#result-accuracy').textContent = `${state.player.shots ? Math.min(100, Math.round(state.player.hits / state.player.shots * 100)) : 0}%`;
  const record = saveRecord(selection, state.score, safeStore());
  $('#result-best').textContent = record.saved ? `${record.isNew ? '新的个人纪录 · ' : '本任务最佳 · '}${record.best} 分` : '本次成绩已结算；浏览器未允许保存本地纪录。';
}

function togglePause(force) {
  if (!scene || resultShown) return;
  paused = typeof force === 'boolean' ? force : !paused;
  $('#pause-panel').hidden = !paused;
  $('#game-pause').textContent = paused ? '▶' : 'Ⅱ';
  $('#game-pause').setAttribute('aria-label', paused ? '继续游戏' : '暂停游戏');
  clearInput(); lastFrame = performance.now();
}
$('#game-pause').addEventListener('click', () => togglePause());
$('#game-exit').addEventListener('click', () => togglePause(true));
$('#resume-game').addEventListener('click', () => togglePause(false));
$('#restart-game').addEventListener('click', () => startGame(mode));
$('#play-again').addEventListener('click', () => startGame('combat'));
$('#leave-game').addEventListener('click', () => { location.hash = 'home'; });
$('#back-hangar').addEventListener('click', () => { location.hash = 'hangar'; });
$('#change-view').addEventListener('click', () => scene?.toggleView());
$('#change-time').addEventListener('click', () => {
  if (!scene) return;
  params.timeOfDay = ['day', 'sunset', 'night'][(['day', 'sunset', 'night'].indexOf(params.timeOfDay) + 1) % 3]; scene.setParams(params);
  $('#change-time').textContent = `时段：${{ day: '白昼', sunset: '黄昏', night: '夜航' }[params.timeOfDay]}`;
});
$('#change-free-skin').addEventListener('click', () => { freeSkinIndex = (freeSkinIndex + 1) % freeSkins.length; Object.assign(params, freeSkins[freeSkinIndex]); scene.setParams(params); $('#change-free-skin').textContent = `涂装：${freeSkins[freeSkinIndex].name}`; });
$('#sound-toggle').addEventListener('click', () => { const on = audio.setEnabled(!audio.enabled); $('#sound-toggle').textContent = on ? '声音开' : '声音关'; $('#sound-toggle').setAttribute('aria-pressed', String(on)); });

const flightKeys = new Set(['KeyA','KeyD','KeyW','KeyS','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', event => {
  if (!scene || event.metaKey || event.ctrlKey || event.altKey || event.target.matches('input,textarea,select')) return;
  if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (paused || resultShown) return;
  if (flightKeys.has(event.code)) { event.preventDefault(); held.add(event.code); }
  if (event.code === 'Space' && mode === 'free' && !event.repeat) scene.toggleView();
});
window.addEventListener('keyup', event => { held.delete(event.code); });
window.addEventListener('blur', () => { clearInput(); if (scene) togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (scene) togglePause(true); stopHero(); } else if (mode === 'home') startHero(); });
canvas.addEventListener('pointermove', event => {
  if (!scene || paused || mode !== 'free' || event.pointerType === 'touch') return;
  const rect = canvas.getBoundingClientRect(); scene.pointerMove((event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height);
});
canvas.addEventListener('pointerleave', () => { if (mode === 'free') scene?.pointerLeave(); });
canvas.addEventListener('pointerdown', event => {
  if (!scene || paused || resultShown || event.pointerType === 'touch' || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId); pointerPressed = true; if (mode === 'free') scene.press(); event.preventDefault();
});
function releasePointer() { if (pointerPressed && mode === 'free') scene?.release(); pointerPressed = false; }
canvas.addEventListener('pointerup', releasePointer); canvas.addEventListener('pointercancel', releasePointer); canvas.addEventListener('lostpointercapture', releasePointer);
canvas.addEventListener('contextmenu', event => event.preventDefault());

function bindHeldButton(selector, key) {
  const button = $(selector);
  button.addEventListener('pointerdown', event => { if (paused || resultShown) return; button.setPointerCapture(event.pointerId); touch[key] = true; button.classList.add('held'); event.preventDefault(); });
  const release = () => { touch[key] = false; button.classList.remove('held'); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
}
bindHeldButton('#touch-fire', 'fire'); bindHeldButton('#touch-boost', 'boost');
$('#touch-roll').addEventListener('click', () => { if (scene && !paused) { scene.press(); scene.release(); } });
function updateJoystick(event) {
  const r = $('#joystick').getBoundingClientRect(); const radius = r.width * .35;
  let x = (event.clientX - r.left - r.width / 2) / radius, y = (event.clientY - r.top - r.height / 2) / radius;
  const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
  joystick.x = Math.abs(x) < .08 ? 0 : x; joystick.y = Math.abs(y) < .08 ? 0 : y;
  $('#joystick-thumb').style.transform = `translate(${x * radius}px,${y * radius}px)`;
}
$('#joystick').addEventListener('pointerdown', event => { if (paused || resultShown || joystick.pointer !== null) return; joystick.pointer = event.pointerId; $('#joystick').setPointerCapture(event.pointerId); updateJoystick(event); event.preventDefault(); });
$('#joystick').addEventListener('pointermove', event => { if (joystick.pointer === event.pointerId) { updateJoystick(event); event.preventDefault(); } });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#joystick').addEventListener(type, event => { if (joystick.pointer !== event.pointerId) return; joystick.pointer = null; joystick.x = 0; joystick.y = 0; $('#joystick-thumb').style.transform = ''; });

const help = `<h2 class="info-title">飞行操作指南</h2><section class="info-section"><h3>净空体验</h3><p>移动鼠标选择航向，点击翻滚，按住鼠标或 <kbd>Shift</kbd> 加速。<kbd>空格</kbd> 在俯视、追尾和座舱之间切换。也可以用 <kbd>WASD</kbd> 或方向键操控；保留原版飞行杆方向：向下拉升、向上俯冲。</p></section><section class="info-section"><h3>1940 · 海峡空战</h3><p><kbd>A D</kbd> / <kbd>← →</kbd> 转向，<kbd>W S</kbd> / <kbd>↑ ↓</kbd> 升降。按住 <kbd>空格</kbd> 或鼠标左键射击，<kbd>Shift</kbd> 加速。把前方瞄准环指向敌机；连续射击会过热，短点射更有效。</p><p>雷达中心是你的位置，红点是敌机。敌机会追击、开火和脱离，留意机体耐久。<kbd>P</kbd> / <kbd>Esc</kbd> 暂停。</p></section><section class="info-section"><h3>手机与平板</h3><p>左侧摇杆转向与升降，右侧按钮射击和加速；净空模式提供翻滚按钮。横屏能获得更宽的视野。切到后台会自动暂停。</p></section>`;
const credits = `<h2 class="info-title">关于 Airplanes</h2><section class="info-section"><h3>两种飞行体验</h3><p>净空体验迁移自 Dash 的 Fly / fighter 演示。海峡空战在这个像素渲染基础上加入独立的二战飞机、涂装、战斗系统与任务。</p></section><section class="info-section"><h3>来源与署名</h3><p>原版作者：Dash / @creativedash。<a href="https://remix.ui8.ai/fly" target="_blank" rel="noreferrer">原分享页</a> · <a href="./THIRD_PARTY_NOTICES.md" target="_blank">第三方说明</a></p><p>Airplanes 新增玩法、界面、程序化机型与涂装由 ForceMind 项目维护。原版源码保留其作者权利与来源，不被重新标记为本项目原创。</p></section><section class="info-section"><h3>首版范围</h3><p>本版提供单人对 AI 的街机空战。机型与涂装为二战历史风格演绎，任务为虚构情景；不包含联网多人或精确飞行模拟。</p><a href="https://github.com/ForceMind/Airplanes" target="_blank" rel="noreferrer">访问项目仓库 ↗</a></section>`;
$$('[data-action="help"]').forEach(button => button.addEventListener('click', () => { $('#info-content').innerHTML = help; $('#info-dialog').showModal(); }));
$$('[data-action="credits"]').forEach(button => button.addEventListener('click', () => { $('#info-content').innerHTML = credits; $('#info-dialog').showModal(); }));
$('.dialog-close').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const r = $('#info-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#info-dialog').close(); } });

try { updateHangar(); drawBattleCard(); route(); } catch (error) { reportError(error); }
