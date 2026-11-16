// Airplanes: small voxel-actor bridge for the migrated software renderer.
// Coordinates are already centred: x = right, y = forward, z = up.
// Packed colours use the renderer's 0xAABBGGRR layout.

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

/** Draw the complete actor list once after scene.render(), before presenting its buffer. */
export function drawVoxelActors(actors, target) {
  const { width, height, pixels, depth, project, visible } = target;
  depth.fill(Infinity);
  let written = 0;
  if (!Array.isArray(actors) || !width || !height) return written;
  for (const actor of actors) {
    if (!actor?.model || !Array.isArray(actor.model.voxels)) continue;
    if (![actor.x, actor.y, actor.z].every(Number.isFinite)) continue;
    const scale = Number.isFinite(actor.scale) ? actor.scale : 1;
    if (scale <= 0) continue;
    const centre = project(actor.x, actor.y, actor.z);
    if (!Number.isFinite(centre.scale) || centre.scale <= 0) continue;
    const radius = Math.max(actor.model.width || 0, actor.model.length || 0, actor.model.height || 0, 4) * scale * centre.scale;
    if (centre.x + radius < 0 || centre.y + radius < 0 || centre.x - radius > width || centre.y - radius > height) continue;
    const { r, f, u } = actorAxes(actor);
    const samples = Math.min(3, Math.max(2, Math.ceil(centre.scale * scale)));
    // Sample all three dimensions: a rolled wing remains solid even when its slices are edge-on.
    const offsets = Array.from({ length: samples }, (_, i) => (i + 0.5) / samples - 0.5);
    for (const voxel of actor.model.voxels) {
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
        const size = Math.max(1, Math.ceil(p.scale * scale / samples));
        const left = Math.round(p.x - (size - 1) / 2);
        const top = Math.round(p.y - (size - 1) / 2);
        for (let py = top; py < top + size; py++) for (let px = left; px < left + size; px++) {
          if (px < 0 || py < 0 || px >= width || py >= height || !visible(px, py, p.depth)) continue;
          const at = py * width + px;
          if (depth[at] < p.depth) continue;
          depth[at] = p.depth;
          pixels[at] = colour;
          written++;
        }
      }
    }
  }
  return written;
}
