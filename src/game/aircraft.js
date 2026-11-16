/**
 * Airplanes original aircraft art, 2026.
 * Procedural voxel sketches inspired by WWII silhouettes; not museum replicas.
 * No geometry or palette data from the upstream modern fighter is used here.
 * Coordinates are centred: x right, y forward (nose), z up.
 */

const skin = (id, name, description, body, accent, canopy, underside, marking) => ({
  id, name, description, colors: { body, accent, canopy, underside, marking },
});

export const AIRCRAFT = [
  {
    id: 'spitfire', faction: 'raf', name: 'Spitfire', subtitle: '皇家空军 · 喷火式',
    description: '椭圆机翼与轻盈机身。以二战机型轮廓为灵感的原创像素飞机。',
    skins: [
      skin('raf-classic', '英伦绿棕', '草绿与褐色迷彩，浅色机腹。', '#64704a', '#846951', '#82b9c8', '#b3bba3', '#d9dfcf'),
      skin('raf-coastal', '海岸灰绿', '海雾灰与深绿，低调的海岸巡航涂装。', '#7c8c91', '#52695f', '#8dced8', '#bac7c6', '#e1ddd0'),
      skin('raf-night', '午夜巡航', '深蓝灰机身，保留机翼圆徽。', '#354450', '#50515a', '#70acbf', '#25323e', '#aeb6b4'),
      skin('raf-silver', '纪念银翼', '银色机体与深灰拼接的纪念涂装。', '#bdc6c9', '#8c969f', '#73aabe', '#8998a2', '#dddcd2'),
    ],
  },
  {
    id: 'bf109', faction: 'luftwaffe', name: 'Bf 109', subtitle: '德国空军 · Bf 109',
    description: '长机首与收窄梯形机翼。采用独立螺旋桨机体和普通十字识别标记。',
    skins: [
      skin('luftwaffe-grey', '灰绿猎隼', '灰绿迷彩、浅蓝机腹与黄色识别带。', '#6f7866', '#4c5b52', '#95c0c7', '#afc4c8', '#e9bd45'),
      skin('luftwaffe-desert', '沙漠黄沙', '沙黄机体搭配褐色斑纹。', '#c2a470', '#92794f', '#91bfc5', '#b9c4ba', '#e5bc4c'),
      skin('luftwaffe-winter', '冬季白霜', '白灰底色搭配稀疏的灰绿斑纹。', '#d6dbd5', '#8e9b94', '#8ebfce', '#b6c4c9', '#e1b744'),
      skin('luftwaffe-night', '夜雾石墨', '石墨灰与暗蓝的夜航风格涂装。', '#424b52', '#2d3944', '#72a1b0', '#313c46', '#c6a04e'),
    ],
  },
];

const cache = new Map();
const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Packed RGBA suitable for the upstream little-endian Uint32 pixel buffer. */
function pack(r, g, b) {
  return ((255 << 24) | (clampByte(b) << 16) | (clampByte(g) << 8) | clampByte(r)) >>> 0;
}

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function shaded(hex, amount = 1) {
  const c = rgb(hex);
  return pack(c[0] * amount, c[1] * amount, c[2] * amount);
}

export function getAircraft(id) {
  return AIRCRAFT.find((a) => a.id === id) || AIRCRAFT[0];
}

export function getSkin(aircraftId, skinId) {
  const aircraft = getAircraft(aircraftId);
  return aircraft.skins.find((s) => s.id === skinId) || aircraft.skins[0];
}

function buildModel(aircraft, selectedSkin) {
  const isRAF = aircraft.faction === 'raf';
  const colors = selectedSkin.colors;
  const cells = new Map();
  const put = (x, y, z, color) => cells.set(`${x},${y},${z}`, { x, y, z, color: color >>> 0 });
  const topColor = (x, y, z) => {
    // Two analytic colour bands keep the texture original and deterministic.
    const pattern = Math.sin(x * 0.37 + y * 0.29) + Math.sin(y * 0.63 - x * 0.11) * 0.45;
    const base = z < 0 ? colors.underside : pattern > 0.28 ? colors.accent : colors.body;
    return shaded(base, z < 0 ? 0.79 : 0.91 + Math.min(0.16, z * 0.033) + (x < 0 ? 0.035 : -0.015));
  };

  // Main wings: an elliptical planform for Spitfire, tapered straight edges for Bf 109.
  const span = isRAF ? 18 : 16;
  for (let x = -span; x <= span; x++) {
    const ax = Math.abs(x);
    let front, back;
    if (isRAF) {
      const chord = 7.1 * Math.sqrt(Math.max(0, 1 - (ax / 18.2) ** 2));
      const centre = 1.8 - ax * 0.13;
      front = centre + chord;
      back = centre - chord;
    } else {
      front = 8.5 - ax * 0.47;
      back = -5.2 + ax * 0.095;
    }
    for (let y = Math.ceil(back); y <= Math.floor(front); y++) {
      for (let z = ax > span - 3 ? 0 : -1; z <= 1; z++) {
        put(x, y, z, topColor(x, y, z));
      }
    }
  }

  // The tailplane is swept and shorter than the main wings.
  const tailSpan = isRAF ? 8 : 7;
  for (let x = -tailSpan; x <= tailSpan; x++) {
    const ax = Math.abs(x);
    const front = (isRAF ? -11.8 : -12.3) - ax * 0.29;
    const back = -18.6 + ax * 0.22;
    for (let y = Math.ceil(back); y <= Math.floor(front); y++) {
      for (let z = 0; z <= 1; z++) put(x, y, z, topColor(x, y, z));
    }
  }

  // Elliptical fuselage cross-sections taper independently at the tail and spinner.
  const tailEnd = isRAF ? -20 : -21;
  const noseEnd = isRAF ? 20 : 22;
  for (let y = tailEnd; y <= noseEnd; y++) {
    let halfWidth;
    if (y < -5) halfWidth = 0.7 + (y - tailEnd) / (-5 - tailEnd) * 1.8;
    else if (y < 10) halfWidth = isRAF ? 2.65 : 2.3;
    else halfWidth = (isRAF ? 2.5 : 2.2) - ((y - 10) / (noseEnd - 10)) * 1.35;
    const halfHeight = y < -9 ? 1.4 : y > 16 ? 1.85 : 2.5;
    for (let x = -3; x <= 3; x++) {
      for (let z = -2; z <= 3; z++) {
        if ((x / halfWidth) ** 2 + ((z - 0.2) / halfHeight) ** 2 > 1.13) continue;
        let color = topColor(x, y, z);
        if (y >= -12 && y <= -10 && z >= 0) color = shaded(colors.marking, 0.95);
        if (!isRAF && y >= 16 && z >= 0) color = shaded(colors.marking, 0.86 + z * 0.04);
        if (z >= 2 && y >= 11 && y <= 15 && Math.abs(x) === 2) color = pack(41, 40, 37); // exhausts
        put(x, y, z, color);
      }
    }
  }

  // Cockpit glass: the Bf 109 has a more angular, aft-set canopy.
  const cabinFront = isRAF ? 7 : 4;
  const cabinBack = isRAF ? -1 : -4;
  for (let y = cabinBack; y <= cabinFront; y++) {
    for (let x = -1; x <= 1; x++) {
      for (let z = 3; z <= 5; z++) {
        if (z === 5 && (Math.abs(x) > 0 || y === cabinBack || y === cabinFront)) continue;
        const frame = y === cabinBack || y === cabinFront || (!isRAF && y === 0);
        let color = frame ? shaded(colors.body, 0.78) : shaded(colors.canopy, 0.78 + (z - 3) * 0.17);
        if (!frame && x === -1 && z === 4 && y > cabinBack + 1) color = pack(206, 227, 222);
        put(x, y, z, color);
      }
    }
  }

  // A real vertical fin rises above the tail, as opposed to a flat sprite outline.
  for (let z = 2; z <= (isRAF ? 6 : 7); z++) {
    const start = (isRAF ? -19 : -20) + Math.floor((z - 2) * 0.28);
    const end = -12 - Math.ceil((z - 2) * 0.64);
    for (let y = start; y <= end; y++) {
      put(0, y, z, topColor(-1, y, z));
      if (z <= 3) {
        put(-1, y, z, topColor(-1, y, z));
        put(1, y, z, topColor(1, y, z));
      }
    }
  }

  // Wing identifiers are painted on the upper slice only.
  for (const side of [-1, 1]) {
    const cx = side * (isRAF ? 11 : 10);
    const cy = isRAF ? 1 : -1;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const key = `${cx + dx},${cy + dy},1`;
        if (!cells.has(key)) continue;
        if (isRAF) {
          const r = Math.hypot(dx, dy);
          if (r <= 2.7) put(cx + dx, cy + dy, 1, r < 1.05 ? pack(176, 55, 48) : r < 1.9 ? pack(224, 220, 194) : pack(39, 64, 94));
        } else {
          // Ordinary aircraft-recognition cross, with a light border.
          if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2 && Math.min(Math.abs(dx), Math.abs(dy)) <= 1) {
            put(cx + dx, cy + dy, 1, dx === 0 || dy === 0 ? pack(35, 39, 40) : pack(218, 220, 207));
          }
        }
      }
    }
  }

  // Nose spinner and two crossed blades visibly distinguish propeller aircraft.
  const propY = noseEnd + 1;
  for (let x = -6; x <= 6; x++) {
    if (Math.abs(x) < 2) continue;
    put(x, propY, 0, Math.abs(x) >= 5 ? pack(224, 192, 97) : pack(54, 59, 59));
    put(x, propY, 1, pack(93, 98, 94));
  }
  for (let z = -4; z <= 5; z++) {
    if (Math.abs(z) < 2) continue;
    put(0, propY, z, Math.abs(z) >= 4 ? pack(224, 192, 97) : pack(54, 59, 59));
  }
  for (let y = noseEnd; y <= propY + 1; y++) {
    const radius = y === propY + 1 ? 0 : 1;
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        put(x, y, z, shaded(isRAF ? colors.body : colors.marking, 1.05));
      }
    }
  }

  const voxels = [...cells.values()];
  const xs = voxels.map((v) => v.x), ys = voxels.map((v) => v.y), zs = voxels.map((v) => v.z);
  const bounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
  return Object.freeze({
    id: aircraft.id, faction: aircraft.faction, skinId: selectedSkin.id,
    width: bounds.maxX - bounds.minX + 1,
    length: bounds.maxY - bounds.minY + 1,
    height: bounds.maxZ - bounds.minZ + 1,
    pivotY: 0, pivotK: 0, bounds: Object.freeze(bounds),
    propeller: Object.freeze({ x: 0, y: propY, z: 0, radius: 6 }),
    voxels: Object.freeze(voxels.map(Object.freeze)),
  });
}

/** Cached, immutable geometry. An invalid skin falls back within its own aircraft. */
export function createAircraftModel(aircraftId, skinId) {
  const aircraft = getAircraft(aircraftId);
  const selectedSkin = getSkin(aircraft.id, skinId);
  const key = `${aircraft.id}/${selectedSkin.id}`;
  if (!cache.has(key)) cache.set(key, buildModel(aircraft, selectedSkin));
  return cache.get(key);
}

/**
 * Small offline hangar preview. No DOM access, asset request, or animation loop.
 * width/height refer to the canvas backing pixels; the caller owns DPR sizing.
 */
export function drawAircraftPreview(ctx, model, options = {}) {
  const width = options.width || ctx.canvas.width;
  const height = options.height || ctx.canvas.height;
  const rotation = options.rotation ?? -0.48;
  const elevation = options.elevation ?? 0.61;
  const size = options.scale ?? Math.min((width - 24) / (model.width * 1.25), (height - 22) / (model.length * 0.82));
  const cs = Math.cos(rotation), sn = Math.sin(rotation);
  const draw = model.voxels.map((v) => {
    const across = v.x * cs + v.y * sn;
    const forward = -v.x * sn + v.y * cs;
    return { x: width / 2 + across * size, y: height / 2 + 6 - (forward * elevation + v.z * 0.92) * size, depth: forward + v.z * 1.8, color: v.color };
  });
  // Nearer/high surfaces cover rear/lower ones in this fixed preview camera.
  draw.sort((a, b) => a.depth - b.depth);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  const pixel = Math.max(1, Math.ceil(size * 1.18));
  let lastColor = -1;
  for (const p of draw) {
    if (p.color !== lastColor) {
      const c = p.color;
      ctx.fillStyle = `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;
      lastColor = c;
    }
    ctx.fillRect(Math.round(p.x - pixel / 2), Math.round(p.y - pixel / 2), pixel, pixel);
  }
  ctx.restore();
}
