// Event bus — lightweight pub/sub (fftnn pattern)
const listeners = {};

export function on(event, fn) {
  (listeners[event] ??= []).push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}

export function emit(event, data) {
  listeners[event]?.forEach(fn => fn(data));
  listeners['*']?.forEach(fn => fn({ event, data }));
}
