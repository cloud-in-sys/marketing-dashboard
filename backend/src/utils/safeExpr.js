// ユーザーが保存する式 (view filter / dimension expression 等) を
// AST で validate + walk 評価する安全なエバリュエータ。
//
// new Function() を使わないため、constructor.constructor 系のサンドボックス脱出は
// 構文レベルで通らない。ALLOWED_NODES 以外のノードは全て拒否。
//
// サポートする構文 (最小集合):
//   - リテラル (数値 / 文字列 / boolean / null)
//   - 識別子 (identifierAllowlist で明示指定)
//   - r.col / r["col"] (bracket は string literal のみ許可)
//   - 呼び出し (String() / Number() / Boolean() / parseInt / parseFloat /
//     Math.max 等 / value.method() で Value method allowlist を満たすもの)
//   - 二項演算 + - * / % ** == != === !== < <= > >=
//   - 論理 && || ??
//   - 単項 + - !
//   - 三項 test ? a : b
//   - 配列リテラル (in 演算子等で使う可能性 — 現状は使わないが将来のため)
//   - テンプレートリテラル (tagged は不可)
//
// 拒否する構文:
//   - new / assignment / update / function 式 / arrow / spread /
//     tagged template / this / sequence / meta property /
//     await / yield / regex / bigint

import { parse } from 'acorn';

const MAX_LEN = 2000;

// トップレベルで参照できる識別子 (デフォルト)。
export const DEFAULT_ROW_IDENTIFIERS = new Set([
  'r',
  'Math', 'String', 'Number', 'Boolean',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'undefined', 'NaN', 'Infinity',
]);

// Math メソッドの allowlist
const MATH_METHODS = new Set([
  'max', 'min', 'abs', 'pow', 'sqrt',
  'round', 'floor', 'ceil', 'trunc', 'sign',
  'log', 'log2', 'log10', 'exp',
]);

// 文字列値に対して呼べるメソッド
const STRING_METHODS = new Set([
  'slice', 'substring', 'substr',
  'toUpperCase', 'toLowerCase',
  'trim', 'trimStart', 'trimEnd',
  'startsWith', 'endsWith', 'includes',
  'replace', 'replaceAll', 'split',
  'charAt', 'charCodeAt',
  'indexOf', 'lastIndexOf',
  'padStart', 'padEnd', 'concat', 'repeat',
  'normalize',
]);

// 数値値に対して呼べるメソッド
const NUMBER_METHODS = new Set([
  'toFixed', 'toString', 'toPrecision', 'toExponential',
]);

// 配列値に対して呼べるメソッド
const ARRAY_METHODS = new Set([
  'includes', 'indexOf', 'lastIndexOf',
  'join', 'slice', 'concat',
]);

// トップレベル identifier → 値のマッピングを作る (呼び出しごとに r を差し込む)。
function buildBaseIdentifiers() {
  return {
    Math, String, Number, Boolean,
    parseInt, parseFloat, isNaN, isFinite,
    undefined: undefined,
    NaN,
    Infinity,
  };
}

// 危険なプロパティ名は常に拒否 (プロトタイプ経由の脱出防止)
const FORBIDDEN_PROPS = new Set([
  'constructor', 'prototype', '__proto__',
  '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
]);

const ALLOWED_BINARY = new Set([
  '+', '-', '*', '/', '%', '**',
  '==', '!=', '===', '!==',
  '<', '<=', '>', '>=',
]);
const ALLOWED_LOGICAL = new Set(['&&', '||', '??']);
const ALLOWED_UNARY = new Set(['+', '-', '!']);

// ------ Parse ------
function parseExpr(src) {
  // acorn は文だけを parse。式単独では拒否されるので `(expr)` で包む。
  const wrapped = `(${src})`;
  const ast = parse(wrapped, { ecmaVersion: 2022, sourceType: 'script' });
  if (ast.type !== 'Program' || ast.body.length !== 1) {
    throw new Error('Invalid expression');
  }
  const stmt = ast.body[0];
  if (stmt.type !== 'ExpressionStatement') throw new Error('Invalid expression');
  return stmt.expression;
}

// ------ Validate ------
// 各ノードが allowlist に沿っているか再帰的にチェック。
function validateNode(node, ctx) {
  if (!node || typeof node.type !== 'string') throw new Error('Invalid node');
  switch (node.type) {
    case 'Literal': {
      if (node.regex) throw new Error('Regex literals are not allowed');
      if (typeof node.value === 'bigint') throw new Error('BigInt literals are not allowed');
      return;
    }
    case 'Identifier': {
      // allowAnyIdentifier=true (allowlist が null) の時は構文チェックのみ
      if (ctx.identifierAllowlist && !ctx.identifierAllowlist.has(node.name)) {
        throw new Error(`Unknown identifier: ${node.name}`);
      }
      return;
    }
    case 'MemberExpression': {
      validateNode(node.object, ctx);
      if (node.computed) {
        // 動的キーは string リテラルのみ許可 (constructor 等の bypass 封じ)
        if (node.property.type !== 'Literal' || typeof node.property.value !== 'string') {
          throw new Error('Computed member access must use a string literal');
        }
        if (FORBIDDEN_PROPS.has(node.property.value)) {
          throw new Error(`Property access denied: ${node.property.value}`);
        }
      } else {
        if (node.property.type !== 'Identifier') throw new Error('Invalid property');
        if (FORBIDDEN_PROPS.has(node.property.name)) {
          throw new Error(`Property access denied: ${node.property.name}`);
        }
      }
      return;
    }
    case 'ChainExpression': {
      // `a?.b` を包む node — 中身を再帰的に validate
      validateNode(node.expression, ctx);
      return;
    }
    case 'CallExpression': {
      // 引数
      for (const arg of node.arguments) {
        if (arg.type === 'SpreadElement') throw new Error('Spread arguments are not allowed');
        validateNode(arg, ctx);
      }
      const callee = node.callee;
      if (callee.type === 'Identifier' || callee.type === 'MemberExpression' || callee.type === 'ChainExpression') {
        validateNode(callee, ctx);
      } else {
        throw new Error(`Invalid callee: ${callee.type}`);
      }
      return;
    }
    case 'BinaryExpression': {
      if (!ALLOWED_BINARY.has(node.operator)) throw new Error(`Binary operator not allowed: ${node.operator}`);
      validateNode(node.left, ctx);
      validateNode(node.right, ctx);
      return;
    }
    case 'LogicalExpression': {
      if (!ALLOWED_LOGICAL.has(node.operator)) throw new Error(`Logical operator not allowed: ${node.operator}`);
      validateNode(node.left, ctx);
      validateNode(node.right, ctx);
      return;
    }
    case 'UnaryExpression': {
      if (!ALLOWED_UNARY.has(node.operator)) throw new Error(`Unary operator not allowed: ${node.operator}`);
      if (!node.prefix) throw new Error('Postfix unary not allowed');
      validateNode(node.argument, ctx);
      return;
    }
    case 'ConditionalExpression': {
      validateNode(node.test, ctx);
      validateNode(node.consequent, ctx);
      validateNode(node.alternate, ctx);
      return;
    }
    case 'ArrayExpression': {
      for (const el of node.elements) {
        if (el == null) throw new Error('Sparse arrays are not allowed');
        if (el.type === 'SpreadElement') throw new Error('Spread in arrays is not allowed');
        validateNode(el, ctx);
      }
      return;
    }
    case 'TemplateLiteral': {
      for (const q of node.quasis) if (q.type !== 'TemplateElement') throw new Error('Invalid template');
      for (const ex of node.expressions) validateNode(ex, ctx);
      return;
    }
    default:
      throw new Error(`Disallowed syntax: ${node.type}`);
  }
}

// ------ Evaluate ------
// AST を再帰的に評価。ctx.identifiers に r を含む識別子マップが入る。
function evaluate(node, ctx) {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      // Identifier は validateNode で allowlist チェック済み。r が渡っていない等で undefined なら undefined
      return Object.hasOwn(ctx.identifiers, node.name) ? ctx.identifiers[node.name] : undefined;
    case 'MemberExpression': {
      const obj = evaluate(node.object, ctx);
      if (obj == null) return undefined;
      const prop = node.computed ? node.property.value : node.property.name;
      if (FORBIDDEN_PROPS.has(prop)) return undefined;
      return safeGet(obj, prop);
    }
    case 'ChainExpression':
      return evaluate(node.expression, ctx);
    case 'CallExpression': {
      const args = node.arguments.map(a => evaluate(a, ctx));
      const callee = node.callee;
      if (callee.type === 'Identifier') {
        const fn = Object.hasOwn(ctx.identifiers, callee.name) ? ctx.identifiers[callee.name] : undefined;
        if (typeof fn !== 'function') return undefined;
        return fn.apply(null, args);
      }
      // MemberExpression / ChainExpression 呼び出し (メソッド)
      const memberNode = callee.type === 'ChainExpression' ? callee.expression : callee;
      const obj = evaluate(memberNode.object, ctx);
      if (obj == null) return undefined;
      const prop = memberNode.computed ? memberNode.property.value : memberNode.property.name;
      if (!isSafeMethod(obj, prop)) return undefined;
      const method = obj[prop];
      if (typeof method !== 'function') return undefined;
      return method.apply(obj, args);
    }
    case 'BinaryExpression': {
      const a = evaluate(node.left, ctx);
      const b = evaluate(node.right, ctx);
      switch (node.operator) {
        case '+':   return a + b;
        case '-':   return a - b;
        case '*':   return a * b;
        case '/':   return a / b;
        case '%':   return a % b;
        case '**':  return a ** b;
        case '==':  return a == b;
        case '!=':  return a != b;
        case '===': return a === b;
        case '!==': return a !== b;
        case '<':   return a < b;
        case '<=':  return a <= b;
        case '>':   return a > b;
        case '>=':  return a >= b;
      }
      return undefined;
    }
    case 'LogicalExpression': {
      const a = evaluate(node.left, ctx);
      switch (node.operator) {
        case '&&': return a && evaluate(node.right, ctx);
        case '||': return a || evaluate(node.right, ctx);
        case '??': return a ?? evaluate(node.right, ctx);
      }
      return undefined;
    }
    case 'UnaryExpression': {
      const v = evaluate(node.argument, ctx);
      switch (node.operator) {
        case '+': return +v;
        case '-': return -v;
        case '!': return !v;
      }
      return undefined;
    }
    case 'ConditionalExpression':
      return evaluate(node.test, ctx) ? evaluate(node.consequent, ctx) : evaluate(node.alternate, ctx);
    case 'ArrayExpression':
      return node.elements.map(el => evaluate(el, ctx));
    case 'TemplateLiteral': {
      let out = '';
      for (let i = 0; i < node.quasis.length; i++) {
        out += node.quasis[i].value.cooked;
        if (i < node.expressions.length) {
          const v = evaluate(node.expressions[i], ctx);
          out += String(v ?? '');
        }
      }
      return out;
    }
  }
  return undefined;
}

// obj.prop の安全な取得。
//   - Row (plain object): own property のみ、危険 prop は拒否
//   - Math: MATH_METHODS のみ
//   - 文字列: STRING_METHODS + length
//   - 数値: NUMBER_METHODS
//   - 配列: ARRAY_METHODS + length
//   - その他: undefined
function safeGet(obj, prop) {
  if (obj === Math) return MATH_METHODS.has(prop) ? Math[prop] : undefined;
  if (obj === String || obj === Number || obj === Boolean) {
    // constructor 関数自体からのアクセスは全 deny (Function 到達を防ぐ)
    return undefined;
  }
  if (typeof obj === 'string') {
    if (prop === 'length') return obj.length;
    return STRING_METHODS.has(prop) ? obj[prop] : undefined;
  }
  if (typeof obj === 'number') {
    return NUMBER_METHODS.has(prop) ? obj[prop] : undefined;
  }
  if (Array.isArray(obj)) {
    if (prop === 'length') return obj.length;
    return ARRAY_METHODS.has(prop) ? obj[prop] : undefined;
  }
  if (obj && typeof obj === 'object') {
    if (FORBIDDEN_PROPS.has(prop)) return undefined;
    return Object.hasOwn(obj, prop) ? obj[prop] : undefined;
  }
  return undefined;
}

// obj.method() の呼び出し時にメソッド名が allowlist かを判定。
function isSafeMethod(obj, prop) {
  if (FORBIDDEN_PROPS.has(prop)) return false;
  if (obj === Math) return MATH_METHODS.has(prop);
  if (typeof obj === 'string') return STRING_METHODS.has(prop);
  if (typeof obj === 'number') return NUMBER_METHODS.has(prop);
  if (Array.isArray(obj)) return ARRAY_METHODS.has(prop);
  return false;
}

// ------ 公開 API ------

// 式を validate (parse + AST walk)。OK なら null、NG ならエラーメッセージ。
// options.allowAnyIdentifier = true で識別子の allowlist を skip (構文チェックのみ)。
//   使い所: compileLifted のように identifier を呼び出し側 (ctx-prefix + __proto__: null)
//   で安全に解決するケース。それ以外は default 推奨。
export function validateSafeExpr(src, options = {}) {
  if (src == null || src === '') return null;
  if (typeof src !== 'string') return 'expression must be a string';
  if (src.length > MAX_LEN) return `expression too long (max ${MAX_LEN} chars)`;
  const identifierAllowlist = options.allowAnyIdentifier
    ? null
    : (options.identifierAllowlist || DEFAULT_ROW_IDENTIFIERS);
  try {
    const expr = parseExpr(src);
    validateNode(expr, { identifierAllowlist });
    return null;
  } catch (e) {
    return `expression error: ${e.message}`;
  }
}

// 式を compile。成功時は fn(r, extraIdentifiers?) を返す。失敗時は null。
// options.identifierAllowlist で許可識別子を差替可能。
// options.extraIdentifiers に追加識別子 (例: today / parent / total) を渡すと
// evaluate 時に inject される (allowlist にも入れておくこと)。
export function compileSafeExpr(src, options = {}) {
  if (src == null || src === '') return null;
  if (typeof src !== 'string') return null;
  if (src.length > MAX_LEN) return null;
  const identifierAllowlist = options.identifierAllowlist || DEFAULT_ROW_IDENTIFIERS;
  let expr;
  try {
    expr = parseExpr(src);
    validateNode(expr, { identifierAllowlist });
  } catch (e) {
    return null;
  }
  const baseIdents = buildBaseIdentifiers();
  const extraIdents = options.extraIdentifiers || {};
  return function evalFn(r) {
    const identifiers = Object.assign({}, baseIdents, extraIdents, { r });
    try {
      return evaluate(expr, { identifiers });
    } catch (e) {
      return undefined;
    }
  };
}

// namespace mode: 呼び出し側が渡す namespace オブジェクトから直接 identifier を解決。
// row mode の r + built-in inject と異なり、namespace 自体が identifier source。
// 使い所: compileLifted のように metric key / __agg_N__ / Math などが動的に混じる場面。
//
// - options.allowAnyIdentifier = true で構文チェックのみ (default 推奨)
// - namespace は { __proto__: null } を推奨 (prototype 経由の副作用を防ぐ)
// - 返り値: fn(namespace) → 評価結果 (エラー時は undefined)
export function compileSafeNamespaceExpr(src, options = {}) {
  if (src == null || src === '') return null;
  if (typeof src !== 'string') return null;
  if (src.length > MAX_LEN) return null;
  const identifierAllowlist = options.allowAnyIdentifier
    ? null
    : (options.identifierAllowlist || DEFAULT_ROW_IDENTIFIERS);
  let expr;
  try {
    expr = parseExpr(src);
    validateNode(expr, { identifierAllowlist });
  } catch (e) {
    return null;
  }
  return function evalWithNs(namespace) {
    try {
      return evaluate(expr, { identifiers: namespace || Object.create(null) });
    } catch (e) {
      return undefined;
    }
  };
}
