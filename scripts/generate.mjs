// ページ → arasuji-data.js（AI のプロバイダーは arasuji.config.json の ai で選ぶ）
//   pnpm generate       AI で要約・要点を作る
//   pnpm generate:dry   API を呼ばず、本文の1文目で仮の要約・要点を作る
// HTML パーサーを使わないので、セレクタは単純な書き方だけを扱う（docs/spec.md 10.1）
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--no-ai');
const POINT_MAX = 35;

const PROMPTS = {
  summary: '文書の1節を読み、「この節で学ぶこと」を日本語1文で書いてください。用語は本文の表記に合わせ、本文にない情報は足さないでください。出力は1文のみ。',
  point: '読者が文書を再開するときに思い出すべきことを、与えられた節要約だけを材料にして、日本語1文・35字以内にまとめてください。用語は本文の表記に合わせ、本文にない情報は足さないでください。出力は要約文のみ。',
};

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'arasuji.config.json'), 'utf8'));
  const ai = DRY ? null : createAI(config);

  for (const site of config.sites) {
    const inputDir = path.join(ROOT, site.input);
    const files = (await fs.readdir(inputDir)).filter(f => f.endsWith('.html')).sort();
    const data = {};

    for (const file of files) {
      // index.html は URL が /docs/ のようにディレクトリで終わるので、ディレクトリ名を ID にする（arasuji.js と揃える）
      const name = file.replace(/\.html$/, '');
      const pageId = name === 'index' ? path.basename(inputDir) : name;
      const html = await fs.readFile(path.join(inputDir, file), 'utf8');
      const page = parsePage(html, site);
      if (!page) {
        console.warn(`[skip] ${site.input}/${file}: コンテナ「${site.container}」か見出し「${site.heading}」が見つかりません`);
        continue;
      }
      console.log(`[page] ${pageId}: 「${page.title}」${page.sections.length}節`);
      data[pageId] = await summarizePage(pageId, page, ai);
    }

    const outPath = path.join(ROOT, site.output);
    await fs.writeFile(outPath, render(data), 'utf8');
    console.log(`[write] ${site.output}（${Object.keys(data).length}ページ）`);
  }

  console.log('\n生成した文は、必ず目で確認してから使ってください。');
}

// ---------------------------------------------------------------------------
// HTML の切り出し

function parsePage(html, site) {
  let body = extractContainer(html, site.container);
  if (body == null) return null;
  if (site.end) body = cutAtEndMarker(body, site.end);

  const tag = site.heading.toLowerCase();
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  const matches = [...body.matchAll(re)];
  if (matches.length === 0) return null;

  // 先頭のかたまり（h1・導入・目次）は捨てる
  const sections = matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    return { order: i + 1, heading: toText(m[1]), text: toText(body.slice(start, end)) };
  });

  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i;
  const titleMatch = body.match(h1) || html.match(h1);
  const docTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = titleMatch ? toText(titleMatch[1]) : docTitle ? toText(docTitle[1]) : '';

  return { title, sections };
}

// container：タグ名、またはクラス名（. 始まり）
function extractContainer(html, selector) {
  const open = selector.startsWith('.')
    ? new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*(?<![\\w-])${escapeRe(selector.slice(1))}(?![\\w-])[^"']*["'][^>]*>`, 'i')
    : new RegExp(`<(${escapeRe(selector)})\\b[^>]*>`, 'i');
  const m = html.match(open);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const start = m.index + m[0].length;
  const end = findClose(html, tag, start);
  return html.slice(start, end);
}

// 同じタグの入れ子を数えて、対応する閉じタグの位置を返す
function findClose(html, tag, from) {
  const re = new RegExp(`<(/?)${escapeRe(tag)}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return html.length;
}

// end：クラス名（. 始まり）。目印の要素から後ろを捨てる
function cutAtEndMarker(body, selector) {
  if (!selector.startsWith('.')) {
    console.warn(`[warn] end はクラス名（. 始まり）だけを扱います: ${selector}`);
    return body;
  }
  const re = new RegExp(`<[a-z][a-z0-9-]*\\b[^>]*\\bclass\\s*=\\s*["'][^"']*(?<![\\w-])${escapeRe(selector.slice(1))}(?![\\w-])[^"']*["'][^>]*>`, 'i');
  const m = body.match(re);
  return m ? body.slice(0, m.index) : body;
}

function toText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, tag => {
        const alt = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        return alt ? ` ${alt[1] ?? alt[2]} ` : ' ';
      })
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return named[code.toLowerCase()] ?? all;
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 要約

async function summarizePage(pageId, page, ai) {
  const sections = [];
  for (const s of page.sections) {
    const raw = ai ? await ai(PROMPTS.summary, s.text) : firstSentence(s.text);
    const summary = clean(raw);
    if (!summary) console.warn(`[warn] ${pageId} 節${s.order}: 節要約が空です`);
    sections.push({ order: s.order, heading: s.heading, summary });
  }

  const points = {};
  for (let n = 1; n <= sections.length; n++) {
    const input = sections.slice(0, n).map(s => `「${s.heading}」：${s.summary}`).join('\n');
    const raw = ai ? await ai(PROMPTS.point, input) : sections[n - 1].summary;
    const point = clean(raw);
    if (!point) console.warn(`[warn] ${pageId} 節${n}: 要点が空です`);
    else if ([...point].length > POINT_MAX) {
      console.warn(`[warn] ${pageId} 節${n}: 要点が${POINT_MAX}字を超えています（${[...point].length}字）: ${point}`);
    }
    points[String(n)] = point;
  }

  return { title: page.title, sections, points };
}

function firstSentence(text) {
  const m = text.match(/^.*?。/);
  return m ? m[0] : text;
}

// モデルの出力の崩れを整える（docs/spec.md 10.5）
function clean(raw) {
  let s = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
  s = s.replace(/^(?:[*#>\-\s]*)(?:要約|要点|節要約|まとめ|この節で学ぶこと|回答|出力)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*/, '');
  s = s.replace(/^\*\*(.*)\*\*$/, '$1').trim();
  const pairs = [['「', '」'], ['『', '』'], ['"', '"'], ['“', '”'], ["'", "'"]];
  for (let changed = true; changed;) {
    changed = false;
    for (const [open, close] of pairs) {
      if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
        s = s.slice(open.length, -close.length).trim();
        changed = true;
      }
    }
  }
  s = s.replace(/[\s.．,，、]+$/, '');
  if (s && !s.endsWith('。')) s += '。';
  return s;
}

// ---------------------------------------------------------------------------
// AI の呼び出し（docs/spec.md 10.3）
// どのプロバイダーも (system, user) => 出力文 の関数にそろえる

const PROVIDERS = {
  'workers-ai': workersAI,
  openai: openaiCompatible,
  anthropic,
};

function createAI(config) {
  // 旧形式（トップレベルの model だけ）は Workers AI として扱う
  const ai = config.ai || (config.model ? { provider: 'workers-ai', model: config.model } : null);
  if (!ai || !ai.provider || !ai.model) fail('arasuji.config.json の ai に provider と model を書いてください');
  const provider = PROVIDERS[ai.provider];
  if (!provider) fail(`ai.provider は ${Object.keys(PROVIDERS).join('・')} のどれかにしてください: ${ai.provider}`);
  console.log(`[ai] ${ai.provider} / ${ai.model}`);
  return provider(ai);
}

function workersAI({ model }) {
  const account = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;

  return async (system, user) => {
    const json = await postJSON('Workers AI', url, { Authorization: `Bearer ${token}` }, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    if (json.success === false) throw new Error(`Workers AI の呼び出しに失敗しました: ${JSON.stringify(json.errors)}`);
    // 返ってくる形はモデルによって違う
    const r = json.result || {};
    return typeof r.response === 'string' ? r.response
      : r.choices && r.choices[0] && r.choices[0].message ? r.choices[0].message.content
      : '';
  };
}

// OpenAI の Chat Completions と同じ形の API（OpenAI・Ollama・LM Studio・OpenRouter・Gemini など）
function openaiCompatible({ model, baseURL = 'https://api.openai.com/v1', apiKeyEnv = 'OPENAI_API_KEY' }) {
  // ローカルの Ollama などはキーがいらないので、なくても止めない
  const key = process.env[apiKeyEnv];
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;

  return async (system, user) => {
    const json = await postJSON('OpenAI 互換 API', url, key ? { Authorization: `Bearer ${key}` } : {}, {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const m = json.choices && json.choices[0] && json.choices[0].message;
    return m ? m.content : '';
  };
}

function anthropic({ model, baseURL = 'https://api.anthropic.com', apiKeyEnv = 'ANTHROPIC_API_KEY', effort }) {
  const key = requireEnv(apiKeyEnv);
  const url = `${baseURL.replace(/\/+$/, '')}/v1/messages`;

  return async (system, user) => {
    const json = await postJSON('Anthropic API', url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
      ...(effort ? { output_config: { effort } } : {}),
    });
    if (json.stop_reason === 'refusal') {
      console.warn(`[warn] モデルが応答を断りました: ${JSON.stringify(json.stop_details)}`);
      return '';
    }
    // 思考のブロックが先に来ることがあるので、text だけをつなぐ
    return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  };
}

async function postJSON(label, url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    const detail = json ? JSON.stringify(json.error || json.errors || json) : res.statusText;
    throw new Error(`${label} の呼び出しに失敗しました（${res.status}）: ${detail}`);
  }
  return json;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) fail(`環境変数 ${name} を渡してください（API を呼ばずに試すなら pnpm generate:dry）`);
  return v;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------------------

function render(data) {
  return '// scripts/generate.mjs で生成。人が確認してから使う\n' +
    `window.ARASUJI_DATA = Object.assign(window.ARASUJI_DATA || {}, ${JSON.stringify(data, null, 2)});\n`;
}

// テストから import したときは動かさない
export { parsePage, extractContainer, cutAtEndMarker, toText, decodeEntities, summarizePage, firstSentence, clean, PROVIDERS, render };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
}
