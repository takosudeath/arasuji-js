const AUTO_KEY = 'autoOrigins';
const FIELDS = ['container', 'heading', 'end'];
const $ = id => document.getElementById(id);

const MESSAGES = {
  started: 'このページで使えるようにしました。',
  recap: 'あらすじを読み上げました。',
  running: 'このページではすでに arasuji が動いています。',
  'no-sections': '節の見出しが見つかりませんでした。「このサイトの設定」でコンテナと見出しを指定してください。',
  'no-access': 'このページの本文を読めませんでした。本文が別のサイトの iframe にあるときは、そのサイトへのアクセスの許可が要ります。',
  unsupported: 'このページでは使えません。',
};

function setStatus(text, isError) {
  $('status').textContent = text;
  $('status').classList.toggle('error', !!isError);
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let origin = null;
  try {
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) origin = u.origin;
  } catch (_) { /* 拡張のページなど */ }

  if (!origin) {
    $('site').textContent = 'このページでは使えません（http・https のページだけで使えます）。';
    for (const el of document.querySelectorAll('button, input')) el.disabled = true;
    return;
  }

  const site = window.ARASUJI_SITES.findSite(tab.url);
  const siteConfig = window.ARASUJI_SITES.configOf(site);
  $('site').textContent = site ? `${site.name}（設定済み）` : origin;

  const siteKey = `site:${origin}`;
  const stored = await chrome.storage.local.get([siteKey, AUTO_KEY, 'shortcuts']);
  const override = stored[siteKey] || {};
  for (const f of FIELDS) {
    $(f).value = override[f] || '';
    $(f).placeholder = siteConfig[f] ||(f === 'heading' ? 'h2' : f === 'container' ? '自動' : '');
  }
  if (FIELDS.some(f => override[f])) $('advanced').open = true;
  $('auto').checked = (stored[AUTO_KEY] || []).includes(origin);
  $('shortcuts').checked = !!stored.shortcuts;

  $('run').addEventListener('click', async () => {
    setStatus('');
    const result = await chrome.runtime.sendMessage({ type: 'inject', tabId: tab.id, url: tab.url });
    if (typeof result === 'string' && result.startsWith('error:')) {
      setStatus('使えませんでした：' + result.slice(6), true);
    } else {
      setStatus(MESSAGES[result] || String(result), ['no-sections', 'no-access', 'unsupported'].includes(result));
      if (result === 'started' || result === 'recap') setTimeout(() => window.close(), 900);
    }
  });

  // 自動で使うには、そのサイトを開いたことを拡張が知る必要があるので、サイトごとに権限を求める
  $('auto').addEventListener('change', async () => {
    const list = new Set((await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] || []);
    if ($('auto').checked) {
      const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
      if (!granted) {
        $('auto').checked = false;
        setStatus('サイトへのアクセスが許可されなかったので、自動では使えません。', true);
        return;
      }
      list.add(origin);
      setStatus('次からこのサイトを開くと自動で使います。');
    } else {
      list.delete(origin);
      await chrome.permissions.remove({ origins: [origin + '/*'] }).catch(() => {});
      setStatus('自動で使うのをやめました。');
    }
    await chrome.storage.local.set({ [AUTO_KEY]: [...list] });
  });

  $('shortcuts').addEventListener('change', async () => {
    await chrome.storage.local.set({ shortcuts: $('shortcuts').checked });
    setStatus('次にページで使うときから反映されます。');
  });

  $('save').addEventListener('click', async () => {
    const next = {};
    for (const f of FIELDS) {
      const v = $(f).value.trim();
      if (v) next[f] = v;
    }
    if (Object.keys(next).length) await chrome.storage.local.set({ [siteKey]: next });
    else await chrome.storage.local.remove(siteKey);
    setStatus('保存しました。ページを再読み込みしてから使ってください。');
  });
}

main();
