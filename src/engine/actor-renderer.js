// Airplanes: small voxel-actor bridge for the migrated software renderer.
// Coordinates are already centred: x = right, y = forward, z = up.
// Packed colours use the renderer's 0xAABBGGRR layout.
import { createPropellerVoxels, propellerPhase } from './propeller.js';

const OFFSETS = [null, [0], [-.25, .25], [-1 / 3, 0, 1 / 3]];
const blurBuffers = new WeakMap();

export function actorAxes(actor) {
  const yaw = Number.isFinite(actor.yaw) ? actor.yaw : 0;
  const pitch = Number.isFinite(actor.pitch) ? actor.pitch : 0;
  const roll = Number.isFinite(actor.roll) ? actor.roll : 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ux = c * sr, uy = s * sr, uz = cr;
  return {
    r: [c * cr, s * cr, -sr],
    f: [s * cp + ux * sp, -c * cp + uy * sp, uz * sp],
    u: [ux * cp - s * sp, uy * cp + c * sp, uz * cp],
  };
}

/** The one canonical transform for body geometry, spinning blades and gun muzzles. */
export function actorPointToWorld(actor, point, scale = actor.scale ?? 1) {
  const { r, f, u } = actorAxes(actor);
  const x = point.x * scale, y = point.y * scale, z = point.z * scale;
  return {
    x: actor.x + r[0] * x + f[0] * y + u[0] * z,
    y: actor.y + r[1] * x + f[1] * y + u[1] * z,
    z: actor.z + r[2] * x + f[2] * y + u[2] * z,
  };
}

/** Draw the complete actor list once after scene.render(), before presenting its buffer. */
export function drawVoxelActors(actors, target) {
  const { width, height, pixels, depth, project, visible } = target;
  depth.fill(Infinity);
  let written = 0;
  if (!Array.isArray(actors) || !width || !height) return written;
  const blurPasses = [];
  let blur = null;
  function blurFragment(at, distance, color, alpha) {
    if (!blur) {
      blur = blurBuffers.get(depth);
      if (!blur || blur.alpha.length !== pixels.length) {
        blur = { alpha: new Uint8Array(pixels.length), depths: new Float32Array(pixels.length), colors: new Uint32Array(pixels.length), touched: [] };
        blurBuffers.set(depth, blur);
      }
      blur.alpha.fill(0);
      blur.touched.length = 0;
    }
    if (blur.alpha[at] === 0) blur.touched.push(at);
    if (blur.alpha[at] === 0 || distance <= blur.depths[at]) {
      blur.depths[at] = distance;
      blur.colors[at] = color;
    }
    // A voxel's multiple coverage samples must not compound into an opaque
    // streak. A pixel receives at most one exposure weight per frame.
    blur.alpha[at] = Math.max(blur.alpha[at], alpha);
  }
  for (const actor of actors) {
    if (!actor?.model || !Array.isArray(actor.model.voxels)) continue;
    if (![actor.x, actor.y, actor.z].every(Number.isFinite)) continue;
    const scale = Number.isFinite(actor.scale) ? actor.scale : 1;
    if (scale <= 0) continue;
    const centre = project(actor.x, actor.y, actor.z);
    if (!Number.isFinite(centre.scale) || centre.scale <= 0) continue;
    const propeller = actor.model.propeller;
    const propExtent = propeller ? Math.abs(propeller.y || 0) + (propeller.radius || 0) : 0;
    const radius = Math.max(actor.model.width || 0, actor.model.length || 0, actor.model.height || 0, propExtent, 4) * scale * centre.scale;
    if (centre.x + radius < 0 || centre.y + radius < 0 || centre.x - radius > width || centre.y - radius > height) continue;
    const { r, f, u } = actorAxes(actor);
    const samples = Math.min(3, Math.max(2, Math.ceil(centre.scale * scale)));
    // Sample all three dimensions: a rolled wing remains solid even when its slices are edge-on.
    const rasterize = (voxels, alpha = 255, coverageSamples = samples) => {
      const offsets = OFFSETS[coverageSamples];
      for (const voxel of voxels) {
        const colour = voxel.color >>> 0;
        if ((colour >>> 24) === 0 || ![voxel.x, voxel.y, voxel.z].every(Number.isFinite)) continue;
        for (const ox of offsets) for (const oy of offsets) for (const oz of offsets) {
          const x = (voxel.x + ox) * scale;
          const y = (voxel.y + oy) * scale;
          const z = (voxel.z + oz) * scale;
          const p = project(
            actor.x + r[0] * x + f[0] * y + u[0] * z,
            actor.y + r[1] * x + f[1] * y + u[1] * z,
            actor.z + r[2] * x + f[2] * y + u[2] * z,
          );
          if (!p.visible) continue;
          const size = Math.max(1, Math.ceil(p.scale * scale / coverageSamples));
          const left = Math.round(p.x - (size - 1) / 2);
          const top = Math.round(p.y - (size - 1) / 2);
          for (let py = top; py < top + size; py++) for (let px = left; px < left + size; px++) {
            if (px < 0 || py < 0 || px >= width || py >= height || !visible(px, py, p.depth)) continue;
            const at = py * width + px;
            if (depth[at] < p.depth) continue;
            if (alpha < 255) blurFragment(at, p.depth, colour, alpha);
            else {
              depth[at] = p.depth;
              pixels[at] = colour;
              written++;
            }
          }
        }
      }
    };
    rasterize(actor.model.voxels);
    if (propeller) {
      const spinning = actor.propellerRunning !== false && Number.isFinite(actor.time);
      const phase = Number.isFinite(actor.propellerPhase) ? actor.propellerPhase
        : spinning ? propellerPhase(actor.time, actor.speed, propeller) : .2;
      rasterize(createPropellerVoxels(propeller, phase));
      if (spinning && actor.propellerBlur !== false) blurPasses.push(() => {
        // A short shutter exposure softens strobing while keeping three actual
        // moving blades. Blur uses one sample per voxel and the completed depth
        // buffer, so a nose, wing or nearer aircraft still occludes it.
        const direction = propeller.rotationSign === 1 ? 1 : -1;
        rasterize(createPropellerVoxels(propeller, phase - direction * .22), 44, 1);
        rasterize(createPropellerVoxels(propeller, phase - direction * .44), 24, 1);
      });
    }
  }
  for (const drawBlur of blurPasses) drawBlur();
  if (blur) for (const at of blur.touched) {
    const a = blur.alpha[at], b = 255 - a, src = blur.colors[at], dst = pixels[at];
    const red = Math.round(((src & 255) * a + (dst & 255) * b) / 255);
    const green = Math.round((((src >>> 8) & 255) * a + ((dst >>> 8) & 255) * b) / 255);
    const blue = Math.round((((src >>> 16) & 255) * a + ((dst >>> 16) & 255) * b) / 255);
    pixels[at] = (0xff000000 | blue << 16 | green << 8 | red) >>> 0;
    written++;
  }
  return written;
}
