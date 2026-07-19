// 管理者設定 > ブランディング
// テナント全体のロゴ・タイトル・テーマ色を編集。
// 保存先: backend の `/api/branding` (Firestore の config/branding doc)。
// 読み込み・適用は features/sources/branding.js が boot 時に行う。

import { api } from '@api/index.ts';
import { showModal } from '@shared/ui/modal.ts';
import { hasPerm } from '@app/auth.ts';
import { applyBranding } from '../../sources/branding.ts';
import { buildSaveErrorMessage, setSaveButtonState } from '../saveFlow.ts';

let draft: Record<string, any> = {};
let dirty = false;

function markDirty() {
  dirty = true;
  document.getElementById('branding-save-btn')?.classList.add('dirty');
}
function clearDirty() {
  dirty = false;
  document.getElementById('branding-save-btn')?.classList.remove('dirty');
}

// data URL 変換 (200KB 制限)
function fileToDataURL(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (file.size > 200 * 1024) {
      reject(new Error(`画像が大きすぎます (${Math.round(file.size / 1024)}KB)。200KB 以下にしてください。`));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function loadBrandingForEdit() {
  try {
    const data = await api.getBranding();
    draft = { ...data };
  } catch (e) {
    console.warn('[branding] load failed', e);
    draft = {};
  }
  renderBrandingForm();
  clearDirty();
}

export function renderBrandingForm() {
  const el = document.getElementById('branding-form');
  if (!el) return;
  const canEdit = hasPerm('manageBranding');
  const disabled = canEdit ? '' : ' disabled';
  // ヘッダーグラデーション: 3 stop に分解 (現状デフォルト 0f172a / 1e293b / 1e3a8a)
  const stops = parseGradientStops(draft.headerGradient) || ['#0f172a', '#1e293b', '#1e3a8a'];

  el.innerHTML = `
    <div class="branding-row">
      <label>タイトル <small>(例: Marketing Metrics)</small></label>
      <input type="text" data-branding="title" value="${escapeAttr(draft.title || '')}" placeholder="Marketing Metrics"${disabled}>
    </div>
    <div class="branding-row">
      <label>サブタイトル <small>(例: DASHBOARD)</small></label>
      <input type="text" data-branding="subtitle" value="${escapeAttr(draft.subtitle || '')}" placeholder="DASHBOARD"${disabled}>
    </div>
    <div class="branding-row">
      <label>ロゴ画像が読み込めない時の代替テキスト <small>(ロゴ画像の alt 属性)</small></label>
      <input type="text" data-branding="appName" value="${escapeAttr(draft.appName || '')}" placeholder="例: 〇〇ダッシュボード"${disabled}>
    </div>

    <div class="branding-row">
      <label>ロゴ画像 <small>(推奨: 400×120px / PNG・SVG / 透明背景。最大 200KB)</small></label>
      <div class="branding-image-row">
        ${renderImagePreview(draft.logoUrl, 'logo')}
        <div class="branding-image-controls">
          <div class="branding-image-actions">
            <label class="link-btn${canEdit ? '' : ' disabled-link'}">
              ファイルを選択
              <input type="file" accept="image/*" data-branding-upload="logoUrl" hidden${disabled}>
            </label>
            <button type="button" class="link-btn" data-branding-clear="logoUrl" title="ロゴを削除 (デフォルトに戻す)"${disabled}>×</button>
          </div>
        </div>
      </div>
    </div>

    <div class="branding-row">
      <label>Favicon <small>(推奨: 64×64px or 128×128px / PNG。最大 200KB)</small></label>
      <div class="branding-image-row">
        ${renderImagePreview(draft.faviconUrl, 'favicon')}
        <div class="branding-image-controls">
          <div class="branding-image-actions">
            <label class="link-btn${canEdit ? '' : ' disabled-link'}">
              ファイルを選択
              <input type="file" accept="image/*" data-branding-upload="faviconUrl" hidden${disabled}>
            </label>
            <button type="button" class="link-btn" data-branding-clear="faviconUrl" title="favicon を削除 (デフォルトに戻す)"${disabled}>×</button>
          </div>
        </div>
      </div>
    </div>

    <div class="branding-row">
      <label>ヘッダーの色 <small>(3 色のグラデーション。左から右へ)</small></label>
      <div class="branding-gradient">
        <dashboard-color-picker data-branding-stop="0" value="${stops[0]}"${disabled}></dashboard-color-picker>
        <dashboard-color-picker data-branding-stop="1" value="${stops[1]}"${disabled}></dashboard-color-picker>
        <dashboard-color-picker data-branding-stop="2" value="${stops[2]}"${disabled}></dashboard-color-picker>
        <div class="branding-gradient-preview" style="background:${gradientFromStops(stops)}"></div>
      </div>
    </div>

    <div class="branding-row">
      <label>ヘッダーの文字色 <small>(タイトル / メタ情報 / ユーザーラベル)</small></label>
      <div class="branding-gradient">
        <dashboard-color-picker data-branding="headerTextColor" value="${draft.headerTextColor || '#ffffff'}"${disabled}></dashboard-color-picker>
        <button type="button" class="link-btn" data-branding-clear="headerTextColor" title="指定なしに戻す"${disabled}>×</button>
        <small style="color:var(--muted)">${draft.headerTextColor ? '指定中: ' + draft.headerTextColor : '指定なし (デフォルト)'}</small>
      </div>
    </div>

    <div class="branding-row">
      <label>ヘッダーの装飾色 <small>(枠線・バッジ背景。白ヘッダー時は暗い色を指定)</small></label>
      <div class="branding-gradient">
        <dashboard-color-picker data-branding="headerAccentColor" value="${draft.headerAccentColor || '#ffffff'}"${disabled}></dashboard-color-picker>
        <button type="button" class="link-btn" data-branding-clear="headerAccentColor" title="指定なしに戻す"${disabled}>×</button>
        <small style="color:var(--muted)">${draft.headerAccentColor ? '指定中: ' + draft.headerAccentColor : '指定なし (デフォルト = 白)'}</small>
      </div>
    </div>

    <div class="branding-row">
      <label>ロゴの色 <small>(指定なし: 画像そのまま / 指定: その色で塗りつぶし)</small></label>
      <div class="branding-gradient">
        <dashboard-color-picker data-branding="logoColor" value="${draft.logoColor || '#ffffff'}"${disabled}></dashboard-color-picker>
        <button type="button" class="link-btn" data-branding-clear="logoColor" title="指定なしに戻す"${disabled}>×</button>
        <small style="color:var(--muted)">${draft.logoColor ? '指定中: ' + draft.logoColor : '指定なし (画像本来の色)'}</small>
      </div>
    </div>
  `;
}

function renderImagePreview(url: string | undefined, kind: string): string {
  if (!url) return `<div class="branding-image-preview branding-image-empty">(未設定)</div>`;
  // data URL なら base64 から元サイズを概算 (デバッグ用)
  let sizeInfo = '';
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1] || '';
    const bytes = Math.round(base64.length * 0.75);
    sizeInfo = `<div class="branding-image-size">${(bytes / 1024).toFixed(1)} KB</div>`;
  }
  return `<div class="branding-image-preview"><img src="${escapeAttr(url)}" alt="${kind}" onerror="this.parentElement.classList.add('branding-image-broken')">${sizeInfo}</div>`;
}

function escapeAttr(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}) as Record<string, string>)[c]);
}

// グラデーション文字列から 3 色を抽出 (簡易パーサ。失敗したら null)
function parseGradientStops(str: any): string[] | null {
  if (!str || typeof str !== 'string') return null;
  const hexes = str.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length < 3) return null;
  return hexes.slice(0, 3);
}
function gradientFromStops(stops: string[]): string {
  return `linear-gradient(135deg, ${stops[0]} 20%, ${stops[1]} 50%, ${stops[2]} 100%)`;
}

export function setupBrandingEvents() {
  const form = document.getElementById('branding-form');
  if (!form) return;

  form.addEventListener('input', e => {
    if (!hasPerm('manageBranding')) return;
    // 元から t という別名変数がある (実行時コードは変えていない)
    const t = e.target as any;
    // dashboard-color-picker は Shadow DOM を使っていないので、内部の <input.dcp-hex>
    // からも input/change がそのまま bubble する。data-branding はホスト要素にしか無いので
    // closest() でホストに辿ってから処理する。
    const pickerHost = t.closest && t.closest('dashboard-color-picker[data-branding]');
    if (pickerHost) {
      draft[(pickerHost as HTMLElement).dataset.branding!] = (pickerHost as any).value;
      markDirty();
      applyBranding(draft);
    } else if (t.dataset.branding) {
      draft[t.dataset.branding] = t.value;
      markDirty();
      // テキスト入力 (title/subtitle/alt) はライブプレビューしない
      //   ヘッダーやブラウザタブが即時更新されると「保存済み」と勘違いされやすいため。
    } else if (t.dataset.brandingStop != null) {
      const stops = [
        (form.querySelector('[data-branding-stop="0"]') as any).value,
        (form.querySelector('[data-branding-stop="1"]') as any).value,
        (form.querySelector('[data-branding-stop="2"]') as any).value,
      ];
      draft.headerGradient = gradientFromStops(stops);
      (form.querySelector('.branding-gradient-preview') as HTMLElement).style.background = draft.headerGradient;
      markDirty();
      applyBranding(draft); // ライブプレビュー
    }
  });

  form.addEventListener('change', async e => {
    const t = e.target as any;
    if (t.dataset.brandingUpload) {
      const file = t.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataURL(file);
        draft[t.dataset.brandingUpload] = dataUrl;
        markDirty();
        renderBrandingForm();
        applyBranding(draft); // ライブプレビュー
      } catch (err: any) {
        await showModal({title: 'アップロード失敗', body: err.message || String(err), okText: 'OK', cancelText: ''});
      }
      t.value = '';
      return;
    }
    // <select data-branding="..."> の change もキャプチャ (input が発火しないブラウザ対策)
    if (t.tagName === 'SELECT' && t.dataset.branding) {
      draft[t.dataset.branding] = t.value;
      markDirty();
      applyBranding(draft); // ライブプレビュー
    }
  });

  form.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-branding-clear]') as HTMLElement | null;
    if (!btn) return;
    if (!hasPerm('manageBranding')) return;
    draft[btn.dataset.brandingClear!] = '';
    markDirty();
    renderBrandingForm();
    applyBranding(draft); // ライブプレビュー
  });

  document.getElementById('branding-save-btn')?.addEventListener('click', async () => {
    if (!hasPerm('manageBranding')) {
      await showModal({title: '権限がありません', body: 'ブランディングを編集する権限がありません。', okText: 'OK', cancelText: ''});
      return;
    }
    // バックエンド側の上限 (1 フィールド 900KB) より前にフロントで弾く
    const MAX = 900_000;
    for (const k of Object.keys(draft)) {
      const v = draft[k];
      if (typeof v === 'string' && v.length > MAX) {
        await showModal({title: '保存できません', body: `${k} のデータが大きすぎます (${Math.round(v.length / 1024)} KB)。画像をリサイズしてください。`, okText: 'OK', cancelText: ''});
        return;
      }
    }
    const saveBtn = document.getElementById('branding-save-btn');
    const rootEl = document.getElementById('branding-view');
    setSaveButtonState(saveBtn, true, rootEl);
    try {
      const saved = await api.putBranding(draft);
      // 成功時のみ draft と dirty を更新
      draft = { ...saved };
      clearDirty();
      applyBranding(saved);
      await showModal({title: '保存完了', body: 'ブランディングを保存しました。', okText: 'OK', cancelText: ''});
    } catch (e) {
      // 失敗 → draft / dirty はそのまま。プレビューも反映済みなので UI 状態は保持。
      await showModal({title: '保存に失敗しました', body: buildSaveErrorMessage(e), okText: 'OK', cancelText: ''});
    } finally {
      setSaveButtonState(saveBtn, false, rootEl);
    }
  });
}

export function brandingIsDirty() { return dirty; }
