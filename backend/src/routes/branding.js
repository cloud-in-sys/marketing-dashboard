// テナント (会社) 全体のブランディング設定。Firestore の単一 doc に保存。
// GET は public (ログイン画面でも参照するため server.js で auth より前にマウント)、
// PUT は manageBranding 権限保持者のみ。
//
// PUT バリデーション方針:
//   - URL: https / http / data:image/* のみ (logoUrl, faviconUrl)
//   - 色:  #rgb または #rrggbb (headerTextColor, logoColor)
//   - グラデーション: UI が生成する 3-stop linear-gradient の正規形のみ (headerGradient)
//   - テキスト: 長さ上限あり (appName, title, subtitle)
import { Hono } from 'hono';
import { db } from '../firebase.js';
import { requirePerm } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';

const app = new Hono();
const DOC = db.collection('config').doc('branding');

// Firestore 1 フィールドの上限は 1MB。data URL (base64) は元ファイルの ~133% になるので
// 200KB 画像 ≒ 270KB 文字列。少し余裕を持って 900KB まで許容。
const MAX_FIELD_LEN = 900_000;

const TEXT_MAX = { appName: 200, title: 200, subtitle: 200 };

// バリデータ群: 値を OK なら返し、ダメなら throw
const RE_HEX     = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RE_URL_OK  = /^(?:https?:\/\/|data:image\/[a-zA-Z0-9+.-]+;)/;
// UI 側が出力する `linear-gradient(135deg, #xxxxxx 20%, #xxxxxx 50%, #xxxxxx 100%)` 形式
const RE_GRAD    = /^linear-gradient\(\s*135deg\s*,\s*#[0-9a-fA-F]{6}\s+20%\s*,\s*#[0-9a-fA-F]{6}\s+50%\s*,\s*#[0-9a-fA-F]{6}\s+100%\s*\)$/;

function validateUrl(k, v) {
  if (!RE_URL_OK.test(v)) throw httpError(400, `${k} は https:// または data:image/ で始まる URL のみ許可されています`);
  return v;
}
function validateHex(k, v) {
  if (!RE_HEX.test(v)) throw httpError(400, `${k} は #rgb または #rrggbb 形式の色のみ許可されています`);
  return v;
}
function validateGradient(k, v) {
  if (!RE_GRAD.test(v)) throw httpError(400, `${k} は UI 生成の linear-gradient (3 色) のみ許可されています`);
  return v;
}
function validateText(k, v) {
  const max = TEXT_MAX[k];
  if (v.length > max) throw httpError(400, `${k} は ${max} 文字以下にしてください`);
  return v;
}

// フィールド別の処理 (空/null → null = 削除扱い、文字列 → 検証)
const FIELD_VALIDATORS = {
  logoUrl:           validateUrl,
  faviconUrl:        validateUrl,
  appName:           validateText,
  title:             validateText,
  subtitle:          validateText,
  headerGradient:    validateGradient,
  headerTextColor:   validateHex,
  headerAccentColor: validateHex,
  logoColor:         validateHex,
};

// 公開 GET (server.js で /api/branding にマウント、auth より前)
export async function getBrandingPublic(c) {
  const snap = await DOC.get();
  return c.json(snap.exists ? snap.data() : {});
}

app.put('/', requirePerm('manageBranding'), async c => {
  const body = await c.req.json();
  const patch = {};
  for (const k of Object.keys(FIELD_VALIDATORS)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v == null || v === '') { patch[k] = null; continue; } // 削除扱い
    if (typeof v !== 'string') throw httpError(400, `Invalid type for ${k}`);
    if (v.length > MAX_FIELD_LEN) throw httpError(400, `${k} が大きすぎます (${Math.round(v.length / 1024)}KB)。画像を小さくしてください。`);
    patch[k] = FIELD_VALIDATORS[k](k, v);
  }
  patch.updatedAt = new Date().toISOString();
  await DOC.set(patch, { merge: true });
  const snap = await DOC.get();
  return c.json(snap.data());
});

export default app;
