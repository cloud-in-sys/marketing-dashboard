// dashboard-color-picker: vanilla-colorful (3KB) を <input type="color"> の互換ラッパで
// 各設定パネルに差し替えるためのカスタム要素。
// - HEX 表示固定 (RGB/HSL 切替なし)
// - 視覚 picker (vanilla-colorful の hex-color-picker) + 直接 HEX 入力 (text)
// - input/change イベントを bubble させるので既存の onPanelChange 系がそのまま動く
// vanilla-colorful は外部 CDN 障害 / CSP / オフライン環境で main.js の module graph が壊れる
// のを避けるため、src/vendor/vanilla-colorful/ にローカル vendor 化している。
import '../../vendor/vanilla-colorful/hex-color-picker.js';

const RE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// グローバル open カウンタ。各設定パネルの再 render は、ピッカーが開いている間スキップして
// ドラッグ中の picker DOM が破棄されないようにする。
let _openCount = 0;
export function isAnyColorPickerOpen() { return _openCount > 0; }

class DashboardColorPicker extends HTMLElement {
  static get observedAttributes() { return ['value', 'disabled']; }

  constructor() {
    super();
    this._open = false;
    this._docClickHandler = (e) => {
      if (!this.contains(e.target) && this._popover && !this._popover.contains(e.target) && this._open) this._close();
    };
    // popover が position:fixed なので、スクロールしたら swatch と位置がズレる。
    // 閉じるのではなく、開いてる間はスクロールに追従して位置を再計算する。
    // (開く瞬間に focus 由来のスクロールが起こると、close 方式だと即閉じてしまう)
    this._scrollHandler = () => { if (this._open) this._adjustPosition(); };
  }

  connectedCallback() {
    if (!this._built) {
      this._build();
      this._built = true;
    }
    this._syncFromAttr();
    document.addEventListener('click', this._docClickHandler);
    window.addEventListener('scroll', this._scrollHandler, true);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._docClickHandler);
    window.removeEventListener('scroll', this._scrollHandler, true);
    // body 直下に逃がした popover が残ったままにならないように除去
    if (this._popover && this._popover.parentElement === document.body) {
      this._popover.remove();
    }
    // _open のまま切断されると次回 _close() が detached node を触るので、フラグを戻す。
    if (this._open) {
      this._open = false;
      _openCount = Math.max(0, _openCount - 1);
    }
    // _built も戻して、再接続時に再構築できるようにする (popover が remove() された後の保険)。
    this._built = false;
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._built) return;
    if (name === 'value' && oldVal !== newVal) this._syncFromAttr();
    if (name === 'disabled') this._syncDisabled();
  }

  get value() { return this.getAttribute('value') || ''; }
  set value(v) {
    if (v) this.setAttribute('value', v);
    else this.removeAttribute('value');
  }

  _build() {
    const initial = this.getAttribute('value') || '#ffffff';
    // 親が draggable="true" でも、picker を draggable="false" にして drag 開始を弾く。
    this.setAttribute('draggable', 'false');
    this.innerHTML = `
      <button type="button" class="dcp-swatch" draggable="false" style="background:${initial}" aria-label="色を選択"></button>
      <div class="dcp-popover hidden" role="dialog">
        <hex-color-picker color="${initial}"></hex-color-picker>
        <div class="dcp-hex-row">
          <span class="dcp-hash">#</span>
          <input type="text" class="dcp-hex" value="${initial.replace(/^#/, '')}" maxlength="6" autocomplete="off" spellcheck="false">
        </div>
      </div>
    `;
    this._swatch = this.querySelector('.dcp-swatch');
    this._popover = this.querySelector('.dcp-popover');
    this._picker = this.querySelector('hex-color-picker');
    this._hexInput = this.querySelector('.dcp-hex');

    // クリックは custom element 全体で拾う。popover 内のクリックは開閉対象外。
    this.addEventListener('click', (e) => {
      if (this._popover && this._popover.contains(e.target)) return;
      if (this.hasAttribute('disabled')) return;
      this._open ? this._close() : this._openPopover();
    });
    // 念のため drag 起動を picker 内で弾く。
    this.addEventListener('dragstart', (e) => e.preventDefault());

    // vanilla-colorful の picker からの変更
    this._picker.addEventListener('color-changed', (e) => {
      const v = e.detail.value; // "#rrggbb"
      if (this._suppressEvent) return;
      this._setValue(v, /*fromUser=*/ true);
      this._hexInput.value = v.replace(/^#/, '');
    });

    // HEX text 入力からの変更
    this._hexInput.addEventListener('input', () => {
      const raw = this._hexInput.value.trim();
      const candidate = '#' + raw;
      if (RE_HEX.test(candidate)) {
        this._setValue(candidate, /*fromUser=*/ true);
        // picker 側にも反映 (color-changed の再帰防止のため suppress)
        this._suppressEvent = true;
        this._picker.color = candidate;
        this._suppressEvent = false;
      }
    });
    this._hexInput.addEventListener('blur', () => {
      // 無効な状態で blur したら最後の有効値に戻す
      const raw = this._hexInput.value.trim();
      const candidate = '#' + raw;
      if (!RE_HEX.test(candidate)) {
        this._hexInput.value = (this.getAttribute('value') || '#ffffff').replace(/^#/, '');
      }
    });
  }

  _setValue(v, fromUser = false) {
    if (this.getAttribute('value') === v) return;
    this.setAttribute('value', v);
    this._swatch.style.background = v;
    if (fromUser) {
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  _syncFromAttr() {
    const v = this.getAttribute('value') || '#ffffff';
    this._swatch.style.background = v;
    if (this._picker) {
      this._suppressEvent = true;
      this._picker.color = v;
      this._suppressEvent = false;
    }
    if (this._hexInput) this._hexInput.value = v.replace(/^#/, '');
  }

  _syncDisabled() {
    const d = this.hasAttribute('disabled');
    if (this._swatch) this._swatch.disabled = d;
    if (this._hexInput) this._hexInput.disabled = d;
    if (d) this._close();
  }

  _openPopover() {
    if (!this._open) _openCount++;
    this._open = true;
    // 祖先要素に transform / filter / will-change が当たっていると position:fixed が
    // viewport 基準にならない (containing block が変わる)。
    // popover を document.body に逃がすことでこの罠を回避する。
    if (this._popover.parentElement !== document.body) {
      document.body.appendChild(this._popover);
    }
    this._popover.classList.remove('hidden');
    // CSS の .hidden { display:none !important; } を inline style で上書き。
    this._popover.style.setProperty('display', 'flex', 'important');
    this._adjustPosition();
  }
  _close() {
    const wasOpen = this._open;
    if (wasOpen) _openCount = Math.max(0, _openCount - 1);
    this._open = false;
    this._popover.classList.add('hidden');
    this._popover.style.removeProperty('display');
    if (this._popover.parentElement !== this) {
      this.appendChild(this._popover);
    }
    // 開いてた間にスキップされた設定パネルの再 render を、最後のピッカーが閉じた
    // タイミングで流す。これがないと「色変更直後はリセットボタンが押せない」
    // 「リセット赤斜線が消えない」など、パネルの UI ステートが古いまま残る。
    if (wasOpen && _openCount === 0) {
      document.dispatchEvent(new CustomEvent('dashboard-picker-closed'));
    }
  }
  _adjustPosition() {
    const swatchRect = this._swatch.getBoundingClientRect();
    const pop = this._popover;
    pop.style.position = 'fixed';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    pop.style.left = '0px';
    pop.style.top = '0px';
    const popRect = pop.getBoundingClientRect();
    const popW = popRect.width;
    const popH = popRect.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = swatchRect.left;
    let top = swatchRect.bottom + 6;
    if (top + popH > vh - 8) top = swatchRect.top - popH - 6;
    left = Math.max(8, Math.min(left, vw - popW - 8));
    top = Math.max(8, Math.min(top, vh - popH - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
}

customElements.define('dashboard-color-picker', DashboardColorPicker);
