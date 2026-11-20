/* Pure data rules shared by the browser and Node's built-in test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResumeData = api;
})(globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({
    name: 100,
    role: 300,
    phone: 300,
    email: 300,
    website: 300,
    city: 300,
    salary: 300,
    summary: 100000,
    sectionTitle: 100,
    label: 100,
    title: 500,
    date: 80,
    body: 100000,
    subtitle: 300,
    location: 300,
    sections: 34,
    customSections: 30,
    entries: 100,
    backupBytes: 2000000,
  });
  const BUILTIN_SECTIONS = Object.freeze({
    work: '工作经历',
    projects: '项目经历',
    skills: '专业技能',
    education: '教育经历',
  });
  const KINDS = [...Object.keys(BUILTIN_SECTIONS), 'custom'];
  const ALIASES = new Map(
    Object.entries({
      工作经历: 'work',
      '工作 / 实习经历': 'work',
      实习经历: 'work',
      项目经历: 'projects',
      '项目 / 获奖经历': 'projects',
      '竞赛获奖/项目作品': 'projects',
      专业技能: 'skills',
      技术能力: 'skills',
      教育经历: 'education',
      教育背景: 'education',
      教育与训练: 'education',
    }),
  );
  const FONT_SIZES = Object.freeze([12, 13, 14]);

  function object(value, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  }
  function text(value, maxLength, message, optional = false) {
    if (optional && value === undefined) return '';
    if (typeof value !== 'string' || value.length > maxLength) throw new Error(message);
    return value;
  }
  function emptyEntry() {
    return { title: '', date: '', body: '', subtitle: '', location: '' };
  }
  function nextCustomId(sections) {
    const used = new Set(sections.map((section) => section.id));
    let i = 1;
    while (used.has(`custom-${i}`)) i += 1;
    return `custom-${i}`;
  }

  // A fresh, whitelisted shape prevents arbitrary imported properties reaching the UI.
  // Legacy flat sections and the short-lived grouped custom-tab schema migrate here.
  function normalizeResume(value) {
    object(value, '数据必须是一个对象');
    if (value.schemaVersion !== undefined && ![1, 2, 3].includes(value.schemaVersion))
      throw new Error('不支持此备份版本');
    const result = { schemaVersion: 3 };
    for (const key of ['name', 'role', 'phone', 'email', 'website', 'summary']) {
      result[key] = text(value[key], LIMITS[key], '基本信息格式不正确');
    }
    for (const key of ['city', 'salary'])
      result[key] = text(value[key], LIMITS[key], '补充信息格式不正确', true);
    if (!Array.isArray(value.sections) || value.sections.length > LIMITS.sections)
      throw new Error('栏目数量超过限制');
    const seenKinds = new Set();
    const seenIds = new Set();
    result.sections = [];
    for (const section of value.sections) {
      object(section, '栏目格式不正确');
      const title = text(section.title, LIMITS.sectionTitle, '栏目名称格式不正确');
      const label = text(section.label, LIMITS.label, '栏目标签格式不正确', true);
      if (section.hidden !== undefined && typeof section.hidden !== 'boolean')
        throw new Error('栏目显示状态不正确');
      if (!Array.isArray(section.entries) || section.entries.length > LIMITS.entries)
        throw new Error('条目格式不正确（每栏最多 100 条）');
      const entries = section.entries.map((entry) => {
        object(entry, '条目格式不正确');
        const normalized = {};
        for (const key of ['title', 'date', 'body'])
          normalized[key] = text(entry[key], LIMITS[key], '条目格式不正确');
        for (const key of ['subtitle', 'location'])
          normalized[key] = text(entry[key], LIMITS[key], '经历补充信息格式不正确', true);
        return normalized;
      });
      let kind = section.kind;
      if (kind !== undefined && !KINDS.includes(kind)) throw new Error('栏目类型不正确');
      if (kind === undefined) kind = ALIASES.get(label) || ALIASES.get(title) || 'custom';
      const duplicateBuiltin = seenKinds.has(kind) && kind !== 'custom';
      if (duplicateBuiltin) kind = 'custom';
      seenKinds.add(kind);
      let id = kind;
      if (kind === 'custom') {
        id = duplicateBuiltin ? undefined : section.id;
        if (
          id !== undefined &&
          (typeof id !== 'string' ||
            !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id) ||
            KINDS.includes(id))
        )
          throw new Error('自定义栏目标识不正确');
        if (id === undefined) id = nextCustomId(result.sections);
      }
      if (seenIds.has(id)) throw new Error('栏目标识重复');
      seenIds.add(id);
      const fixedTitle = BUILTIN_SECTIONS[kind];
      result.sections.push({
        id,
        kind,
        title: fixedTitle || title,
        label: fixedTitle || label,
        hidden: section.hidden === true,
        entries,
      });
    }
    if (
      result.sections.filter((section) => section.kind === 'custom').length > LIMITS.customSections
    )
      throw new Error('最多 30 个自定义栏目');
    for (const [kind, title] of Object.entries(BUILTIN_SECTIONS)) {
      if (!seenKinds.has(kind))
        result.sections.push({
          id: kind,
          kind,
          title,
          label: title,
          hidden: false,
          entries: [emptyEntry()],
        });
    }
    const ids = result.sections.map((section) => section.id);
    if (value.sectionOrder === undefined) result.sectionOrder = [...ids];
    else {
      if (
        !Array.isArray(value.sectionOrder) ||
        value.sectionOrder.length > LIMITS.sections ||
        new Set(value.sectionOrder).size !== value.sectionOrder.length
      )
        throw new Error('栏目顺序不正确');
      const ordered = [];
      for (const id of value.sectionOrder) {
        if (id === 'custom')
          ordered.push(
            ...result.sections
              .filter((section) => section.kind === 'custom')
              .map((section) => section.id),
          );
        else if (typeof id === 'string' && ids.includes(id)) ordered.push(id);
        else throw new Error('栏目顺序不正确');
      }
      result.sectionOrder = [...new Set([...ordered, ...ids])];
    }
    if (
      !['number', 'string'].includes(typeof value.fontSize) ||
      !FONT_SIZES.includes(Number(value.fontSize))
    )
      throw new Error('排版设置不正确');
    result.fontSize = Number(value.fontSize);
    if (typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)))
      result.savedAt = new Date(value.savedAt).toISOString();
    return result;
  }
  function sectionName(section) {
    return (
      section.title.trim() ||
      (section.kind === 'custom' ? '自定义项目' : section.label) ||
      '自定义项目'
    );
  }
  function orderedSections(resume) {
    const byId = new Map(resume.sections.map((section) => [section.id, section]));
    return resume.sectionOrder.map((id) => byId.get(id));
  }
  return Object.freeze({
    LIMITS,
    FONT_SIZES,
    BUILTIN_SECTIONS,
    normalizeResume,
    sectionName,
    emptyEntry,
    nextCustomId,
    orderedSections,
  });
});
