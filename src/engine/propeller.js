// Shared propeller geometry. Aircraft-local axes: x right, y forward, z up.
// Blades turn in x/z around a fixed y-axis hub, never around screen coordinates.
const TAU = Math.PI * 2;
const bladeCache = new WeakMap();
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const BLACK = 0xff343b37;

/** Visual shaft rate; the arcade flight speed is not a physical engine RPM. */
export function propellerPhase(time = 0, speed = 92, propeller = {}) {
  const rpm = Math.max(0, finite(propeller.rpm, 1250));
  const governed = clamp(.65 + Math.max(0, finite(speed, 92)) / 260, .65, 1.12);
  const sign = propeller.rotationSign === 1 ? 1 : -1;
  return ((finite(time, 0) * rpm / 60 * governed * TAU * sign) % TAU + TAU) % TAU;
}

function bladeGeometry(propeller) {
  let geometry = bladeCache.get(propeller);
  if (geometry) return geometry;
  const radius = Math.max(.5, finite(propeller.radius, 8));
  const root = clamp(finite(propeller.hubRadius, radius * .16), .25, radius * .7);
  const chord = clamp(finite(propeller.bladeWidth, radius * .15), .45, radius * .35);
  const baseColor = (propeller.bladeColor ?? BLACK) >>> 0;
  const tipColor = (propeller.tipColor ?? baseColor) >>> 0;
  const tipStart = radius * .88;
  geometry = [];
  // One slender, slightly swept blade is cached; each frame rotates it three
  // times. The sub-voxel spacing keeps a tilted blade continuous at small sizes.
  const steps = Math.max(3, Math.ceil((radius - root) / .65));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const radial = root + (radius - root) * t;
    const width = chord * (.45 + .55 * Math.sin(Math.PI * Math.pow(t, .7)));
    const sweep = chord * .16 * t;
    const samples = Math.max(1, Math.ceil(width / .65));
    for (let across = 0; across < samples; across++) {
      const tangent = ((across + .5) / samples - .5) * width + sweep;
      geometry.push({ radial, tangent, color: radial >= tipStart ? tipColor : baseColor });
    }
  }
  bladeCache.set(propeller, geometry);
  return geometry;
}

/**
 * Small separate moving mesh. Static aircraft geometry contains the spinner,
 * not a frozen cross. All points stay in the hub's local x/z plane.
 */
export function createPropellerVoxels(propeller, phase = .2) {
  if (!propeller || typeof propeller !== 'object' || !(propeller.radius > 0)) return [];
  const count = clamp(Math.round(finite(propeller.bladeCount, 3)), 1, 6);
  const x = finite(propeller.x, 0), y = finite(propeller.y, 0), z = finite(propeller.z, 0);
  const angle = finite(phase, .2);
  const geometry = bladeGeometry(propeller);
  const voxels = [];
  for (let bladeIndex = 0; bladeIndex < count; bladeIndex++) {
    const a = angle + bladeIndex * TAU / count;
    const cs = Math.cos(a), sn = Math.sin(a);
    for (const point of geometry) {
      voxels.push({
        x: x + point.radial * cs - point.tangent * sn,
        y,
        z: z + point.radial * sn + point.tangent * cs,
        color: point.color,
        bladeIndex,
      });
    }
  }
  return voxels;
}
