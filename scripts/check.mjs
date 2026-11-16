import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const roots = ['src', 'scripts', 'tests', 'modern'];
let count = 0;
async function check(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await check(path);
    else if (/\.m?js$/.test(item.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      count++;
    }
  }
}
for (const root of roots) await check(root);
const html = await readFile('index.html', 'utf8');
for (const path of ['./src/app.js', './src/styles.css']) if (!html.includes(path)) throw new Error(`Missing entry: ${path}`);
console.log(`Syntax checked ${count} JavaScript modules.`);
