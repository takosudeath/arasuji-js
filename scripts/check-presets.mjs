// public/v1/arasuji.js と public/sites.js のプリセットが同じ値か確かめる。
// arasuji.js はページに単独で置かれるので、プリセットを sites.js と1か所にまとめられない
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(path.join(ROOT, 'public', file), 'utf8');

const sandbox = {};
vm.runInNewContext(await read('sites.js'), { globalThis: sandbox });
const fromSites = sandbox.ARASUJI_SITES.presets;

const m = (await read('v1/arasuji.js')).match(/const PRESETS = (\{[\s\S]*?\n {2}\});/);
if (!m) throw new Error('public/v1/arasuji.js に PRESETS が見つかりません');
const fromArasuji = vm.runInNewContext(`(${m[1]})`);

const a = JSON.stringify(fromArasuji, null, 2);
const b = JSON.stringify(fromSites, null, 2);
if (a !== b) {
  console.error('[check-presets] arasuji.js と sites.js のプリセットが違います');
  console.error('arasuji.js:', a);
  console.error('sites.js:', b);
  process.exit(1);
}
console.log('[check-presets] arasuji.js と sites.js のプリセットは同じです');
