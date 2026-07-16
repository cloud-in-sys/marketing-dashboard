// ===== カスタムタブ / 共有 state の検証と認可 =====
// カスタムタブは shared config の 2 箇所に分かれて入っている:
//   customTabs        … タブの定義 (key / label / color / group / presetName) と並び順
//   state.tabStates   … 各タブの表示設定 (dims / metrics / thresholds / tableConfig)
// frontend は CSS (no-add-custom 等) とハンドラでゲート済みだが、API を直接叩けば
// 誰でも他人のタブを追加・改名・削除できてしまうため、backend でも同じ権限で守る。
//
// Firestore に依存しない純粋関数なので、単体で import してテストできる。

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ===== 形式検証 =====
// 認可より先に走らせること。非配列を「空配列」とみなして認可だけ通すと、保存時には
// 生の不正値がそのまま書かれてしまう (例: customTabs:{} が Firestore に入り、
// フロントの Array.isArray チェックで全タブが消えたように見える)。
// 問題があればエラーメッセージ、なければ null を返す。
export function validateCustomTabs(tabs) {
  if (!Array.isArray(tabs)) return 'customTabs must be an array';
  const seen = new Set();
  for (const t of tabs) {
    if (!isPlainObject(t)) return 'customTabs entries must be objects';
    if (typeof t.key !== 'string' || !t.key.trim()) {
      return 'customTabs entry requires a non-empty string key';
    }
    // key の重複はタブが二重表示され、編集/削除の対象が不定になる
    if (seen.has(t.key)) return `duplicate customTabs key: ${t.key}`;
    seen.add(t.key);
  }
  return null;
}

// ===== 認可 =====
// 差分から必要な権限を判定して、足りない権限キーを返す (問題なければ null):
//   タブが増えた   → addCustom
//   タブが減った   → deleteCustom
//   それ以外の変更 → editCustom (リネーム / 色 / グループ / 並び順 / presetName)
// afterTabs は validateCustomTabs を通った配列であること。
export function customTabsViolation(beforeTabs, afterTabs, user) {
  if (user?.isAdmin) return null;
  const prev = Array.isArray(beforeTabs) ? beforeTabs : [];
  const next = Array.isArray(afterTabs) ? afterTabs : [];
  const keys = list => new Set(list.map(t => t?.key));
  const prevKeys = keys(prev);
  const nextKeys = keys(next);
  const perms = user?.perms || {};
  if ([...nextKeys].some(k => !prevKeys.has(k)) && !perms.addCustom) return 'addCustom';
  if ([...prevKeys].some(k => !nextKeys.has(k)) && !perms.deleteCustom) return 'deleteCustom';
  // 追加/削除ぶんを除いた「両方に存在するタブ」だけを比べる。これで追加のみ・削除のみの
  // 変更が editCustom を巻き込まない (並び順の差も survivors の順序として拾える)。
  const survivors = arr => JSON.stringify(arr.filter(t => prevKeys.has(t?.key) && nextKeys.has(t?.key)));
  if (survivors(prev) !== survivors(next) && !perms.editCustom) return 'editCustom';
  return null;
}

// tabStates は customTabs と同じ権限で守るが、saveState() が render のたびに送るため
// 403 にすると正規化のわずかな差でも閲覧者にエラーが出続ける。拒否ではなく
// 「権限のない変更だけを元の値に巻き戻す」方式にして、権限のある変更だけ通す。
// beforeTabs / nextTabs はどちらも tabStates マップ (state 全体ではない)。
function sanitizeTabStates(beforeTabs, nextTabs, user) {
  const prevTabs = isPlainObject(beforeTabs) ? beforeTabs : {};
  // 省略時・不正形式は既存値を維持する (省略を「全削除」と解釈しない)
  if (!isPlainObject(nextTabs)) return prevTabs;
  if (user?.isAdmin) return nextTabs;
  const perms = user?.perms || {};
  const out = { ...nextTabs };
  for (const k of Object.keys(out)) {
    if (!(k in prevTabs)) {
      if (!perms.addCustom) delete out[k];              // 追加権限なし → 追加を無かったことに
    } else if (!perms.editCustom && JSON.stringify(out[k]) !== JSON.stringify(prevTabs[k])) {
      out[k] = prevTabs[k];                             // 編集権限なし → 元の値を保つ
    }
  }
  if (!perms.deleteCustom) {
    for (const k of Object.keys(prevTabs)) {
      if (!(k in out)) out[k] = prevTabs[k];            // 削除権限なし → 消させない
    }
  }
  return out;
}

// ===== 共有 state の検証 + 認可再構築 =====
// state = { charts, cards, currentView, tabStates } の共有ドキュメント。
//
// 受信値をそのまま保存すると、権限のないユーザーが {state:null} や {state:{}} を
// 送るだけで共有設定を丸ごと消せてしまう。そこで「既存値を土台に、送られてきた
// キーだけを上書きする」方式で組み立て直し、省略による削除を成立させない。
//
// 各フィールドの認可:
//   tabStates            … addCustom / editCustom / deleteCustom (sanitizeTabStates)
//   charts / cards       … ゲートなし。UI 側にも権限ゲートが無く、閲覧者を含む全員が
//                          追加・削除できる既存仕様に合わせている (意図的な素通し)。
//   currentView          … ゲートなし。per-user の現在タブは users/{uid}.userState 側に
//                          別途あり、こちらは共有の初期表示タブという位置づけ。
//
// 戻り値: { error } (400 にすべき) か { state } (保存してよい値)。
export function sanitizeState(beforeState, nextState, user) {
  const before = isPlainObject(beforeState) ? beforeState : {};
  // 省略 → 既存値をそのまま維持 (PUT でのフィールド省略による削除を防ぐ)
  if (nextState === undefined) return { state: before };
  if (!isPlainObject(nextState)) return { error: 'state must be an object' };
  if ('tabStates' in nextState && !isPlainObject(nextState.tabStates)) {
    return { error: 'state.tabStates must be an object' };
  }
  const merged = { ...before, ...nextState };
  merged.tabStates = sanitizeTabStates(before.tabStates, nextState.tabStates, user);
  return { state: merged };
}
