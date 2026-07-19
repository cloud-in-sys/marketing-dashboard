// ===== Floating multi-select menu manager =====
// 同時に開けるメニューは1つ。開く時は document.body 直下に移動し、
// position:fixed でボタン基準に配置する。閉じる時は元の .ms に戻す。
interface FloatingMs {
  menu: HTMLElement;
  btn: HTMLElement;
  /** 元の親 (.ms)。閉じる時にここへ戻す */
  ms: HTMLElement | null;
  reposition: (e?: Event) => void;
}
let _floatingMs: FloatingMs | null = null;

function positionFloatingMs(menu: HTMLElement, btn: HTMLElement) {
  if (!btn.isConnected) { closeFloatingMs(); return; }
  const rect = btn.getBoundingClientRect();
  const margin = 8;
  const minWidth = Math.max(rect.width, 240);
  const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
  // width を auto にして内容ベースで伸びるようにし、最小=ボタン幅 (or 240px)、
  // 最大=viewport-16px。長すぎる場合のみ option 側で ellipsis される。
  menu.style.width = '';
  menu.style.minWidth = minWidth + 'px';
  menu.style.maxWidth = maxWidth + 'px';
  menu.style.maxHeight = '';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const naturalHeight = menu.offsetHeight;
  const naturalWidth = menu.offsetWidth;
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top: number, maxH: number;
  if (naturalHeight <= spaceBelow) {
    top = rect.bottom + 4;
    maxH = Math.min(380, spaceBelow);
  } else if (naturalHeight <= spaceAbove) {
    top = rect.top - naturalHeight - 4;
    maxH = Math.min(380, spaceAbove);
  } else if (spaceBelow >= spaceAbove) {
    maxH = Math.max(140, spaceBelow);
    top = rect.bottom + 4;
  } else {
    maxH = Math.max(140, spaceAbove);
    top = rect.top - maxH - 4;
  }
  let left = rect.left;
  if (left + naturalWidth > window.innerWidth - margin) left = window.innerWidth - naturalWidth - margin;
  if (left < margin) left = margin;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.maxHeight = maxH + 'px';
}

function openFloatingMs(ms: HTMLElement | null, menu: HTMLElement, btn: HTMLElement) {
  if (_floatingMs && _floatingMs.menu === menu) return; // already open
  closeFloatingMs();
  document.body.appendChild(menu);
  menu.classList.remove('hidden');
  menu.classList.add('ms-menu-floating');
  // capture=true で全スクロールを拾うが、メニュー内部のスクロール
  // (.ms-options の縦スクロール等) は弾く。外側 (.main) のスクロールだけ追従。
  const reposition = (e?: Event) => {
    if (e && e.target && e.target !== document && menu.contains(e.target as Node)) return;
    positionFloatingMs(menu, btn);
  };
  reposition();
  _floatingMs = { menu, btn, ms, reposition };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}

export function closeFloatingMs() {
  if (!_floatingMs) return;
  const { menu, ms, reposition } = _floatingMs;
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('resize', reposition);
  menu.classList.add('hidden');
  menu.classList.remove('ms-menu-floating');
  menu.style.top = '';
  menu.style.left = '';
  menu.style.width = '';
  menu.style.minWidth = '';
  menu.style.maxWidth = '';
  menu.style.maxHeight = '';
  // 元の .ms に戻す (.ms が DOM 上にまだあれば)
  if (ms && ms.isConnected) ms.appendChild(menu);
  else if (menu.parentNode === document.body) menu.remove();
  _floatingMs = null;
}

// setupMSDynamic 用のトグル: 開いていれば閉じる / 別メニューに切替。
// filters/index.js 内部からだけ使う (compat の export * では re-export しない)。
export function toggleFloatingMs(ms: HTMLElement | null, menu: HTMLElement, btn: HTMLElement) {
  if (_floatingMs && _floatingMs.menu === menu) closeFloatingMs();
  else openFloatingMs(ms, menu, btn);
}

// Escape で閉じる (1回だけ登録)。
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _floatingMs) closeFloatingMs();
  });
}
