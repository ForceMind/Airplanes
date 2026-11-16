/**
 * Original procedural 1940 airframes. Metres are sampled into five voxels;
 * small details are reconstructed, not scans of a surviving aircraft.
 * Local axes: x starboard/right, y forward/nose, z up. See AIRCRAFT_REFERENCE.
 */
import { getAircraftSpec, spitfireLeadingEdge, bf109LeadingEdge } from './aircraft-specs.js';
import { createPropellerVoxels, propellerPhase } from '../engine/propeller.js';

const skin = (id, name, description, body, accent, canopy, underside, marking) => ({
  id, name, description, colors: { body, accent, canopy, underside, marking },
});

export const AIRCRAFT = [
  {
    id: 'spitfire', faction: 'raf', name: 'Spitfire Mk Ia', subtitle: '皇家空军 · 1940 年喷火 Mk Ia',
    description: '椭圆 A 型机翼、Merlin 发动机、三叶螺旋桨；八挺 .303 机枪分列两翼。',
    skins: [
      skin('raf-classic', '英伦绿棕', '1940 年风格：深绿与深土色上表面、Sky 色机腹、红蓝上翼圆徽。', '#556043', '#80654b', '#82b9c8', '#b8bca0', '#b2b69c'),
      skin('raf-coastal', '海岸灰绿', '创意涂装 · 海雾灰与深绿，沿用 Mk Ia 机体。', '#7c8c91', '#52695f', '#8dced8', '#bac7c6', '#e1ddd0'),
      skin('raf-night', '午夜巡航', '创意涂装 · 深蓝灰夜航配色，非 1940 年指定部队复原。', '#354450', '#50515a', '#70acbf', '#25323e', '#aeb6b4'),
      skin('raf-silver', '纪念银翼', '创意涂装 · 银色机体与深灰拼接的纪念配色。', '#bdc6c9', '#8c969f', '#73aabe', '#8998a2', '#dddcd2'),
    ],
  },
  {
    id: 'bf109', faction: 'luftwaffe', name: 'Bf 109 E-4', subtitle: '德国空军 · 1940 年 Bf 109 E-4',
    description: '直线梯形翼、方框座舱、翼下双散热器；机鼻双 MG 17 与两翼 20 毫米机炮。',
    skins: [
      skin('luftwaffe-grey', '灰绿猎隼', '1940 年风格：灰绿拼块、浅蓝机腹、黄色机罩与方向舵；不指定中队。', '#8a927c', '#475447', '#95c0c7', '#afc4c8', '#dfb943'),
      skin('luftwaffe-desert', '沙漠黄沙', '创意涂装 · 沙黄与褐色斑纹，不作为 1940 年英伦空战史实。', '#c2a470', '#92794f', '#91bfc5', '#b9c4ba', '#e5bc4c'),
      skin('luftwaffe-winter', '冬季白霜', '创意涂装 · 白灰底色与稀疏灰绿斑纹，沿用 E-4 机体。', '#d6dbd5', '#8e9b94', '#8ebfce', '#b6c4c9', '#e1b744'),
      skin('luftwaffe-night', '夜雾石墨', '创意涂装 · 石墨灰与暗蓝的夜航配色。', '#424b52', '#2d3944', '#72a1b0', '#313c46', '#c6a04e'),
    ],
  },
];

const cache = new Map();
const clampByte = n => Math.max(0, Math.min(255, Math.round(n)));
const pack = (r, g, b) => ((255 << 24) | (clampByte(b) << 16) | (clampByte(g) << 8) | clampByte(r)) >>> 0;
function shaded(hex, amount = 1) {
  return pack(parseInt(hex.slice(1, 3), 16) * amount,
    parseInt(hex.slice(3, 5), 16) * amount, parseInt(hex.slice(5, 7), 16) * amount);
}

export function getAircraft(id) {
  return AIRCRAFT.find(a => a.id === id) || AIRCRAFT[0];
}
export function getSkin(aircraftId, skinId) {
  const aircraft = getAircraft(aircraftId);
  return aircraft.skins.find(s => s.id === skinId) || aircraft.skins[0];
}

function buildModel(aircraft, selectedSkin) {
  const spec = getAircraftSpec(aircraft.id);
  const isRAF = aircraft.faction === 'raf';
  const colors = selectedSkin.colors;
  const span = Math.round(spec.dimensions.wingspanMetres * spec.unitsPerMetre);
  const length = Math.round(spec.dimensions.lengthMetres * spec.unitsPerMetre);
  const minX = -(span - 1) / 2, minY = -(length - 1) / 2;
  const maxX = -minX, maxY = -minY;
  const cells = new Map();
  const put = (x, y, z, color, part) => {
    const v = { x, y, z, color: color >>> 0, part };
    cells.set(`${x},${y},${z}`, v);
  };
  const paint = (x, y, z, part = 'airframe') => put(x, y, z, topColor(x, y, z), part);
  const topColor = (x, y, z) => {
    // RAF curved fields; German straight splinter fields. They are original
    // patterns rather than invented squadron markings or a copied skin atlas.
    const band = isRAF
      ? Math.sin(x * .21 + y * .16) + Math.sin(y * .39 - x * .09) * .55
      : Math.sin(Math.floor((x + y * .65) / 10) * 2.9 + Math.floor((y - x * .16) / 9));
    const base = z < 0 ? colors.underside : band > .18 ? colors.accent : colors.body;
    return shaded(base, z < 0 ? .83 : .93 + Math.min(.14, z * .025) + (x < 0 ? .025 : -.015));
  };

  // Main planes use their full real span, independently of fuselage length.
  // A-wing elliptical front/rear edges versus the E-wing's straight taper.
  for (let x = minX; x <= maxX; x++) {
    const ax = Math.abs(x);
    const front = isRAF ? spitfireLeadingEdge(x) : bf109LeadingEdge(x);
    const back = isRAF
      ? 2.2 - ax * .08 - 6.65 * Math.sqrt(Math.max(0, 1 - (x / (11.23 * 2.5)) ** 2))
      : -4.5 + ax * .16;
    for (let y = minY; y <= maxY; y++) {
      if (y < back || y > front) continue;
      paint(x, y, 0, 'wing');
      // Fine tips; the low main plane has a thin underside, not a thick slab.
      if (ax < maxX - 2 && y > back + .8 && y < front - .6) paint(x, y, -1, 'wing');
    }
  }

  // Distinct horizontal stabilisers: rounded Spitfire versus braced E-4 taper.
  for (let x = -8; x <= 8; x++) {
    const ax = Math.abs(x);
    if (!isRAF && ax > 7) continue;
    const arc = Math.sqrt(Math.max(0, 1 - (x / 8.4) ** 2));
    const front = isRAF ? -17.6 + 2.8 * arc : -14.8 - ax * .32;
    const back = isRAF ? -17.6 - 3.65 * arc : -21.2 + ax * .27;
    for (let y = minY; y <= maxY; y++) {
      if (y >= back && y <= front) paint(x, y, isRAF ? 1 : 2, 'tailplane');
    }
  }

  // Slender, long inline-engine fuselages. The inverted DB 601 has a deeper
  // lower cowling; the Merlin's upper line and rear spine are more rounded.
  const bodyEnd = isRAF ? 19.5 : 18.5;
  for (let y = minY; y <= bodyEnd; y++) {
    let halfWidth, halfHeight, centreZ;
    if (y < -6) {
      const t = (y - minY) / (-6 - minY);
      halfWidth = .55 + t * (isRAF ? 2.1 : 1.8);
      halfHeight = .75 + t * 2.05;
      centreZ = isRAF ? .7 : .6;
    } else if (y < 8) {
      halfWidth = isRAF ? 2.65 : 2.4;
      halfHeight = isRAF ? 3 : 2.8;
      centreZ = isRAF ? .35 : -.05;
    } else {
      const t = (y - 8) / (bodyEnd - 8);
      halfWidth = (isRAF ? 2.55 : 2.4) - t * .95;
      halfHeight = (isRAF ? 2.65 : 2.8) - t * 1.1;
      centreZ = isRAF ? .2 : -.25;
    }
    for (let x = minX; x <= maxX; x++) {
      if (Math.abs(x) > halfWidth) continue;
      for (let z = -3; z <= 4; z++) {
        const profile = (x / halfWidth) ** 2 + ((z - centreZ) / halfHeight) ** 2;
        if (profile > 1.12) continue;
        let color = topColor(x, y, z);
        if (!isRAF && y >= 12.5) color = shaded(colors.marking, .83 + (z + 3) * .035);
        put(x, y, z, color, 'fuselage');
      }
    }
  }

  // Mk Ia's rounded hood and E-4's framed, flat-top canopy are separate shapes.
  const canopyBack = isRAF ? -5.5 : -4.5;
  const canopyFront = isRAF ? 3.5 : 3.5;
  for (let y = canopyBack; y <= canopyFront; y++) {
    const windscreen = y >= canopyFront - 1;
    const cap = isRAF ? (windscreen || y === canopyBack ? 4 : 5) : (windscreen ? 4 : 5);
    for (let x = -1.5; x <= 1.5; x++) {
      for (let z = 3; z <= cap; z++) {
        if (isRAF && z === 5 && Math.abs(x) > .5) continue;
        const frame = y === canopyBack || y === canopyFront || (!isRAF && (y === -1.5 || Math.abs(x) === 1.5 && z === 5));
        const glass = x < 0 && z >= 4 ? shaded(colors.canopy, 1.17) : shaded(colors.canopy, .82 + (z - 3) * .1);
        put(x, y, z, frame ? shaded(colors.body, .63) : glass, 'canopy');
      }
    }
  }
  // Rear fixed glazing and the early radio mast; no later bubble/Erla hood.
  for (let y = -7.5; y < canopyBack; y++) put(0, y, 3, shaded(colors.canopy, .65), 'canopy');
  for (let z = 4; z <= 6; z++) put(0, isRAF ? -7.5 : -6.5, z, shaded(colors.body, .63), 'mast');

  // Rounded rudder/fin with the E-4's narrower, taller upright silhouette.
  for (let z = 2; z <= (isRAF ? 7 : 8); z++) {
    const t = (z - 2) / (isRAF ? 5 : 6);
    const start = minY + (isRAF ? Math.round(t * 2) : Math.round(t * 1.5));
    const end = isRAF ? -14.2 - t * 4 : -15.5 - t * 3;
    for (let y = minY; y <= maxY; y++) {
      if (y < start || y > end) continue;
      let color = topColor(0, y, z);
      if (!isRAF && y <= -18.5) color = shaded(colors.marking, .94);
      if (isRAF && y >= -19.5 && y <= -17.5 && z >= 3 && z <= 6) {
        color = y < -18.5 ? pack(38, 55, 77) : y < -17.5 ? pack(223, 221, 200) : pack(161, 54, 45);
      }
      put(0, y, z, color, 'fin');
    }
  }

  const darkMetal = pack(53, 49, 44), exhaustLip = pack(105, 91, 77);
  // Short lateral exhausts, never a rear jet nozzle or a permanent flame.
  for (const side of [-1, 1]) {
    const exhaustYs = isRAF ? [7.5, 10, 12.5] : [7.3, 8.7, 10.1, 11.5, 12.9, 14.3];
    for (const y of exhaustYs) {
      put(side * 2.5, y, isRAF ? 1 : 0, exhaustLip, 'exhaust');
      put(side * 3.05, y - .2, isRAF ? 1 : 0, darkMetal, 'exhaust');
    }
  }

  // Mk I: starboard radiator and smaller port oil cooler. E-4: paired wing
  // radiator baths plus a chin oil cooler and asymmetric supercharger intake.
  const radiator = (cx, halfWidth, yBack, yFront, depth, part) => {
    for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
      for (let y = yBack; y <= yFront; y++) {
        for (let z = -depth; z <= -1; z++) {
          put(x, y, z, y === yFront && z <= -2 ? darkMetal : shaded(colors.underside, .74 + (z + depth) * .045), part);
        }
      }
    }
  };
  if (isRAF) {
    radiator(7, 1.5, -4.5, 1.5, 3, 'radiator');
    radiator(-7, 1, -2.5, .5, 2, 'oil-cooler');
    radiator(0, .5, 4.5, 7.5, 3, 'carburettor-intake');
  } else {
    radiator(-7.5, 2, -4.5, .5, 3, 'radiator');
    radiator(7.5, 2, -4.5, .5, 3, 'radiator');
    radiator(0, .5, 10.5, 14.5, 4, 'oil-cooler');
    for (let y = 5.5; y <= 8.5; y++) put(-3, y, 0, y === 8.5 ? darkMetal : shaded(colors.body, .8), 'supercharger-intake');
    for (const side of [-1, 1]) {
      for (let step = 0; step <= 5; step++) {
        put(side * (1.3 + step * .65), -17.5, -1 + step * .5, shaded(colors.body, .7), 'tail-strut');
      }
    }
  }

  // Recognition marks are paint on actual wing cells. RAF upper-wing Type B
  // is red/blue; fuselage circles have the separate white/yellow rings.
  for (const v of cells.values()) {
    if (v.part !== 'wing' || v.z !== 0) continue;
    const dx = Math.abs(v.x) - (isRAF ? 19 : 17), dy = v.y - (isRAF ? .5 : 1.5);
    if (isRAF) {
      const r = Math.hypot(dx, dy);
      if (r <= 3.1) v.color = r < 1.25 ? pack(162, 52, 44) : pack(32, 48, 74);
    } else if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2.2 && Math.min(Math.abs(dx), Math.abs(dy)) <= 1.15) {
      v.color = Math.abs(dx) <= .55 || Math.abs(dy) <= .55 ? pack(32, 36, 34) : pack(220, 220, 204);
    }
  }
  if (isRAF) {
    for (const v of cells.values()) {
      if (v.part !== 'fuselage' || Math.abs(v.x) < 1.4 || v.y < -12.5 || v.y > -8.5) continue;
      const r = Math.hypot(v.y + 10.5, v.z - 1.4);
      if (r > 2.1) continue;
      v.color = r < .75 ? pack(163, 53, 43) : r < 1.15 ? pack(225, 221, 203) : r < 1.75 ? pack(37, 52, 78) : pack(210, 179, 73);
    }
  }

  // Gun geometry and combat share these exact muzzle coordinates. Brownings
  // are flush ports; E-4's MG FF/M wing cannon project ahead of the leading edge.
  for (const mount of spec.gunMounts) {
    if (mount.kind === 'cannon') {
      for (let y = mount.y - 2; y < mount.y; y += .5) put(mount.x, y, mount.z, darkMetal, 'cannon-barrel');
      put(mount.x, mount.y - 1.5, mount.z + .5, shaded(colors.body, .75), 'cannon-fairing');
    } else if (!isRAF) {
      for (let y = mount.y - 3; y < mount.y; y += .5) put(mount.x, y, mount.z, shaded(colors.marking, .5), 'gun-trough');
    }
    put(mount.x, mount.y, mount.z, pack(24, 27, 25), 'gun-port');
  }

  // Spinner is static; all three blades live in the independently rotated mesh.
  const hub = spec.propeller;
  for (let y = hub.y - .6; y < maxY; y += .65) {
    const t = (y - (hub.y - .6)) / (maxY - (hub.y - .6));
    const radius = hub.hubRadius * Math.sqrt(Math.max(0, 1 - t));
    for (let x = -1.5; x <= 1.5; x++) {
      for (let z = -1; z <= 1; z++) {
        if (x * x + (z - hub.z) ** 2 <= radius * radius) put(x, y, z, shaded(colors.body, 1.02), 'spinner');
      }
    }
  }
  put(0, maxY, hub.z, shaded(colors.body, 1.04), 'spinner');

  const voxels = [...cells.values()];
  const bounds = {
    minX: Math.min(...voxels.map(v => v.x)), maxX: Math.max(...voxels.map(v => v.x)),
    minY: Math.min(...voxels.map(v => v.y)), maxY: Math.max(...voxels.map(v => v.y)),
    minZ: Math.min(...voxels.map(v => v.z)), maxZ: Math.max(...voxels.map(v => v.z)),
  };
  return Object.freeze({
    id: aircraft.id, faction: aircraft.faction, skinId: selectedSkin.id,
    width: bounds.maxX - bounds.minX + 1,
    length: bounds.maxY - bounds.minY + 1,
    height: bounds.maxZ - bounds.minZ + 1,
    pivotY: 0, pivotK: 0, bounds: Object.freeze(bounds),
    modelScale: spec.modelScale, spec, gunMounts: spec.gunMounts,
    propeller: spec.propeller,
    voxels: Object.freeze(voxels.map(Object.freeze)),
  });
}

/** Cached, immutable geometry. Invalid skins fall back within their aircraft. */
export function createAircraftModel(aircraftId, skinId) {
  const aircraft = getAircraft(aircraftId);
  const selectedSkin = getSkin(aircraft.id, skinId);
  const key = `${aircraft.id}/${selectedSkin.id}`;
  if (!cache.has(key)) cache.set(key, buildModel(aircraft, selectedSkin));
  return cache.get(key);
}

/**
 * Offline hangar preview. Caller owns DPR and the animation loop. `time` is in
 * seconds; omit it for a still three-blade prop. Optional showHardpoints marks
 * real muzzle positions: gold = machine gun, orange = cannon.
 */
export function drawAircraftPreview(ctx, model, options = {}) {
  const width = options.width || ctx.canvas.width, height = options.height || ctx.canvas.height;
  const rotation = options.rotation ?? -.48, elevation = options.elevation ?? .78;
  const cs = Math.cos(rotation), sn = Math.sin(rotation);
  const phase = Number.isFinite(options.time)
    ? propellerPhase(options.time, options.speed ?? 92, model.propeller)
    : options.propellerPhase ?? .2;
  const project = v => {
    const across = v.x * cs + v.y * sn, forward = -v.x * sn + v.y * cs;
    return { x: across, y: -(forward * elevation + v.z * Math.sqrt(Math.max(0, 1 - elevation * elevation))),
      depth: forward * Math.sqrt(Math.max(0, 1 - elevation * elevation)) - v.z * elevation, color: v.color };
  };
  const draw = [...model.voxels, ...createPropellerVoxels(model.propeller, phase)].map(project);
  // Fit the full rotational envelope, so animating the prop never pumps scale.
  const fit = [...model.voxels, ...[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(a => ({
    x: model.propeller.x + Math.cos(a) * model.propeller.radius,
    y: model.propeller.y, z: model.propeller.z + Math.sin(a) * model.propeller.radius,
  }))].map(project);
  const xs = fit.map(v => v.x), ys = fit.map(v => v.y);
  const minPX = Math.min(...xs), maxPX = Math.max(...xs), minPY = Math.min(...ys), maxPY = Math.max(...ys);
  const size = options.scale ?? Math.max(.1, Math.min((width - 28) / (maxPX - minPX + 2), (height - 28) / (maxPY - minPY + 2)));
  const centreX = (minPX + maxPX) / 2, centreY = (minPY + maxPY) / 2;
  const screen = p => ({ x: width / 2 + (p.x - centreX) * size, y: height / 2 + (p.y - centreY) * size });
  // Camera is above the aft quarter; smaller depth is nearer.
  draw.sort((a, b) => b.depth - a.depth);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  const pixel = Math.max(1, Math.ceil(size * 1.08));
  let lastColor = -1;
  for (const p of draw) {
    if (p.color !== lastColor) {
      ctx.fillStyle = `rgb(${p.color & 255},${(p.color >>> 8) & 255},${(p.color >>> 16) & 255})`;
      lastColor = p.color;
    }
    const point = screen(p);
    ctx.fillRect(Math.round(point.x - pixel / 2), Math.round(point.y - pixel / 2), pixel, pixel);
  }
  if (options.showHardpoints) {
    const marker = Math.max(3, Math.min(6, Math.round(size * 1.25)));
    for (const mount of model.gunMounts) {
      const p = screen(project(mount));
      ctx.fillStyle = '#162329';
      ctx.fillRect(Math.round(p.x - marker / 2) - 1, Math.round(p.y - marker / 2) - 1, marker + 2, marker + 2);
      ctx.fillStyle = mount.kind === 'cannon' ? '#ff874e' : '#f5d97b';
      ctx.fillRect(Math.round(p.x - marker / 2), Math.round(p.y - marker / 2), marker, marker);
    }
  }
  ctx.restore();
}
