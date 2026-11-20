const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, LIMIT } = require('../history.js');
const { normalizeResume } = require('../data.js');
const base = () =>
  normalizeResume({
    name: '',
    role: '',
    phone: '',
    email: '',
    website: '',
    summary: '',
    sections: [],
    fontSize: 13,
  });

test('records semantic edits only; saving timestamps do not add undo steps', () => {
  const initial = base();
  const history = create(initial);
  assert.equal(history.record({ ...initial, savedAt: '2026-11-20T08:00:00Z' }), false);
  assert.equal(history.canUndo, false);
  assert.equal(history.record({ ...initial, name: '第一次修改' }), true);
  assert.equal(
    history.record({ ...initial, name: '第一次修改', savedAt: '2026-11-20T09:00:00Z' }),
    false,
  );
  assert.equal(history.undo().name, '');
  assert.equal(history.redo().name, '第一次修改');
});

test('new edits discard redo; returned documents cannot mutate retained history', () => {
  const initial = base();
  const history = create(initial);
  history.record({ ...initial, name: 'A' });
  history.record({ ...initial, name: 'B' });
  const undone = history.undo();
  undone.name = 'outside mutation';
  assert.equal(history.redo().name, 'B');
  history.undo();
  history.record({ ...initial, name: 'C' });
  assert.equal(history.canRedo, false);
  assert.equal(history.undo().name, 'A');
});

test('retains at most fifty changes across undo and redo', () => {
  const initial = base();
  const history = create(initial);
  for (let i = 1; i <= 70; i++) history.record({ ...initial, name: String(i) });
  let count = 0;
  let doc;
  while (history.canUndo) {
    doc = history.undo();
    count++;
  }
  assert.equal(count, LIMIT);
  assert.equal(doc.name, '20');
  for (let i = 0; i < LIMIT; i++) doc = history.redo();
  assert.equal(doc.name, '70');
  assert.equal(history.canRedo, false);
});

test('serialized history restores undo and redo after refresh', () => {
  const initial = base();
  const history = create(initial);
  history.record({ ...initial, name: 'A' });
  history.record({ ...initial, name: 'B' });
  const current = history.undo();
  const restored = create(current, JSON.parse(JSON.stringify(history.serialize())));
  assert.equal(restored.redo().name, 'B');
  assert.equal(restored.undo().name, 'A');
  assert.equal(restored.undo().name, '');
});

test('bad history does not prevent the current document from loading', () => {
  for (const stored of [null, {}, { version: 1, past: [null], future: [] }]) {
    const history = create({ ...base(), name: '保留当前内容' }, stored);
    assert.equal(history.discardedHistory, true);
    assert.equal(history.canUndo, false);
    assert.equal(history.matches({ ...base(), name: '保留当前内容' }), true);
  }
});

test('quota trimming discards distant history but keeps the next undo/redo intact', () => {
  const initial = base();
  const history = create(initial);
  for (const name of ['A', 'B', 'C']) history.record({ ...initial, name });
  history.pruneOldest();
  assert.equal(history.undo().name, 'B');
  assert.equal(history.undo().name, 'A');
  assert.equal(history.canUndo, false);
  history.pruneOldest();
  assert.equal(history.redo().name, 'B');
  assert.equal(history.canRedo, false);
});
