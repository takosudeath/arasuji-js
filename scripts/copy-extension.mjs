// 拡張機能は自分のフォルダの中のファイルしか読めないので、public/ の arasuji.js と sites.js を写す。
// 元は public/ のほうだけを直す（extension/ の写しはリポジトリに入れない）
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILES = ['arasuji.js', 'sites.js'];

for (const file of FILES) {
  await fs.copyFile(path.join(ROOT, 'public', file), path.join(ROOT, 'extension', file));
  console.log(`[copy] public/${file} → extension/${file}`);
}
console.log('\nchrome://extensions で「パッケージ化されていない拡張機能を読み込む」から extension/ を選んでください。');
