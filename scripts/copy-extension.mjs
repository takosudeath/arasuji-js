// 拡張機能は自分のフォルダの中のファイルしか読めないので、public/ の arasuji.js と sites.js を写す。
// 元は public/ のほうだけを直す（extension/ の写しはリポジトリに入れない）
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// public/ の中の場所 → extension/ の中の名前
const FILES = { 'v1/arasuji.js': 'arasuji.js', 'sites.js': 'sites.js' };

for (const [from, to] of Object.entries(FILES)) {
  await fs.copyFile(path.join(ROOT, 'public', from), path.join(ROOT, 'extension', to));
  console.log(`[copy] public/${from} → extension/${to}`);
}
console.log('\nchrome://extensions で「パッケージ化されていない拡張機能を読み込む」から extension/ を選んでください。');
