// テナント全体のブランディングを DOM に反映するモジュール。
// 起動時は main.js から fetchAndApplyBranding() を呼び、
// 保存時は settings/branding.js から applyBranding(data) を呼ぶ。
import { api } from './api.js';

export async function fetchAndApplyBranding() {
  try {
    const data = await api.getBranding();
    applyBranding(data || {});
  } catch (e) {
    // 取得失敗時はデプロイ時の app-config.js のデフォルトのまま
    console.warn('[branding] fetch failed, using defaults', e?.message || e);
  }
}

export function applyBranding(data) {
  const logoUrl         = data.logoUrl         || '';
  const faviconUrl      = data.faviconUrl      || '';
  const appName         = data.appName         || '';
  const title           = data.title           || 'Marketing Metrics';
  const subtitle        = data.subtitle        || 'DASHBOARD';
  const headerGradient  = data.headerGradient  || ''; // 空なら CSS フォールバック (白)
  const headerTextColor = data.headerTextColor || ''; // 空なら CSS フォールバック (#1e293b)
  const logoColor       = data.logoColor       || ''; // 空なら画像そのまま、指定で塗りつぶし

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
  if (headerGradient)  root.setProperty('--header-gradient', headerGradient);
  else                 root.removeProperty('--header-gradient');
  if (headerTextColor) root.setProperty('--header-text-color', headerTextColor);
  else                 root.removeProperty('--header-text-color');

  // ヘッダー右上のテキストロックアップ (もしあれば)
  const titleEl = document.querySelector('[data-brand-title]');
  if (titleEl) titleEl.textContent = title;
  const subtitleEl = document.querySelector('[data-brand-subtitle]');
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
