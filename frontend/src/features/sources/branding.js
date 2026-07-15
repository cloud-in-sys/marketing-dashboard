// テナント全体のブランディングを DOM に反映するモジュール。
// 起動時は main.js から fetchAndApplyBranding() を呼び、
// 保存時は settings/branding.js から applyBranding(data) を呼ぶ。
import { api } from '../../api/index.js';

// ブランディング確定までロゴ/タイトルを隠すゲート (index.html の <html class="branding-pending">)
// を解除する。解除漏れ = ロゴ/タイトルが出ないままになるため、
// 「成功・失敗・例外・ハング」すべての経路で必ず解除されるようにする。
function revealBranding() {
  document.documentElement.classList.remove('branding-pending');
}

// fetch/デコードがハングした場合の保険。ここで解除しても、後から届いた値は applyBranding が
// 上書きするので不整合にはならない (誤った既定値を見せるより、空→正で埋まる方が安全)。
const REVEAL_SAFETY_MS = 4000;

// ロゴ画像が描画可能になるまで待つ。ロゴは data URL で branding JSON に同梱されるため
// 追加のネットワークは発生せず、実質デコード待ち (数 ms)。
// これを待ってから解除することで「アプリ名が先、ロゴが後」のズレをなくす。
// 失敗しても解除を止めないよう、常に resolve する。
function imgReady(img) {
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  if (typeof img.decode === 'function') return img.decode().catch(() => {});
  return new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  });
}

function waitForBrandImages() {
  // tint 表示時は mask 用 span の裏に sizer の <img> が居るので、どちらの経路でも img を拾える。
  const imgs = [
    document.querySelector('#login-brand-logo img'),
    document.querySelector('#brand-logo img'),
  ];
  return Promise.all(imgs.map(imgReady));
}

export async function fetchAndApplyBranding() {
  const safety = setTimeout(revealBranding, REVEAL_SAFETY_MS);
  try {
    const data = await api.getBranding();
    applyBranding(data || {});
  } catch (e) {
    // 取得失敗時は applyBranding のフォールバック値を明示適用する
    // (ゲート解除後に空表示のままにしないため)。
    console.warn('[branding] fetch failed, using defaults', e?.message || e);
    try { applyBranding({}); } catch (_) { /* 解除は下で必ず行う */ }
  }
  // 画像待ちは上の try とは分離する。ここで throw しても applyBranding の結果を
  // フォールバックで上書きしてしまわないようにするため。
  try { await waitForBrandImages(); } catch (_) { /* 待てなくても解除する */ }
  clearTimeout(safety);
  revealBranding();
}

export function applyBranding(data) {
  const logoUrl         = data.logoUrl         || '';
  const faviconUrl      = data.faviconUrl      || '';
  const appName         = data.appName         || '';
  const title           = data.title           || 'Marketing Metrics';
  const subtitle        = data.subtitle        || 'DASHBOARD';
  const headerGradient    = data.headerGradient    || ''; // 空なら CSS フォールバック (白)
  const headerTextColor   = data.headerTextColor   || ''; // 空なら CSS フォールバック (#1e293b)
  const headerAccentColor = data.headerAccentColor || ''; // 空なら CSS フォールバック (#ffffff)
  const logoColor         = data.logoColor         || ''; // 空なら画像そのまま、指定で塗りつぶし

  // ロゴ。logoColor 指定時は mask + background-color で塗りつぶし表示。
  //   - logoUrl 無し         → fallback span (alt テキスト)
  //   - logoUrl + logoColor → 塗りつぶし span (mask は url() + base64 escaped)
  //   - logoUrl のみ         → 通常の <img>
  // url() の中身は ' で囲って " を避け、属性側は escapeAttr で " → &quot; に。
  const maskUrl = logoUrl ? `url('${logoUrl.replace(/'/g, "\\'")}')` : '';
  // tintColor を省略するとロゴ色を適用しない (元画像のまま)。
  // ヘッダーは logoColor を適用 (暗い背景に白く抜きたいケース等)、
  // ログイン画面は常に元画像 (白い背景に白いロゴだと見えなくなるため)。
  const makeLogoHtml = (imgCls, tintedCls, fallbackCls, wrapCls, tintColor) => {
    if (!logoUrl) return `<span class="${fallbackCls}">${escapeAttr(appName)}</span>`;
    if (tintColor) {
      const styleStr = `--logo-mask:${maskUrl};--logo-color:${tintColor}`;
      return `<span class="${wrapCls}" role="img" aria-label="${escapeAttr(appName)}">
        <img class="${imgCls} brand-logo-sizer" src="${escapeAttr(logoUrl)}" alt="">
        <span class="${tintedCls}" style="${escapeAttr(styleStr)}"></span>
      </span>`;
    }
    return `<img class="${imgCls}" src="${escapeAttr(logoUrl)}" alt="${escapeAttr(appName)}" onerror="this.outerHTML='<span class=&quot;${fallbackCls}&quot;>${escapeAttr(appName)}</span>'">`;
  };
  const headerEl = document.getElementById('brand-logo');
  if (headerEl) {
    const logoHtml = makeLogoHtml('brand-logo-img', 'brand-logo-tinted', 'brand-logo-fallback', 'brand-logo-wrap', logoColor);
    headerEl.innerHTML = `${logoHtml}<span class="logo-text">${escapeAttr(title)}<em>${escapeAttr(subtitle)}</em></span>`;
  }
  const loginEl = document.getElementById('login-brand-logo');
  if (loginEl) {
    loginEl.innerHTML = makeLogoHtml('login-brand-logo-img', 'login-brand-logo-tinted', 'login-brand-logo-fallback', 'login-brand-logo-wrap', '');
  }
  // ログイン画面のタイトル
  // ログイン画面のタイトルは title のみ (subtitle は出さない)
  const loginTitle = document.querySelector('.login-title');
  if (loginTitle) loginTitle.textContent = title;

  // <title>
  document.title = title + (subtitle ? ' ' + subtitle : '');

  // favicon (未設定なら link を削除してブラウザのデフォルト挙動に戻す)
  const existing = document.querySelector('link[rel="icon"]');
  if (faviconUrl) {
    const link = existing || Object.assign(document.createElement('link'), { rel: 'icon' });
    link.href = faviconUrl;
    if (!existing) document.head.appendChild(link);
  } else if (existing) {
    existing.remove();
  }

  // ヘッダー背景 / 文字色を CSS カスタムプロパティに反映
  const root = document.documentElement.style;
  if (headerGradient)    root.setProperty('--header-gradient', headerGradient);
  else                   root.removeProperty('--header-gradient');
  if (headerTextColor)   root.setProperty('--header-text-color', headerTextColor);
  else                   root.removeProperty('--header-text-color');
  if (headerAccentColor) root.setProperty('--header-accent-color', headerAccentColor);
  else                   root.removeProperty('--header-accent-color');

  // ヘッダー右上のテキストロックアップ (もしあれば)
  const titleEl = document.querySelector('[data-brand-title]');
  if (titleEl) titleEl.textContent = title;
  const subtitleEl = document.querySelector('[data-brand-subtitle]');
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
