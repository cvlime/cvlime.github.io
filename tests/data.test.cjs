const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeResume, orderedSections, LIMITS, emptyEntry } = require('../data.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../defaults.js'), 'utf8'), sandbox);
const defaults = JSON.parse(JSON.stringify(sandbox.window.DEFAULT_RESUME));
const base = () => ({
  name: '',
  role: '',
  phone: '',
  email: '',
  website: '',
  summary: '',
  sections: [],
  fontSize: 13,
});

test('new defaults have fixed built-in names and retain the two custom sections', () => {
  const result = normalizeResume(defaults);
  assert.equal(result.schemaVersion, 3);
  assert.deepEqual(result.sectionOrder, [
    'work',
    'projects',
    'skills',
    'education',
    'custom-1',
    'custom-2',
  ]);
  assert.deepEqual(
    orderedSections(result).map((s) => s.title),
    ['工作经历', '项目经历', '专业技能', '教育经历', '工作方法与复盘', '补充说明'],
  );
  assert.deepEqual(normalizeResume(result), result);
});

test('legacy drafts migrate without losing content, hidden states or built-in order', () => {
  const legacy = base();
  legacy.sections = [
    {
      label: '技术能力',
      title: '我改过的名称',
      hidden: true,
      entries: [{ title: '', date: '', body: '保留我的内容' }],
    },
    { title: '工作方法与复盘', entries: [{ title: '复盘', date: '', body: '我的笔记' }] },
    { title: '工作经历', entries: [] },
  ];
  const snapshot = JSON.stringify(legacy);
  const result = normalizeResume(legacy);
  assert.equal(JSON.stringify(legacy), snapshot, 'normalization must not mutate caller data');
  assert.deepEqual(result.sectionOrder, ['skills', 'custom-1', 'work', 'projects', 'education']);
  assert.equal(result.sections[0].title, '专业技能');
  assert.equal(result.sections[0].hidden, true);
  assert.equal(result.sections[0].entries[0].body, '保留我的内容');
  assert.equal(result.sections[1].kind, 'custom');
  assert.equal(result.sections[1].entries[0].body, '我的笔记');
});

test('duplicate built-ins retain their content as custom sections', () => {
  const input = base();
  input.sections = [1, 2].map((i) => ({
    title: '工作经历',
    entries: [{ title: '', date: '', body: String(i) }],
  }));
  const result = normalizeResume(input);
  assert.deepEqual(
    result.sections.slice(0, 2).map((s) => s.kind),
    ['work', 'custom'],
  );
  assert.deepEqual(
    result.sections.slice(0, 2).map((s) => s.entries[0].body),
    ['1', '2'],
  );
});

test('untrusted metadata, removed theme settings and prototype keys are not retained', () => {
  const input = JSON.parse(JSON.stringify(defaults));
  input.theme = '#ff0000';
  input.untrusted = { value: 'discard' };
  input.sections[0].unknown = 'discard';
  input.sections.push({ title: 'toString', label: '__proto__', entries: [] });
  const result = normalizeResume(input);
  assert(!Object.hasOwn(result, 'theme'));
  assert(!Object.hasOwn(result, 'untrusted'));
  assert(!Object.hasOwn(result.sections[0], 'unknown'));
  assert.equal(result.sections.at(-1).kind, 'custom');
});

test('rejects malformed fields, non-boolean visibility and invalid ordering', () => {
  for (const value of [null, [], 'resume']) assert.throws(() => normalizeResume(value));
  for (const fontSize of [[13], true, {}, 99])
    assert.throws(() => normalizeResume({ ...base(), fontSize }));
  assert.throws(() => normalizeResume({ ...base(), name: 'x'.repeat(LIMITS.name + 1) }));
  assert.throws(() =>
    normalizeResume({ ...base(), sections: [{ title: '', label: {}, entries: [] }] }),
  );
  assert.throws(() =>
    normalizeResume({ ...base(), sections: [{ title: '', hidden: 'false', entries: [] }] }),
  );
  assert.throws(() =>
    normalizeResume({ ...base(), sectionOrder: ['work', 'work', 'skills', 'education', 'custom'] }),
  );
  assert.throws(() => normalizeResume({ ...base(), schemaVersion: 99 }));
});

test('entry and custom-section limits prevent unusable backups', () => {
  const entries = Array.from({ length: LIMITS.entries + 1 }, emptyEntry);
  assert.throws(() => normalizeResume({ ...base(), sections: [{ title: '工作经历', entries }] }));
  const sections = Array.from({ length: LIMITS.customSections + 1 }, () => ({
    title: '自定义',
    entries: [],
  }));
  assert.throws(() => normalizeResume({ ...base(), sections }));
});

test('normalizes optional fields and tolerates old or malformed save timestamps', () => {
  const result = normalizeResume({ ...base(), fontSize: '13', savedAt: 'not a date' });
  assert.equal(result.fontSize, 13);
  assert.equal(result.city, '');
  assert(!Object.hasOwn(result, 'savedAt'));
  assert.equal(
    normalizeResume({ ...base(), savedAt: '2026-11-20T08:00:00Z' }).savedAt,
    '2026-11-20T08:00:00.000Z',
  );
});

test('grouped drafts migrate to independent stable custom tabs', () => {
  const input = structuredClone(defaults);
  input.schemaVersion = 2;
  for (const section of input.sections) delete section.id;
  input.sectionOrder = ['work', 'projects', 'skills', 'education', 'custom'];
  const result = normalizeResume(input);
  const ids = result.sections.filter((s) => s.kind === 'custom').map((s) => s.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(result.sectionOrder.slice(-2), ids);
  assert.deepEqual(normalizeResume(result), result);
});

test('custom identity does not depend on editable names', () => {
  const input = normalizeResume(defaults);
  for (const section of input.sections.filter((s) => s.kind === 'custom'))
    section.title = '工作经历';
  const result = normalizeResume(input);
  assert.equal(
    result.sections.filter((s) => s.kind === 'custom' && s.title === '工作经历').length,
    2,
  );
  assert.equal(new Set(result.sections.map((s) => s.id)).size, result.sections.length);
});
