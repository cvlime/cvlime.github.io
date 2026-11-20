(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.ResumeHistory = factory(root.ResumeData);
})(globalThis, function (dataAPI) {
  'use strict';
  const { normalizeResume } = dataAPI;
  const LIMIT = 50;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function snapshot(value) {
    const result = normalizeResume(value);
    delete result.savedAt;
    return result;
  }
  function create(initial, stored) {
    let present = snapshot(initial);
    let past = [];
    let future = [];
    let discardedHistory = false;
    if (stored !== undefined) {
      try {
        if (
          !stored ||
          stored.version !== 1 ||
          !Array.isArray(stored.past) ||
          !Array.isArray(stored.future) ||
          stored.past.length + stored.future.length > LIMIT
        )
          throw new Error('Invalid history');
        past = stored.past.map(snapshot);
        future = stored.future.map(snapshot);
      } catch {
        // A damaged history must not prevent recovery of the current resume.
        past = [];
        future = [];
        discardedHistory = true;
      }
    }
    function matches(value) {
      return JSON.stringify(snapshot(value)) === JSON.stringify(present);
    }
    function record(value) {
      const next = snapshot(value);
      if (JSON.stringify(next) === JSON.stringify(present)) return false;
      past.push(present);
      if (past.length > LIMIT) past.shift();
      present = next;
      future = [];
      return true;
    }
    function undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return clone(present);
    }
    function redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return clone(present);
    }
    function pruneOldest() {
      if (past.length) past.shift();
      else if (future.length) future.shift();
      else return false;
      return true;
    }
    return Object.freeze({
      matches,
      record,
      undo,
      redo,
      pruneOldest,
      get canUndo() {
        return past.length > 0;
      },
      get canRedo() {
        return future.length > 0;
      },
      get discardedHistory() {
        return discardedHistory;
      },
      serialize() {
        return clone({ version: 1, past, future });
      },
    });
  }
  return Object.freeze({ create, LIMIT });
});
