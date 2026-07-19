// 全 settings 画面の save handler で共通に使うヘルパ。
//
// 目的:
//   1) 保存失敗時に draft / dirty を破棄しない (旧実装は楽観的 commit で失敗すると draft ロス)
//   2) 保存中は button を disabled 表示にして二重クリックを防ぐ
//   3) backend からのエラーを可能な限り日本語 + 具体的なフィールド指摘で表示

// backend の error から { field, detail, isValidation } を抽出。
// 1) 新形式: err.body = { error: 'Invalid expression', field, detail } を優先
// 2) 旧形式: err.message = "Invalid expression: <field>: expression error: <detail>" を parse (後方互換)
// 3) 認識不可: { field: null, detail: message, isValidation: false }
/** backend のエラーから抽出した内容。isValidation=true なら式のバリデーション由来 */
export interface ParsedBackendError {
  field: string | null;
  detail: string;
  isValidation: boolean;
}

export function parseBackendError(rawError: any): ParsedBackendError {
  // 構造化エラー (api.js が err.field / err.detail を attach 済み)
  if (rawError && (rawError.field || rawError.detail) && rawError.body?.error === 'Invalid expression') {
    return { field: rawError.field || null, detail: rawError.detail || '', isValidation: true };
  }
  const raw = String(rawError?.message || rawError || '');
  // 旧形式: Invalid expression: <field>: expression error: <detail>
  const m1 = /^Invalid expression:\s*([^:]+(?::[^:]+)*?):\s*expression error:\s*(.+)$/.exec(raw);
  if (m1) return { field: m1[1].trim(), detail: m1[2].trim(), isValidation: true };
  // Invalid expression: <field>: <detail>  (更に古い fallback)
  const m2 = /^Invalid expression:\s*(.+)$/.exec(raw);
  if (m2) return { field: null, detail: m2[1].trim(), isValidation: true };
  return { field: null, detail: raw, isValidation: false };
}

// AST validator が返す英文メッセージを日本語化。
const ERROR_MSG_MAP: [RegExp, (m: RegExpExecArray) => string][] = [
  [/Unknown identifier:\s*(\S+)/,           m => `使えない識別子: ${m[1]}`],
  [/Property access denied:\s*(\S+)/,       m => `使えないプロパティ: ${m[1]}`],
  [/Disallowed syntax:\s*(\S+)/,            m => `使えない構文: ${m[1]}`],
  [/Invalid callee:\s*(\S+)/,               m => `使えない関数呼び出し: ${m[1]}`],
  [/Computed member access must use a string literal/, () => '角括弧アクセスは文字列リテラルのみ使えます'],
  [/Binary operator not allowed:\s*(\S+)/,  m => `使えない二項演算子: ${m[1]}`],
  [/Logical operator not allowed:\s*(\S+)/, m => `使えない論理演算子: ${m[1]}`],
  [/Unary operator not allowed:\s*(\S+)/,   m => `使えない単項演算子: ${m[1]}`],
  [/Regex literals are not allowed/,        () => '正規表現リテラルは使えません'],
  [/BigInt literals are not allowed/,       () => 'BigInt リテラルは使えません'],
  [/Spread arguments are not allowed/,      () => 'スプレッド構文は使えません'],
  [/Spread in arrays is not allowed/,       () => '配列内のスプレッド構文は使えません'],
  [/Sparse arrays are not allowed/,         () => '疎な配列は使えません'],
  [/Invalid property/,                      () => 'プロパティが不正です'],
  [/Postfix unary not allowed/,             () => '後置の単項演算子は使えません'],
  [/Invalid template/,                      () => 'テンプレートリテラルが不正です'],
  [/expression too long/,                   () => '式が長すぎます (最大 2000 文字)'],
  [/must be a string/,                      () => '式は文字列で指定してください'],
  [/Unexpected token\s+'?([^']+?)'?$/,      m => `予期しない記号: ${m[1]}`],
  [/Unexpected end of input/,               () => '式が途中で終わっています'],
  [/Unexpected identifier/,                 () => '予期しない識別子があります'],
  [/Invalid or unexpected token/,           () => '不正な記号が含まれています'],
];

// backend の英文 detail を日本語化。マッチしなければ原文をそのまま返す。
export function translateBackendDetail(detail: any): string {
  const s = String(detail || '');
  for (const [re, fn] of ERROR_MSG_MAP) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return s;
}

// フィールドラベル (formulas.ctr / dimensions[op].expression / views.monthly.filter 等) を
// ユーザー向けに読みやすい形式に整形。マッチしなければ原文をそのまま返す。
export function friendlyFieldLabel(field: any): string {
  if (!field) return '';
  const s = String(field);
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^formulas\.(.+)$/,                     m => `メトリクス「${m[1]}」の計算式`],
    [/^baseFormulas\.(.+)$/,                 m => `基礎メトリクス「${m[1]}」の計算式`],
    [/^dimensions\[([^\]]*)\]\.expression$/, m => `ディメンション「${m[1]}」の計算式`],
    [/^views\.([^.]+)\.filter(Expr)?$/,     m => `タブ「${m[1]}」のフィルタ式`],
    [/^cards\[([^\]]*)\]\.filterExpr$/,      m => `カード「${m[1]}」のフィルタ式`],
  ];
  for (const [re, fn] of patterns) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return s;
}

// 保存失敗時のユーザー向けメッセージを組み立てる。
//   - 式エラー: 「メトリクス「ctr」の計算式にエラーがあります: 使えない識別子: process」
//   - ネットワークエラー: 「サーバーへの保存に失敗しました。...\n<原文>」
export function buildSaveErrorMessage(rawError: any): string {
  const parsed = parseBackendError(rawError);
  if (parsed.isValidation) {
    const label = friendlyFieldLabel(parsed.field);
    const detail = translateBackendDetail(parsed.detail);
    if (label) return `${label}にエラーがあります。\n\n${detail}`;
    return `式にエラーがあります。\n\n${detail}`;
  }
  return `サーバーへの保存に失敗しました。ネットワーク接続を確認してもう一度お試しください。\n\n${parsed.detail}`;
}

// 保存ボタンの loading / disabled を切替。
// rootEl を渡すと、その配下のフォーム要素 (input / textarea / select / button /
// dashboard-color-picker) も一括で disabled にする。保存中にユーザーが編集を続けて
// 「保存成功で dirty が消えるが実際は追加変更が残る」silent data loss を防ぐ。
// saving 状態の save btn だけは disabled 表示を維持 (spinner)。
export function setSaveButtonState(btn: HTMLElement | null, saving: boolean, rootEl?: HTMLElement | null) {
  if (btn) {
    if (saving) {
      btn.classList.add('saving');
      btn.setAttribute('disabled', '');
      btn.setAttribute('aria-busy', 'true');
    } else {
      btn.classList.remove('saving');
      btn.removeAttribute('disabled');
      btn.removeAttribute('aria-busy');
    }
  }
  if (rootEl) _setFormLocked(rootEl, saving, btn);
}

// フォーム全体を一時ロック。ロック解除時に元の状態 (disabled だった要素) は
// 復元する必要があるので、要素ごとに data-saveflow-prev-disabled を残す。
function _setFormLocked(rootEl: HTMLElement, locked: boolean, saveBtn: HTMLElement | null) {
  const targets = rootEl.querySelectorAll<HTMLElement>(
    'input, textarea, select, button, dashboard-color-picker'
  );
  for (const el of targets) {
    // save button 自体はロック中もフォーカス/表示を保つが disabled 属性は
    // saving indicator のためすでに立っている。二重処理しないためスキップ。
    if (el === saveBtn) continue;
    if (locked) {
      // 既に disabled 状態だった要素は解除時にも disabled のままにしたい
      if (el.hasAttribute('disabled')) {
        el.dataset.saveflowPrevDisabled = '1';
      } else {
        el.setAttribute('disabled', '');
        el.dataset.saveflowLocked = '1';
      }
    } else {
      // 自分がロックした要素だけ disabled を解除
      if (el.dataset.saveflowLocked === '1') {
        el.removeAttribute('disabled');
        delete el.dataset.saveflowLocked;
      }
      delete el.dataset.saveflowPrevDisabled;
    }
  }
  if (locked) rootEl.classList.add('saveflow-locked');
  else rootEl.classList.remove('saveflow-locked');
}
