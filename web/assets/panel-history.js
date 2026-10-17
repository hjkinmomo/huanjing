/* Session-local panel trail. Re-rendering is not navigation; back never pushes a new entry. */
(function (root) {
  'use strict';
  function create(initial = 'chat', limit = 40) {
    let current = initial;
    const trail = [];
    return Object.freeze({
      visit(next) {
        if (typeof next !== 'string' || !next || next === current) return current;
        if (current) trail.push(current);
        if (trail.length > limit) trail.shift();
        current = next;
        return current;
      },
      back() { if (!trail.length) return null; current = trail.pop(); return current; },
      previous() { return trail.at(-1) || null; },
      current() { return current; },
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.HermesPanelHistory = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
