(function () {
  'use strict';

  const STORAGE_KEY = 'resume-studio-v1';
  const { LIMITS, normalizeResume, sectionName, emptyEntry, nextCustomId } = window.ResumeData;
  const { element: el } = window.ResumeDOM;
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    tabs: $('#tabs'),
    form: $('#form'),
    title: $('#form-title'),
    actions: $('#section-actions'),
    saved: $('#save-state'),
    toast: $('#toast'),
    fontSize: $('#font-size'),
    file: $('#file'),
    settings: $('.settings'),
    scroll: $('#preview-scroll'),
  };
  const preview = window.ResumePreview.create({
    pages: $('#pages'),
    scroll: refs.scroll,
    count: $('#page-count'),
  });
  const defaults = normalizeResume(window.DEFAULT_RESUME);
  const copyDefaults = () => normalizeResume(defaults);
  const tabName = (id) =>
    id === 'basic' ? '基本信息' : sectionName(data.sections.find((section) => section.id === id));
  let data = copyDefaults();
  let active = 'basic';
  let savedContent = contentSignature(data);
  let unsaved = false;
  let toastTimer;
  let previewFrame = 0;
  let importRequest = 0;
  let pressing = false;
  const appTitle = document.title;

  const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  function toast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.remove('visible'), 3500);
  }
  function showSavedTime(value) {
    refs.saved.dataset.state = 'saved';
    const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (!Number.isFinite(date.getTime())) {
      refs.saved.textContent = '已恢复（保存时间未知）';
      return;
    }
    const parts = Object.fromEntries(
      timeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const time = el('time');
    time.dateTime = date.toISOString();
    time.textContent = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    refs.saved.replaceChildren(document.createTextNode('最近保存：'), time);
    refs.saved.title = '最后保存时间（北京时间）';
  }
  function contentSignature(value) {
    return JSON.stringify({ ...value, savedAt: undefined });
  }
  function save() {
    const savedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt }));
      data.savedAt = savedAt;
      savedContent = contentSignature(data);
      unsaved = false;
      showSavedTime(savedAt);
      return true;
    } catch {
      unsaved = true;
      refs.saved.dataset.state = 'error';
      refs.saved.textContent = '无法自动保存，请备份';
      toast('本地存储不可用，请备份数据');
      return false;
    }
  }
  function commitPending() {
    if (unsaved || contentSignature(data) !== savedContent) save();
  }
  function inputChanged() {
    const pending = contentSignature(data) !== savedContent;
    if (pending || unsaved) {
      if (unsaved && refs.saved.dataset.state === 'error') {
        refs.saved.title = '上次保存失败，输入框失去焦点后重试；也可备份数据';
      } else if (refs.saved.dataset.state !== 'dirty') {
        // Pending edits do not invalidate the draft that was already saved.
        if (data.savedAt) showSavedTime(data.savedAt);
        refs.saved.dataset.state = 'dirty';
        refs.saved.title = '有修改，输入框失去焦点后自动保存';
      }
    } else if (data.savedAt) showSavedTime(data.savedAt);
    else {
      refs.saved.dataset.state = 'saved';
      refs.saved.textContent = '自动保存';
    }
    schedulePreview();
  }
  function schedulePreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      preview.render(data);
    });
  }
  function flushPreview(options) {
    cancelAnimationFrame(previewFrame);
    previewFrame = 0;
    preview.render(data, options);
  }
  function changed() {
    save();
    schedulePreview();
  }
  function replaceResume(next) {
    commitPending();
    data = normalizeResume(next);
    active = 'basic';
    refs.fontSize.value = String(data.fontSize);
    renderTabs();
    renderForm();
    changed();
  }

  const hints = {
    name: '请输入你的姓名',
    role: '请输入希望申请的职位',
    phone: '请输入联系电话',
    email: '请输入电子邮箱',
    website: '请输入个人主页或作品链接',
    summary: '介绍你的优势、方向或经历',
    city: '填写所在城市',
    salary: '填写期望薪资',
    sectionTitle: '填写自定义栏目名称',
    title: '学校、公司或项目名称',
    date: '填写时间范围',
    body: '填写具体经历或成果，每行一条',
    subtitle: '填写职位、部门或专业',
    location: '填写工作或就读地点',
  };
  function field(key, label, value, onInput, multiline = false) {
    const wrap = el('label', 'field', label);
    const input = el(multiline ? 'textarea' : 'input');
    input.value = value;
    input.placeholder = hints[key];
    input.maxLength = LIMITS[key];
    if (multiline) input.rows = 5;
    if (key === 'phone') input.inputMode = 'tel';
    if (key === 'email') input.inputMode = 'email';
    input.addEventListener('input', () => {
      onInput(input.value);
      inputChanged();
    });
    input.addEventListener('blur', commitPending);
    wrap.append(input);
    return wrap;
  }
  function showTab(kind, focus = false) {
    active = kind;
    renderTabs();
    renderForm();
    if (focus) refs.tabs.querySelector(`[data-kind="${kind}"]`)?.focus();
  }
  function reorderTabs(source, target, after) {
    if (source === target) return;
    const from = data.sectionOrder.indexOf(source);
    if (from < 0 || !data.sectionOrder.includes(target)) return;
    data.sectionOrder.splice(from, 1);
    data.sectionOrder.splice(data.sectionOrder.indexOf(target) + (after ? 1 : 0), 0, source);
    renderTabs();
    changed();
  }
  function renderTabs() {
    const focusKind = refs.tabs.contains(document.activeElement)
      ? document.activeElement.dataset.kind
      : null;
    refs.tabs.replaceChildren();
    let dragged = null;
    const clearMarks = () =>
      refs.tabs
        .querySelectorAll('.drop-before,.drop-after,.dragging')
        .forEach((node) => node.classList.remove('drop-before', 'drop-after', 'dragging'));
    for (const kind of ['basic', ...data.sectionOrder]) {
      const button = el('button', kind === active ? 'active' : '', tabName(kind));
      button.type = 'button';
      button.dataset.kind = kind;
      button.setAttribute('aria-pressed', String(kind === active));
      button.addEventListener('click', () => showTab(kind, true));
      const sections = data.sections.filter((section) => section.id === kind);
      const hidden = sections.length > 0 && sections.every((section) => section.hidden);
      if (hidden) {
        button.classList.add('section-hidden');
        button.append(el('span', 'hidden-tag', '已隐藏'));
      }
      if (kind !== 'basic') {
        button.draggable = true;
        button.title = `${hidden ? '此栏目已隐藏，仍可编辑；' : ''}拖动调整顺序；Alt + 左右方向键也可移动`;
        button.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
        button.addEventListener('dragstart', (event) => {
          if (!event.dataTransfer) return;
          dragged = kind;
          button.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', kind);
        });
        button.addEventListener('dragover', (event) => {
          if (!dragged || dragged === kind) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          refs.tabs
            .querySelectorAll('.drop-before,.drop-after')
            .forEach((node) => node.classList.remove('drop-before', 'drop-after'));
          const rect = button.getBoundingClientRect();
          button.classList.add(
            event.clientX < rect.left + rect.width / 2 ? 'drop-before' : 'drop-after',
          );
        });
        button.addEventListener('dragleave', () =>
          button.classList.remove('drop-before', 'drop-after'),
        );
        button.addEventListener('drop', (event) => {
          if (!dragged) return;
          event.preventDefault();
          const rect = button.getBoundingClientRect();
          const source = dragged;
          dragged = null;
          clearMarks();
          reorderTabs(source, kind, event.clientX >= rect.left + rect.width / 2);
        });
        button.addEventListener('dragend', () => {
          dragged = null;
          clearMarks();
        });
        button.addEventListener('keydown', (event) => {
          if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const current = data.sectionOrder.indexOf(kind);
          const next = current + (event.key === 'ArrowLeft' ? -1 : 1);
          const target = data.sectionOrder[next];
          if (target) reorderTabs(kind, target, event.key === 'ArrowRight');
          refs.tabs.querySelector(`[data-kind="${kind}"]`)?.focus();
        });
      }
      refs.tabs.append(button);
    }
    const add = el('button', 'tab-add', '＋');
    add.type = 'button';
    add.setAttribute('aria-label', '添加自定义栏目');
    add.title = '添加自定义栏目';
    add.disabled =
      data.sections.filter((section) => section.kind === 'custom').length >= LIMITS.customSections;
    add.addEventListener('click', addCustomSection);
    refs.tabs.append(add);
    if (focusKind) refs.tabs.querySelector(`[data-kind="${focusKind}"]`)?.focus();
  }

  function visibilityControl(section, container) {
    const label = el('label', 'section-visibility');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', `显示${sectionName(section)}`);
    toggle.checked = !section.hidden;
    label.title = '关闭后不在预览和 PDF 中显示，内容仍保留';
    label.append(toggle, el('span', '', '显示'));
    toggle.addEventListener('change', () => {
      section.hidden = !toggle.checked;
      updateHiddenNote(section, container);
      renderTabs();
      changed();
    });
    return label;
  }
  function updateHiddenNote(section, container) {
    const note = container.querySelector(':scope > .section-hidden-note');
    if (section.hidden && !note) {
      container.prepend(
        el('p', 'section-hidden-note', '此栏目已隐藏，不会出现在预览和 PDF 中；内容仍可编辑。'),
      );
    } else if (!section.hidden) note?.remove();
  }
  function entryCard(section, entry, index) {
    const card = el('div', 'entry');
    const toolbar = el('div', 'entry-toolbar');
    toolbar.append(el('span', '', `条目 ${index + 1}`));
    const actions = el('div');
    for (const [label, delta] of [
      ['上移', -1],
      ['下移', 1],
    ]) {
      const button = el('button', '', label);
      button.type = 'button';
      button.disabled = index + delta < 0 || index + delta >= section.entries.length;
      button.addEventListener('click', () => {
        [section.entries[index], section.entries[index + delta]] = [
          section.entries[index + delta],
          entry,
        ];
        renderForm();
        changed();
      });
      actions.append(button);
    }
    const remove = el('button', 'remove', '删除');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!confirm('删除此条目？')) return;
      section.entries.splice(index, 1);
      renderForm();
      changed();
    });
    actions.append(remove);
    toolbar.append(actions);
    card.append(
      toolbar,
      field('title', '标题', entry.title, (value) => {
        entry.title = value;
      }),
      field('date', '时间', entry.date, (value) => {
        entry.date = value;
      }),
      field(
        'body',
        '内容',
        entry.body,
        (value) => {
          entry.body = value;
        },
        true,
      ),
    );
    const extra = el('details', 'extra-fields');
    extra.append(
      el('summary', '', '职位 / 专业与地点'),
      field('subtitle', '职位 / 专业', entry.subtitle, (value) => {
        entry.subtitle = value;
      }),
      field('location', '地点', entry.location, (value) => {
        entry.location = value;
      }),
    );
    card.append(extra);
    return card;
  }
  function renderEntries(section, container) {
    section.entries.forEach((entry, index) => container.append(entryCard(section, entry, index)));
    container.append(el('p', 'field-hint', '每行一条，**文字** 可加粗。'));
    const add = el('button', 'add', '＋ 添加条目');
    add.type = 'button';
    add.disabled = section.entries.length >= LIMITS.entries;
    if (add.disabled) add.title = '每栏最多 100 个条目';
    add.addEventListener('click', () => {
      if (section.entries.length >= LIMITS.entries) return;
      section.entries.push(emptyEntry());
      renderForm();
      changed();
    });
    container.append(add);
  }
  function addCustomSection() {
    if (
      data.sections.filter((section) => section.kind === 'custom').length >= LIMITS.customSections
    )
      return;
    const id = nextCustomId(data.sections);
    data.sections.push({
      id,
      kind: 'custom',
      title: '',
      label: '',
      hidden: false,
      entries: [emptyEntry()],
    });
    data.sectionOrder.push(id);
    showTab(id);
    changed();
    refs.form.querySelector('input[data-custom-title]')?.focus();
  }
  function deleteCustomSection(section) {
    if (!confirm(`删除“${sectionName(section)}”及其中的全部内容？此操作不可撤销，建议先备份。`))
      return;
    const index = data.sections.indexOf(section);
    if (index < 0 || section.kind !== 'custom') return;
    const orderIndex = data.sectionOrder.indexOf(section.id);
    data.sections.splice(index, 1);
    data.sectionOrder.splice(orderIndex, 1);
    const next = data.sectionOrder[Math.min(orderIndex, data.sectionOrder.length - 1)] || 'basic';
    showTab(next, true);
    changed();
  }
  function renderForm() {
    refs.form.replaceChildren();
    refs.actions.replaceChildren();
    refs.title.textContent = tabName(active);
    if (active === 'basic') {
      for (const [key, label] of [
        ['name', '姓名'],
        ['role', '求职方向'],
        ['phone', '联系电话'],
        ['email', '电子邮箱'],
        ['website', '个人主页 / GitHub'],
        ['summary', '个人总结'],
      ]) {
        const input = field(
          key,
          label,
          data[key],
          (value) => {
            data[key] = value;
          },
          key === 'summary',
        );
        if (key === 'summary') input.querySelector('textarea').classList.add('summary-input');
        refs.form.append(input);
      }
      const extra = el('details', 'extra-fields');
      extra.append(
        el('summary', '', '补充信息'),
        field('city', '所在城市', data.city, (value) => {
          data.city = value;
        }),
        field('salary', '期望薪资', data.salary, (value) => {
          data.salary = value;
        }),
      );
      refs.form.append(extra);
    } else {
      const section = data.sections.find((item) => item.id === active);
      refs.actions.append(visibilityControl(section, refs.form));
      updateHiddenNote(section, refs.form);
      if (section.kind === 'custom') {
        const remove = el('button', 'remove-custom', '删除');
        remove.type = 'button';
        remove.setAttribute('aria-label', '删除当前自定义栏目');
        remove.addEventListener('click', () => deleteCustomSection(section));
        refs.actions.append(remove);
        const title = field('sectionTitle', '栏目名称', section.title, (value) => {
          section.title = value;
          refs.title.textContent = tabName(active);
          refs.actions
            .querySelector('input')
            .setAttribute('aria-label', `显示${sectionName(section)}`);
          renderTabs();
        });
        title.querySelector('input').dataset.customTitle = '';
        refs.form.append(title);
      }
      renderEntries(section, refs.form);
    }
  }

  function downloadBackup() {
    save();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `${data.name || '我的'}-简历.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('简历数据已备份');
  }
  async function restoreBackup() {
    const request = ++importRequest;
    const file = refs.file.files[0];
    if (!file) return;
    try {
      if (file.size > LIMITS.backupBytes) throw new Error('文件不能超过 2 MB');
      const incoming = normalizeResume(JSON.parse(await file.text()));
      if (request !== importRequest) return;
      if (!confirm('恢复将替换当前简历，建议先备份。是否继续？')) return;
      replaceResume(incoming);
      toast('已恢复简历');
    } catch (error) {
      if (request === importRequest) toast(`恢复失败：${error.message}`);
    } finally {
      if (request === importRequest) refs.file.value = '';
    }
  }
  function preparePrint() {
    commitPending();
    document.title = `${data.name || '我的'}-简历`;
    flushPreview({ printing: true });
  }
  function finishPrint() {
    document.title = appTitle;
    preview.fit();
  }

  refs.form.addEventListener('submit', (event) => event.preventDefault());
  refs.fontSize.addEventListener('change', () => {
    data.fontSize = Number(refs.fontSize.value);
    changed();
  });
  $('#export').addEventListener('click', downloadBackup);
  $('#import').addEventListener('click', () => refs.file.click());
  refs.file.addEventListener('change', restoreBackup);
  $('#reset').addEventListener('click', () => {
    if (!confirm('重置将用默认简历替换全部内容和排版设置，并保存到本机。建议先备份，是否继续？'))
      return;
    replaceResume(defaults);
  });
  $('#print').addEventListener('click', async () => {
    save();
    if (document.fonts) await document.fonts.ready;
    try {
      window.print();
    } finally {
      finishPrint();
    }
  });
  window.addEventListener('pagehide', commitPending);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitPending();
  });
  refs.settings.addEventListener('focusout', (event) => {
    if (event.relatedTarget) {
      if (!refs.settings.contains(event.relatedTarget)) refs.settings.open = false;
      return;
    }
    // Native pointer focus moves can briefly leave activeElement on <body>.
    // Wait until the focus transition finishes before closing the menu, but never
    // while a press is still in flight: Safari does not focus buttons on mousedown,
    // so closing here removes the panel before its click event is dispatched.
    requestAnimationFrame(() => {
      if (pressing) return;
      if (!refs.settings.contains(document.activeElement)) refs.settings.open = false;
    });
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      pressing = true;
      if (!refs.settings.contains(event.target)) refs.settings.open = false;
    },
    true,
  );
  document.addEventListener('pointerup', () => (pressing = false), true);
  document.addEventListener('pointercancel', () => (pressing = false), true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && refs.settings.open) {
      event.preventDefault();
      refs.settings.open = false;
      refs.settings.querySelector('summary').focus();
    }
  });
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', finishPrint);

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const stored = JSON.parse(saved);
      data = normalizeResume(stored);
      showSavedTime(data.savedAt);
    }
  } catch {
    refs.saved.textContent = '未能读取本地草稿';
    toast('未能读取本地草稿，已显示模拟简历；可恢复备份');
  }
  refs.fontSize.value = String(data.fontSize);
  savedContent = contentSignature(data);
  renderTabs();
  renderForm();
  flushPreview();
  window.ResumeSplit.init({
    workspace: $('.workspace'),
    splitter: $('#splitter'),
    scroll: refs.scroll,
    fit: preview.fit,
    notify: toast,
  });
  if (document.fonts) document.fonts.ready.then(schedulePreview);
})();
