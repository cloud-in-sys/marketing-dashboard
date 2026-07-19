// ===== Promise-based custom modal =====

export interface ModalOptions {
  title?: string;
  body?: string;
  /** true なら body を innerHTML として入れる (呼び出し側でエスケープ済みであること) */
  html?: boolean;
  wide?: boolean;
  /** true なら入力欄を出す。resolve される値が boolean ではなく入力文字列になる */
  input?: boolean;
  defaultValue?: string;
  placeholder?: string;
  okText?: string;
  /** 空文字ならキャンセルボタンを出さない */
  cancelText?: string;
  danger?: boolean;
  /** Enter での確定を無効にする */
  noEnter?: boolean;
}

// input の有無で解決値が変わるのでオーバーロードで表す。
//   input: true  → 入力文字列 (キャンセルは null)
//   それ以外     → true (キャンセルは null)
// これが無いと戻り値が常に `string | true | null` になり、呼び出し側で
// API へ渡すときに毎回キャストが要る (= 型が守ってくれない)。
export function showModal(opts: ModalOptions & { input: true }): Promise<string | null>;
export function showModal(opts: ModalOptions & { input?: false | undefined }): Promise<true | null>;
export function showModal(opts: ModalOptions): Promise<string | true | null>;
export function showModal({title, body, html = false, wide = false, input = false, defaultValue = '', placeholder = '', okText = 'OK', cancelText = '\u30ad\u30e3\u30f3\u30bb\u30eb', danger = false, noEnter = false}: ModalOptions): Promise<string | true | null> {
  // 各要素は index.html に静的に存在する前提 (だから元コードも null チェックしていない)。
  // ここで型の上だけ ! を付けており、実行時の挙動は変えていない。
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay')!;
    const modalEl = overlay.querySelector('.modal');
    if (modalEl) modalEl.classList.toggle('wide', !!wide);
    document.getElementById('modal-title')!.textContent = title || '';
    const bodyEl = document.getElementById('modal-body')!;
    if (html) bodyEl.innerHTML = body || '';
    else bodyEl.textContent = body || '';
    const inputEl = document.getElementById('modal-input') as HTMLInputElement;
    inputEl.classList.toggle('hidden', !input);
    inputEl.value = defaultValue;
    inputEl.placeholder = placeholder;
    const okBtn = document.getElementById('modal-ok')!;
    const cancelBtn = document.getElementById('modal-cancel')!;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    (cancelBtn as HTMLElement).style.display = cancelText ? '' : 'none';
    okBtn.classList.toggle('danger', !!danger);
    overlay.classList.remove('hidden');
    if (input) setTimeout(() => inputEl.focus(), 50);
    const cleanup = () => {
      overlay.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      inputEl.onkeydown = null;
    };
    const confirm = () => { const v = input ? inputEl.value : true; cleanup(); resolve(v); };
    const cancel = () => { cleanup(); resolve(null); };
    (okBtn as HTMLElement).onclick = confirm;
    (cancelBtn as HTMLElement).onclick = cancel;
    (overlay as HTMLElement).onclick = e => { if (e.target === overlay) cancel(); };
    inputEl.onkeydown = e => {
      if (e.key === 'Enter' && !noEnter) confirm();
      else if (e.key === 'Escape') cancel();
    };
  });
}
