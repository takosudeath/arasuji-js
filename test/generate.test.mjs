import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  parsePage, extractContainer, cutAtEndMarker, toText, decodeEntities,
  summarizePage, firstSentence, clean, PROVIDERS, render,
} from '../scripts/generate.mjs';

describe('decodeEntities', () => {
  test('名前付き・10進・16進の文字参照を戻す', () => {
    assert.equal(decodeEntities('&lt;a&gt; &amp; &quot;x&quot; &apos;y&apos;'), `<a> & "x" 'y'`);
    assert.equal(decodeEntities('&#12354;&#x3044;&#X3046;'), 'あいう');
    assert.equal(decodeEntities('A&nbsp;B'), 'A B');
  });

  test('知らない名前はそのまま残す', () => {
    assert.equal(decodeEntities('&copy; &unknown;'), '&copy; &unknown;');
  });
});

describe('toText', () => {
  test('タグ・コメント・script・style を除き、空白を詰める', () => {
    const html = '<p>一行目\n  <b>太字</b></p><!-- メモ --><script>var x = "<p>";</script><style>p{}</style><p>二行目</p>';
    assert.equal(toText(html), '一行目 太字 二行目');
  });

  test('img は alt を本文として残す', () => {
    assert.equal(toText('前<img src="a.svg" alt="関数の図">後'), '前 関数の図 後');
    assert.equal(toText("前<img alt='図' src=x>後"), '前 図 後');
    assert.equal(toText('前<img src="a.svg">後'), '前 後');
  });

  test('文字参照を戻す', () => {
    assert.equal(toText('<code>a &lt; b</code>'), 'a < b');
  });
});

describe('extractContainer', () => {
  test('タグ名で探し、入れ子の同じタグを数えて閉じタグを見つける', () => {
    const html = '<body><main><div><main>内</main></div>外</main>後ろ</body>';
    assert.equal(extractContainer(html, 'main'), '<div><main>内</main></div>外');
  });

  test('クラス名で探す（ほかのクラスと並んでいてもよい）', () => {
    const html = '<div class="x"><section class="main-content markdown-section">本文<section>入れ子</section></section><p>外</p></div>';
    assert.equal(extractContainer(html, '.markdown-section'), '本文<section>入れ子</section>');
  });

  test('クラス名の一部だけが合うものは選ばない', () => {
    const html = '<div class="markdown-section-old">古い</div><div class="markdown-section">新しい</div>';
    assert.equal(extractContainer(html, '.markdown-section'), '新しい');
  });

  test('見つからなければ null', () => {
    assert.equal(extractContainer('<div>本文</div>', 'main'), null);
    assert.equal(extractContainer('<div>本文</div>', '.none'), null);
  });

  test('閉じタグがなければ最後までを返す', () => {
    assert.equal(extractContainer('<main>終わらない', 'main'), '終わらない');
  });
});

describe('cutAtEndMarker', () => {
  test('目印の要素から後ろを捨てる', () => {
    const body = '<h2>節</h2><p>本文</p><div class="share-button-wrapper"><h2>共有</h2></div>';
    assert.equal(cutAtEndMarker(body, '.share-button-wrapper'), '<h2>節</h2><p>本文</p>');
  });

  test('目印がなければそのまま', () => {
    assert.equal(cutAtEndMarker('<p>本文</p>', '.none'), '<p>本文</p>');
  });

  test('クラス名でない指定は警告してそのまま返す', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      assert.equal(cutAtEndMarker('<p>本文</p><footer>x</footer>', 'footer'), '<p>本文</p><footer>x</footer>');
      assert.equal(warn.mock.calls.length, 1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('parsePage', () => {
  const html = `<!DOCTYPE html><html><head><title>題 | サイト</title></head><body>
    <h1>ヘッダーの題</h1>
    <section class="markdown-section">
      <h1>本文の題</h1>
      <p>導入</p>
      <ul id="toc"><li>目次</li></ul>
      <h2 id="a">一つ目</h2><p>A の本文。続き。</p>
      <h3>小見出し</h3><p>A の続き</p>
      <h2 class="x">二つ<b>目</b></h2><p>B の本文</p>
      <div class="share-button-wrapper"><h2>共有</h2></div>
    </section>
  </body></html>`;
  const site = { container: '.markdown-section', heading: 'h2', end: '.share-button-wrapper' };

  test('見出しごとに節に分け、先頭のかたまりと終わりの目印から後ろは捨てる', () => {
    assert.deepEqual(parsePage(html, site), {
      title: '本文の題',
      sections: [
        { order: 1, heading: '一つ目', text: 'A の本文。続き。 小見出し A の続き' },
        { order: 2, heading: '二つ 目', text: 'B の本文' },
      ],
    });
  });

  test('end がなければ、目印の中の見出しも節になる', () => {
    const page = parsePage(html, { container: '.markdown-section', heading: 'h2' });
    assert.deepEqual(page.sections.map(s => s.heading), ['一つ目', '二つ 目', '共有']);
  });

  test('見出しのタグは大文字で書いてもよい', () => {
    const page = parsePage('<main><H2>節</H2>本文</main>', { container: 'main', heading: 'H2' });
    assert.deepEqual(page.sections, [{ order: 1, heading: '節', text: '本文' }]);
  });

  test('題はコンテナの h1 → ページの h1 → title の順に取る', () => {
    assert.equal(parsePage('<h1>外</h1><main><h2>節</h2></main>', { container: 'main', heading: 'h2' }).title, '外');
    assert.equal(parsePage('<title>T</title><main><h2>節</h2></main>', { container: 'main', heading: 'h2' }).title, 'T');
    assert.equal(parsePage('<main><h2>節</h2></main>', { container: 'main', heading: 'h2' }).title, '');
  });

  test('コンテナか見出しがなければ null', () => {
    assert.equal(parsePage('<div><h2>節</h2></div>', { container: 'main', heading: 'h2' }), null);
    assert.equal(parsePage('<main><p>本文</p></main>', { container: 'main', heading: 'h2' }), null);
  });
});

describe('firstSentence', () => {
  test('最初の「。」までを返す', () => {
    assert.equal(firstSentence('一文目。二文目。'), '一文目。');
  });

  test('「。」がなければ全体', () => {
    assert.equal(firstSentence('句点なし'), '句点なし');
  });
});

describe('clean', () => {
  test('最初の空でない行だけを使い、句点で終える', () => {
    assert.equal(clean('\n\n  関数の定義を学ぶ  \n二行目'), '関数の定義を学ぶ。');
    assert.equal(clean('関数を学ぶ。'), '関数を学ぶ。');
  });

  test('think タグを除く', () => {
    assert.equal(clean('<think>考え中\nです</think>\n答え'), '答え。');
  });

  test('「要約：」などの前置きと Markdown の飾りを除く', () => {
    assert.equal(clean('要約：関数を学ぶ'), '関数を学ぶ。');
    assert.equal(clean('- この節で学ぶこと: 関数'), '関数。');
    // 太字の閉じがコロンの後ろでも前でもよい
    assert.equal(clean('**要点:** 関数を学ぶ'), '関数を学ぶ。');
    assert.equal(clean('**要点**: 関数を学ぶ'), '関数を学ぶ。');
    assert.equal(clean('**節要約：**関数を学ぶ'), '関数を学ぶ。');
    assert.equal(clean('**関数を学ぶ**'), '関数を学ぶ。');
  });

  test('全体を囲む括弧や引用符を（重なっていても）外す', () => {
    assert.equal(clean('「関数を学ぶ」'), '関数を学ぶ。');
    assert.equal(clean('"『関数を学ぶ』"'), '関数を学ぶ。');
    assert.equal(clean('“関数を学ぶ”'), '関数を学ぶ。');
  });

  test('一部だけの括弧は残す', () => {
    assert.equal(clean('「関数」を学ぶ'), '「関数」を学ぶ。');
  });

  test('末尾の読点やピリオドを句点にそろえる', () => {
    assert.equal(clean('関数を学ぶ、'), '関数を学ぶ。');
    assert.equal(clean('関数を学ぶ.'), '関数を学ぶ。');
  });

  test('空や null は空文字', () => {
    assert.equal(clean(''), '');
    assert.equal(clean(null), '');
    assert.equal(clean(undefined), '');
    assert.equal(clean('<think>だけ</think>'), '');
  });
});

describe('summarizePage', () => {
  const page = {
    title: '題',
    sections: [
      { order: 1, heading: 'A', text: 'A の本文。続き。' },
      { order: 2, heading: 'B', text: 'B の本文。' },
    ],
  };

  test('AI なしでは本文の1文目を要約にも要点にも使う', async () => {
    assert.deepEqual(await summarizePage('p', page, null), {
      title: '題',
      sections: [
        { order: 1, heading: 'A', summary: 'A の本文。' },
        { order: 2, heading: 'B', summary: 'B の本文。' },
      ],
      points: { 1: 'A の本文。', 2: 'B の本文。' },
    });
  });

  test('要点には、その位置までの節要約を見出しつきで渡す', async () => {
    const calls = [];
    const ai = async (system, user) => {
      calls.push({ system, user });
      return calls.length <= 2 ? `要約${calls.length}` : `要点${calls.length - 2}`;
    };
    const result = await summarizePage('p', page, ai);

    assert.equal(calls.length, 4);
    assert.equal(calls[0].user, 'A の本文。続き。');
    assert.equal(calls[1].user, 'B の本文。');
    assert.equal(calls[2].user, '「A」：要約1。');
    assert.equal(calls[3].user, '「A」：要約1。\n「B」：要約2。');
    assert.notEqual(calls[0].system, calls[2].system);
    assert.deepEqual(result.points, { 1: '要点1。', 2: '要点2。' });
  });

  test('空の要約・長すぎる要点は警告する（値はそのまま使う）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const long = 'あ'.repeat(40);
      const ai = async (system, user) => (user.startsWith('「') ? long : '');
      const result = await summarizePage('p', page, ai);
      assert.equal(result.sections[0].summary, '');
      assert.equal(result.points[1], `${long}。`);
      const messages = warn.mock.calls.map(c => c[0]);
      assert.equal(messages.filter(m => m.includes('節要約が空')).length, 2);
      assert.equal(messages.filter(m => m.includes('35字を超えています')).length, 2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('render', () => {
  test('既存の ARASUJI_DATA に足す形の JS を書き出す', () => {
    const data = { p: { title: '題', sections: [], points: {} } };
    const js = render(data);
    const window = { ARASUJI_DATA: { other: 1 } };
    new Function('window', js)(window);
    assert.deepEqual(window.ARASUJI_DATA, { other: 1, ...data });
  });
});

// ---------------------------------------------------------------------------
// プロバイダー（fetch を差し替えて、送る内容と受け取り方を確かめる）

describe('PROVIDERS', () => {
  let requests;
  let reply;
  const saved = {};
  const ENV = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MY_KEY'];

  beforeEach(() => {
    requests = [];
    reply = { status: 200, body: {} };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(reply.body), { status: reply.status, statusText: 'Bad' });
    });
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('workers-ai', () => {
    beforeEach(() => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
      process.env.CLOUDFLARE_API_TOKEN = 'tok';
    });

    test('アカウントとモデルの URL に送り、response を返す', async () => {
      reply.body = { success: true, result: { response: '答え' } };
      const ai = PROVIDERS['workers-ai']({ model: '@cf/x/y' });
      assert.equal(await ai('sys', 'usr'), '答え');
      assert.equal(requests[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/x/y');
      assert.equal(requests[0].headers.Authorization, 'Bearer tok');
      assert.deepEqual(requests[0].body.messages, [
        { role: 'system', content: 'sys' }, { role: 'user', content: 'usr' },
      ]);
    });

    test('choices の形でも受け取る', async () => {
      reply.body = { result: { choices: [{ message: { content: '答え' } }] } };
      assert.equal(await PROVIDERS['workers-ai']({ model: 'm' })('s', 'u'), '答え');
    });

    test('success: false は失敗にする', async () => {
      reply.body = { success: false, errors: [{ message: 'x' }] };
      await assert.rejects(PROVIDERS['workers-ai']({ model: 'm' })('s', 'u'), /Workers AI の呼び出しに失敗しました/);
    });
  });

  describe('openai', () => {
    test('baseURL の末尾の / をそろえ、キーがあれば付ける', async () => {
      process.env.MY_KEY = 'k';
      reply.body = { choices: [{ message: { content: '答え' } }] };
      const ai = PROVIDERS.openai({ model: 'gpt', baseURL: 'http://localhost:11434/v1/', apiKeyEnv: 'MY_KEY' });
      assert.equal(await ai('sys', 'usr'), '答え');
      assert.equal(requests[0].url, 'http://localhost:11434/v1/chat/completions');
      assert.equal(requests[0].headers.Authorization, 'Bearer k');
      assert.equal(requests[0].body.model, 'gpt');
    });

    test('キーがなくても送る（ローカルの Ollama など）', async () => {
      reply.body = { choices: [] };
      const ai = PROVIDERS.openai({ model: 'gpt' });
      assert.equal(await ai('s', 'u'), '');
      assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(requests[0].headers.Authorization, undefined);
    });

    test('HTTP エラーは中身を添えて失敗にする', async () => {
      reply = { status: 401, body: { error: { message: 'bad key' } } };
      await assert.rejects(PROVIDERS.openai({ model: 'gpt' })('s', 'u'), /（401）.*bad key/);
    });
  });

  describe('anthropic', () => {
    beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'ak'; });

    test('system を分けて送り、text のブロックだけをつなぐ', async () => {
      reply.body = { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '答' }, { type: 'text', text: 'え' }] };
      const ai = PROVIDERS.anthropic({ model: 'claude-x' });
      assert.equal(await ai('sys', 'usr'), '答え');
      assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
      assert.equal(requests[0].headers['x-api-key'], 'ak');
      assert.equal(requests[0].headers['anthropic-version'], '2023-06-01');
      assert.equal(requests[0].body.system, 'sys');
      assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'usr' }]);
      assert.equal('output_config' in requests[0].body, false);
    });

    test('effort を指定すると output_config に入れる', async () => {
      reply.body = { content: [] };
      await PROVIDERS.anthropic({ model: 'claude-x', effort: 'low' })('s', 'u');
      assert.deepEqual(requests[0].body.output_config, { effort: 'low' });
    });

    test('断られたら警告して空文字を返す', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      reply.body = { stop_reason: 'refusal', stop_details: {}, content: [{ type: 'text', text: '無理' }] };
      assert.equal(await PROVIDERS.anthropic({ model: 'claude-x' })('s', 'u'), '');
      assert.equal(warn.mock.calls.length, 1);
    });
  });
});
