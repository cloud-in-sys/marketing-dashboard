// ===== Tiny event bus (breaks circular deps) =====
//
// 引数が any なのは意図的。イベント名ごとにペイロードが違い、
// 発火側と購読側がモジュールをまたぐ (循環を切るのがこのバスの目的) ため、
// ここで型を固定すると循環 import が復活する。
type Handler = (...args: any[]) => void;

const callbacks: Record<string, Handler[]> = {};
export function on(name: string, fn: Handler) { (callbacks[name] ||= []).push(fn); }
export function emit(name: string, ...args: any[]) { (callbacks[name] || []).forEach(fn => fn(...args)); }
