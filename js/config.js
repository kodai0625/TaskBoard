/* Task Board 設定
   受け口は「個人」と「会社」で2つに分かれます（設計.md）。

   syncUrl … その側の受け口（Apps Script のウェブアプリURL）。
     ★ここ（元のコード）は空のままにします。URL の置き場は 設定.json（.gitignore 済み）で、
       公開用を作るときだけ 公開用/js/config.js に入ります。
     設定画面で入れた値の方が優先されます。
   合言葉（PIN）はどこにも書きません。端末ごとに設定画面で入れます。 */
var APP = {
  name: 'Task Board',
  version: 'f5eded0f',
  autoSyncSec: 60,     // 何秒ごとに自動で同期するか
  spaces: {
    personal: { label: '個人', syncUrl: '' },
    work:     { label: '会社', syncUrl: '' }
  }
};
