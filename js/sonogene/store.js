// Shared store for the current sonogene record. Sonogene tab writes;
// Sono tab reads. Module-level singleton — fine for an iframe-scoped app.

let current = null;
const listeners = new Set();

export function setSonogene(gene) {
    current = gene;
    for (const fn of listeners) { try { fn(gene); } catch (e) { console.error(e); } }
}
export function getSonogene() { return current; }
export function onSonogeneChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
