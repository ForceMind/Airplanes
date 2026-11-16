/** Reproducible import of the exact user-selected public combat fork.
 * The snapshot is never edited. Normal builds are offline; --download is opt-in.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SOURCE_URL = 'https://2kp1v13.sharehtml.org/';
export const SOURCE_SHA256 = '8c591be9712fafc9d842a508e6780981f08c2652669e00f6edbd772086cf5bb7';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildModernPage(bytes) {
  if (hash(bytes) !== SOURCE_SHA256) throw new Error('Upstream bytes changed: review the new source before importing.');
  let text = Buffer.from(bytes).toString('utf8');
  const hook = 'window.__view=()=>rt.view';
  if (text.split(hook).length !== 2) throw new Error('Native camera hook was not found exactly once.');
  // Use the actual upstream camera transition, not a second camera or synthetic save.
  text = text.replace(hook, 'window.__airplanesCycleView=()=>{rt.toggleView();mc.current(rt.view,7)},' + hook);
  text = text.replaceAll('"fighter-guns-', '"airplanes-modern-v9-');
  text = text.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; media-src blob:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'">');
  text = text.replace('</body>', '<script src="./bridge.js"></script></body>');
  return text;
}

export async function importModern(root, download = false) {
  const vendor = resolve(root, 'vendor/upstream/fighter-guns-v9');
  await mkdir(vendor, { recursive: true });
  const input = resolve(vendor, 'index.html');
  if (download) {
    const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(40000) });
    if (!response.ok) throw new Error(`Source fetch failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 6000000 || hash(bytes) !== SOURCE_SHA256) throw new Error('Source size or integrity mismatch. Nothing was imported.');
    await writeFile(input, bytes);
  }
  const bytes = await readFile(input);
  const page = buildModernPage(bytes);
  await mkdir(resolve(root, 'modern'), { recursive: true });
  await writeFile(resolve(root, 'modern/index.html'), page);
  await writeFile(resolve(vendor, 'manifest.json'), JSON.stringify({
    name: 'Fighter + Guns v9', source: SOURCE_URL,
    originalAuthor: 'Dash / @creativedash', combatForkAuthor: 'Not identified by the supplied page',
    sourceSha256: SOURCE_SHA256, sourceBytes: bytes.length, runtimeSha256: hash(page),
    alterations: ['One explicit native camera hook', 'Independent airplanes-modern-v9 storage namespace', 'Offline content security policy', 'Local lifecycle bridge'],
    license: 'No standard license for the game was found; upstream notices and bundled dependency licenses are retained.'
  }, null, 2) + '\n');
  console.log('Imported verified combat v9, preserving native gameplay and three camera modes.');
}
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importModern(root, process.argv.includes('--download'));
