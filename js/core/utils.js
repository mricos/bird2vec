// Utility helpers
export const $ = id => document.getElementById(id);
export const $$ = sel => document.querySelectorAll(sel);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const randRange = (lo, hi) => lo + Math.random() * (hi - lo);

export function fillRandom(arr, lo = -1, hi = 1) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = randRange(lo, hi);
  }
  return arr;
}

// Compact ISO 8601 timestamp (terrain convention)
export function ts() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', 'T');
}
