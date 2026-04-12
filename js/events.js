// ===== Tiny event bus (breaks circular deps) =====
const callbacks = {};
export function on(name, fn) { (callbacks[name] ||= []).push(fn); }
export function emit(name, ...args) { (callbacks[name] || []).forEach(fn => fn(...args)); }
