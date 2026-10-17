// scripts/generate.mjs で生成。人が確認してから使う
window.ARASUJI_DATA = Object.assign(window.ARASUJI_DATA || {}, {
  "getting-started": {
    "title": "はじめに",
    "sections": [
      {
        "order": 1,
        "heading": "インストール",
        "summary": "Tsumugi は Node.js の上で動きます。"
      },
      {
        "order": 2,
        "heading": "設定",
        "summary": "サイト全体の設定は tsumugi.config.js に書きます。"
      },
      {
        "order": 3,
        "heading": "使い方",
        "summary": "pages フォルダに Markdown のファイルを置くと、ファイル名がそのまま URL になります。"
      },
      {
        "order": 4,
        "heading": "書き出す",
        "summary": "公開用のファイルを作るには build を実行します。"
      }
    ],
    "points": {
      "1": "Tsumugi は Node.js の上で動きます。",
      "2": "サイト全体の設定は tsumugi.config.js に書きます。",
      "3": "pages フォルダに Markdown のファイルを置くと、ファイル名がそのまま URL になります。",
      "4": "公開用のファイルを作るには build を実行します。"
    }
  }
});
