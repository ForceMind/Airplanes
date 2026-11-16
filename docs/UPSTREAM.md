# Fly upstream and local integration

## Source and attribution

The free-flight experience derives from **Fly / fighter by Dash (@creativedash)**.

- Announcement: <https://x.com/creativedash/status/2122000830895386680>
- Author's share link: <https://remix.ui8.ai/fly>
- Resolved share: <https://forge.ui8.ai/share/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24>
- Author's alternate playable publication: <https://fly.ui8.dev>
- Source snapshot retrieved on **2026-11-16**, published **revision 35**, as identified by the alternate publication's `main.tsx`.

The share page's preview referenced version 39 when inspected. That is not a claim that the alternate publication is the same revision or the exact code shown in the announcement video.

The eight files in `vendor/upstream/fly-v35/` preserve the bytes retrieved during the review: the six JavaScript/TypeScript-named application files and two publication pages. `manifest.json` records their exact source URLs, byte counts and SHA-256 digests. The upstream bytes are not rewritten when local gameplay changes.

## Reuse statement

The author's public response to a question about sharing the code states:

> Yes, you can remix, modify it, point your agent at it. Have fun.

The response is in the announcement thread linked above; a readable mirror was inspected at <https://www.teapawt.net/creativedash/status/2122000830895386680>.

[Forge's official documentation](https://ui8.ai/forge/docs), in “Use a project in your own code”, also describes pulling project code, assets and controls into a codebase with a source attribution header.

No standard SPDX license for these particular upstream files was found in the downloaded source or share metadata. This repository records the author's remix statement and provenance; it does **not** represent the upstream material as newly licensed under MIT, Apache, or a license invented by this project. A repository-wide license declaration must preserve this distinction.

## Runtime migration

`src/engine/scene.js`, `jet-model.js`, `cockpit.js`, and `flame-layer.js` are runtime copies of their upstream counterparts. The downloaded `.ts` files already contain browser-executable JavaScript. Local migration changes their import suffixes to `.js`, removes source cache query strings from local imports, and adds attribution headers. The original React component and Forge mount file remain in the snapshot for reference; this application supplies its own lifecycle and input adapter, so it does not load the Forge host runtime.

The original palette, jet slices, terrain generation, three camera modes, cockpit and flame renderer remain available to free flight. WebGL is optional: when the smooth-flame layer cannot initialize, the host can select the upstream pixel flames.

## Battle bridge

The local renderer signature is:

```js
createScene(fullParams, { hidePlayer: false, manualControl: false })
```

Both options default to false. Callers should merge `DEFAULT_PARAMS` into their configuration. The upstream `setParams(next)` still replaces the whole parameter object, so callers should also pass a merged configuration there.

- `hidePlayer: true` suppresses the original modern aircraft, its flames, trails, exhaust and projected silhouette. It preserves the world, camera and player flight simulation. This permits a WWII aircraft to be drawn at the same flight pose.
- `manualControl: true` starts and resets in keyboard/manual flight mode. Releasing all controls holds the heading rather than returning to the original autonomous demonstration path. Explicit pointer steering remains possible if `followPointer` is enabled; idle pointer input returns to manual straight flight.

The legacy methods remain available: `setParams`, `resize`, `pointerMove`, `pointerLeave`, `press`, `release`, `replayIntro`, `toggleView`, `setKeys`, `step`, `render`, and the `width`, `height`, `flames`, `view` getters.

New methods:

| Method | Contract |
| --- | --- |
| `getFlightState()` | Returns a copy containing `x, y, z, yaw, pitch, roll, vx, vy, speed, time`. `roll` includes a current stunt. The caller cannot modify the internal plane by editing this copy. |
| `projectPoint(x, y, z)` | Returns `x, y, depth, scale, visible` in final low-resolution screen pixels. `visible` describes the camera/frame, not terrain occlusion. |
| `isPointVisible(screenX, screenY, depth)` | Tests the most recently rendered world depth; false before the first render, after resize until render, for non-finite values or out-of-frame pixels. |
| `drawActors(actors)` | Draws the complete external actor list into the current buffer and returns that same RGBA array. Since v0.3 this uses final screen projection in all three views and transitions, including player opacity and actor/world depth. |

Actor shape:

```js
{
  x, y, z, yaw, pitch, roll, scale,
  model: {
    width, length, height, pivotY, pivotK,
    voxels: [{ x, y, z, color }]
  }
}
```

Model voxel coordinates are already centred: **x is right, y is forward toward the nose, z is up**. Pivot fields are descriptive metadata, not offsets to apply a second time. Colours are packed unsigned `0xAABBGGRR`, matching the upstream `Uint32Array` framebuffer. Alpha-zero cells are skipped; the current bridge treats other cells as opaque.

The external actor renderer applies yaw/pitch/roll, samples the voxel volume to avoid gaps when wings roll, checks world occlusion, and uses a separate per-frame actor depth buffer. It does not mutate the world's depth buffer. Supply all aircraft together once per frame so actor-to-actor depth remains consistent.

```js
scene.step(dt);
const bytes = scene.render();
scene.drawActors(allAircraft);
// An ImageData may retain `bytes` until resize replaces the buffer.
context.putImageData(new ImageData(bytes, scene.width, scene.height), 0, 0);
```

`resize` changes the backing array: the host must recreate its cached `ImageData`. Flight positions can increase indefinitely while the original terrain repeats; gameplay should use nearby world positions and should not mistake the repeating map for a geographic reconstruction of Britain or Germany.

## Scope

Free flight preserves the upstream visual experience. The WWII layer is an arcade game interpretation, not a claim of historically calibrated aircraft performance or an exact Battle of Britain map. Gameplay, new aircraft, skins and the version selection interface are local additions. The external actor bridge intentionally limits battle to overhead view until combat occlusion and HUD integration have been implemented for the other camera modes.
