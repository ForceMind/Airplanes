/** Stylised piston-aircraft cockpit. This is not a measured historical instrument panel. */
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
export function drawPistonCockpit(ctx, width, height, pose, camera, faction) {
  const alpha = clamp(Number(camera?.cockpitOpacity) || 0, 0, 1);
  if (!alpha || width < 1 || height < 1) return;
  const german = faction === 'luftwaffe';
  ctx.save(); ctx.globalAlpha = alpha;
  const w = width, h = height, top = h * .12, base = h * .82;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#141e21'; ctx.lineWidth = Math.max(8, w * .014);
  ctx.beginPath(); ctx.moveTo(w * .075, base);
  if (german) {
    ctx.lineTo(w * .27, top); ctx.lineTo(w * .73, top); ctx.lineTo(w * .925, base);
  } else {
    ctx.bezierCurveTo(w * .12, h * -.035, w * .88, h * -.035, w * .925, base);
  }
  ctx.stroke();
  ctx.strokeStyle = '#9aa696'; ctx.lineWidth = Math.max(1, w * .002);
  ctx.stroke();
  ctx.strokeStyle = '#192529'; ctx.lineWidth = Math.max(5, w * .009);
  for (const x of [.3, .7]) {
    ctx.beginPath(); ctx.moveTo(w * x, top); ctx.lineTo(w * (x < .5 ? .23 : .77), base); ctx.stroke();
  }
  ctx.fillStyle = '#243137';
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, base + h * .04);
  ctx.quadraticCurveTo(w * .5, h * .66, w, base + h * .04); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#53605a'; ctx.lineWidth = 3; ctx.stroke();
  // Keep all dials inside the panel at narrow mobile aspect ratios.
  const radius = Math.min(w * .062, h * .072);
  const cy = h * .89;
  const dials = [['SPD', pose.speed, 200], ['ALT', pose.z, 400], ['HDG', ((pose.yaw * 180 / Math.PI) % 360 + 360) % 360, 360]];
  for (let i = 0; i < dials.length; i++) {
    const [label, value, maximum] = dials[i], x = w * (.33 + i * .17);
    ctx.fillStyle = '#080e11'; ctx.strokeStyle = '#879188'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d3d5bd'; ctx.lineWidth = 1;
    for (let tick = 0; tick <= 8; tick++) {
      const a = Math.PI * (.75 + tick * 1.5 / 8);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * radius * .8, cy + Math.sin(a) * radius * .8);
      ctx.lineTo(x + Math.cos(a) * radius * .94, cy + Math.sin(a) * radius * .94); ctx.stroke();
    }
    const a = Math.PI * (.75 + clamp(Number(value) || 0, 0, maximum) / maximum * 1.5);
    ctx.strokeStyle = '#e8dfbc'; ctx.lineWidth = Math.max(1, radius / 17);
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + Math.cos(a) * radius * .72, cy + Math.sin(a) * radius * .72); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = '#b6bea7'; ctx.font = `${Math.max(6, radius * .22)}px monospace`;
    ctx.fillText(label, x, cy + radius * .48);
  }
  ctx.restore();
}
