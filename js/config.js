/* Task Board 設定
   受け口は1つ（個人の Google アカウント。2026-09-26 決定）。
   プライベート（personal）と仕事（work）は、受け口の中の別々のタブに入ります（設計.md）。

   syncUrl … 受け口（Apps Script のウェブアプリURL）。
     ★ここ（元のコード）は空のままにします。URL の置き場は 設定.json（.gitignore 済み）で、
       公開用を作るときだけ 公開用/js/config.js に入ります。
     設定画面で入れた値の方が優先されます。
   合言葉（PIN）はどこにも書きません。端末ごとに設定画面で入れます。 */
var APP = {
  name: 'Task Board',
  version: 'ba0ffcc0',
  autoSyncSec: 60,     // 何秒ごとに自動で同期するか
  syncUrl: '',
  spaces: {
    personal: { label: '個人' },
    work:     { label: '会社' }
  }
};
