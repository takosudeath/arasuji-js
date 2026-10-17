// arasuji.js をタブに差し込む。拡張のスクリプトはページとは別の JS 環境（isolated world）で動くので、
// ページの CSP に止められない。進捗の localStorage はページと共有される。
// 本文が iframe の中にあるサイトでは、本文のある frame を選んでその中に入れる
importScripts('sites.js');

const AUTO_KEY = 'autoOrigins';
const AUTO_SCRIPT_ID = 'arasuji-auto';

function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch (_) {
    return null;
  }
}

// 設定は、ポップアップで見えている外側のページのオリジンごとに持つ
async function getSettings(origin) {
  const key = `site:${origin}`;
  const got = await chrome.storage.local.get([key, 'shortcuts']);
  return { override: (origin && got[key]) || {}, shortcuts: !!got.shortcuts };
}

// すべての frame で、その中で使うときの設定と節の数を調べる。
// 権限のない frame（別オリジンの広告など）は結果に入らない。外側のページにも触れなければ null
async function probeFrames(tabId, override) {
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ['sites.js'] });
    const results = await chrome.scripting.executeScript({
      target,
      args: [override],
      func: override => Object.assign(
        globalThis.ARASUJI_SITES.probe(location.href, document, override),
        // 拡張が入れたものなら、同じ環境に Arasuji がある。ページやブックマークレットが入れたものは見えない
        { hasApi: !!window.Arasuji },
      ),
    });
    return results
      .filter(r => r.result)
      .map(r => Object.assign({ frameId: r.frameId }, r.result));
  } catch (_) {
    return null;
  }
}

async function runIn(tabId, frameId, cfg, shortcuts) {
  const target = { tabId, frameIds: [frameId] };
  const config = Object.assign({}, cfg, shortcuts ? { shortcuts: 'on' } : {});
  await chrome.scripting.executeScript({ target, args: [config], func: c => { window.ARASUJI_CONFIG = c; } });
  await chrome.scripting.executeScript({ target, files: ['arasuji.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target,
    func: () => !!document.getElementById('arasuji-live'),
  });
  return result ? 'started' : 'no-sections';
}

// 戻り値：'started'（差し込んだ）・'recap'（すでに動いていたのであらすじを読んだ）・'running'（ページ側の arasuji が動いている）・
// 'no-sections'・'no-access'（どの frame も読めなかった）
async function inject(tabId, url) {
  const origin = originOf(url);
  if (!origin) return 'unsupported';
  const { override, shortcuts } = await getSettings(origin);
  const frames = await probeFrames(tabId, override);
  if (!frames || frames.length === 0) return 'no-access';

  const running = frames.find(f => f.running);
  if (running) {
    if (!running.hasApi) return 'running';
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [running.frameId] },
      func: () => window.Arasuji.recap(),
    });
    return 'recap';
  }

  const best = globalThis.ARASUJI_SITES.pick(frames);
  if (!best) return 'no-sections';
  return runIn(tabId, best.frameId, best.cfg, shortcuts);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'inject') {
    // ポップアップの「このページで使う」
    inject(msg.tabId, msg.url).then(sendResponse, e => sendResponse('error:' + e.message));
    return true; // 非同期で返す
  }
  // 「自動で使う」の content script（auto.js）から。節を数えるのは auto.js が frame の中でする
  if (msg.type === 'auto-settings' && sender.tab) {
    getSettings(originOf(sender.tab.url || '')).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'auto-run' && sender.tab) {
    // 設定は auto.js が同じ環境の window.ARASUJI_CONFIG に置いている
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
      files: ['arasuji.js'],
    }).catch(() => {});
  }
  return false;
});

// キーボードショートカット（Alt+Shift+A）。activeTab が付くので、自動の許可がないサイトでも動く
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'run-arasuji') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null && tab.url) inject(tab.id, tab.url).catch(() => {});
});

// 「自動で使う」にしたサイトでは、すべての frame に auto.js を登録する。
// iframe の中だけが入れ替わるサイト（次の教材へ移ったときなど）でも、読み込まれるたびに動く。
// 続けて呼ばれても登録が食い違わないよう、1つずつ順に行う
let syncing = Promise.resolve();
function syncAutoScript() {
  syncing = syncing.then(doSyncAutoScript).catch(e => console.error('[arasuji] 自動で使う設定を反映できませんでした:', e));
  return syncing;
}

async function doSyncAutoScript() {
  const { [AUTO_KEY]: auto = [] } = await chrome.storage.local.get(AUTO_KEY);
  const matches = [];
  for (const origin of auto) {
    if (await chrome.permissions.contains({ origins: [origin + '/*'] })) matches.push(origin + '/*');
  }
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  if (!matches.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
    return;
  }
  const script = {
    id: AUTO_SCRIPT_ID,
    matches,
    allFrames: true,
    js: ['sites.js', 'auto.js'],
    runAt: 'document_idle',
  };
  if (registered.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

// chrome://extensions などで権限を外されたときは、そのサイトを「自動で使う」からも外す
async function pruneAutoOrigins(removed) {
  const patterns = new Set(removed.origins || []);
  const { [AUTO_KEY]: auto = [] } = await chrome.storage.local.get(AUTO_KEY);
  const next = auto.filter(origin => !patterns.has(origin + '/*'));
  if (next.length !== auto.length) await chrome.storage.local.set({ [AUTO_KEY]: next }); // onChanged で反映される
  else syncAutoScript();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[AUTO_KEY]) syncAutoScript();
});
chrome.permissions.onRemoved.addListener(removed => { pruneAutoOrigins(removed).catch(() => syncAutoScript()); });
chrome.permissions.onAdded.addListener(() => { syncAutoScript(); });
chrome.runtime.onInstalled.addListener(() => { syncAutoScript(); });
chrome.runtime.onStartup.addListener(() => { syncAutoScript(); });
