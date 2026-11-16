import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'src', 'assets', 'THIRD_PARTY_NOTICES.md']) {
  await cp(resolve(root, file), resolve(dist, file), { recursive: true });
}
await mkdir(resolve(dist, 'docs'), { recursive: true });
await cp(resolve(root, 'docs/AIRCRAFT_REFERENCE.md'), resolve(dist, 'docs/AIRCRAFT_REFERENCE.md'));
await writeFile(resolve(dist, '.nojekyll'), '');
await writeFile(resolve(dist, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
console.log('Built dist/: standalone static game, no runtime CDN or application server.');
