const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { normalizeResume } = require('../data.js');
let browser;
const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const legacy = JSON.parse(
  require('node:fs').readFileSync(path.resolve(__dirname, './legacy-resume.json'), 'utf8'),
);

before(async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
});
after(async () => browser?.close());

async function open(t, initScript) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    assert.deepEqual(errors, []);
    await context.close();
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.sheet').length > 0);
  return page;
}
async function restore(page, data) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#file').setInputFiles({
    name: 'resume.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.waitForFunction((name) => {
    const saved = localStorage.getItem('resume-studio-v1');
    return saved && JSON.parse(saved).name === name;
  }, data.name);
  await page.waitForFunction(() => document.querySelector('#toast').textContent === '已恢复简历');
}
async function headings(page) {
  return page.locator('.resume-section').allTextContents();
}
async function noOverflow(page) {
  assert(
    await page.evaluate(() =>
      [...document.querySelectorAll('.sheet-content')].every(
        (node) => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth,
      ),
    ),
  );
}

test('file:// works without dependencies; fixed tabs and three-page preview', async (t) => {
  const page = await open(t);
  assert.equal(await page.title(), '青柠简历');
  assert.deepEqual(await page.locator('#tabs button').allTextContents(), [
    '基本信息',
    '工作经历',
    '项目经历',
    '专业技能',
    '教育经历',
    '工作方法与复盘',
    '补充说明',
    '＋',
  ]);
  assert.equal(await page.locator('.sheet').count(), 3);
  await page.getByRole('button', { name: '工作经历', exact: true }).click();
  assert.equal(await page.getByLabel('栏目名称', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '删除栏目', exact: true }).count(), 0);
  await noOverflow(page);
});

test('legacy drafts migrate, save on blur, retain timestamp and custom content', async (t) => {
  const page = await open(t);
  await page.evaluate(
    (data) => localStorage.setItem('resume-studio-v1', JSON.stringify(data)),
    legacy,
  );
  await page.reload();
  await page.getByRole('button', { name: '工作方法与复盘', exact: true }).click();
  assert.equal(await page.getByLabel('栏目名称', { exact: true }).inputValue(), '工作方法与复盘');
  assert.equal(await page.getByLabel('内容', { exact: true }).count(), 2);
  await page.getByRole('button', { name: '补充说明', exact: true }).click();
  assert.equal(await page.getByLabel('栏目名称', { exact: true }).inputValue(), '补充说明');
  await page.getByRole('button', { name: '基本信息', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill('草稿即时保存');
  await page.getByLabel('姓名', { exact: true }).blur();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('resume-studio-v1')));
  assert.equal(state.name, '草稿即时保存');
  assert.equal(state.schemaVersion, 3);
  const status = await page.locator('#save-state').textContent();
  assert.match(status, /已保存 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  await page.reload();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '草稿即时保存');
  assert.equal(await page.locator('#save-state').textContent(), status);
});

test('plus creates independent tabs with editable names, drag ordering, hiding and deletion', async (t) => {
  const page = await open(t);
  await page.getByRole('button', { name: '添加自定义栏目', exact: true }).click();
  assert.equal(await page.locator('#tabs .active').textContent(), '自定义项目');
  await page.getByLabel('栏目名称', { exact: true }).fill('开源贡献');
  assert.equal(await page.locator('#tabs .active').textContent(), '开源贡献');
  await page
    .getByLabel('内容', { exact: true })
    .fill('**加粗**和 <img src=x onerror="alert(1)"> 都是内容');
  await page.getByRole('button', { name: '添加自定义栏目', exact: true }).click();
  await page.getByLabel('栏目名称', { exact: true }).fill('兴趣爱好');
  await page.getByLabel('内容', { exact: true }).fill('将棋与阅读');
  await page
    .getByRole('button', { name: '兴趣爱好', exact: true })
    .dragTo(page.getByRole('button', { name: '开源贡献', exact: true }), {
      targetPosition: { x: 3, y: 15 },
    });
  assert.equal(await page.locator('#form-title').textContent(), '兴趣爱好');
  await page.getByRole('button', { name: '开源贡献', exact: true }).click();
  assert((await page.getByLabel('内容', { exact: true }).inputValue()).includes('加粗'));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.resume-section')].some((n) => n.textContent === '开源贡献'),
  );
  assert.equal(await page.locator('#pages img').count(), 0);
  assert((await page.locator('#pages').textContent()).includes('<img src=x'));
  await page.getByRole('switch').uncheck();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.resume-section')].some((n) => n.textContent === '开源贡献'),
  );
  await page.reload();
  await page.getByRole('button', { name: /^开源贡献/ }).click();
  assert.equal(await page.getByRole('switch').isChecked(), false);
  assert((await page.getByLabel('内容', { exact: true }).inputValue()).includes('加粗'));
  await page.getByRole('switch').check();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: '删除当前自定义栏目', exact: true }).click();
  assert.equal(await page.locator('#tabs [data-kind^="custom-"]').count(), 4);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除当前自定义栏目', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /^开源贡献/ }).count(), 0);
  await page.reload();
  assert.equal(await page.getByRole('button', { name: '开源贡献', exact: true }).count(), 0);
  await page.getByRole('button', { name: '兴趣爱好', exact: true }).click();
  assert.equal(await page.getByLabel('内容', { exact: true }).inputValue(), '将棋与阅读');
});

test('hidden fixed columns and drag order persist in previews and backups', async (t) => {
  const page = await open(t);
  const tab = (name) => page.getByRole('button', { name, exact: true });
  await tab('工作经历').click();
  await page.getByRole('switch').uncheck();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.resume-section')].some((n) => n.textContent === '工作经历'),
  );
  await tab('专业技能').dragTo(page.locator('#tabs [data-kind=work]'), {
    targetPosition: { x: 3, y: 15 },
  });
  assert.equal(await page.locator('#tabs button').nth(1).textContent(), '专业技能');
  assert.equal(await page.locator('#form-title').textContent(), '工作经历');
  await page.getByText('更多', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份', exact: true }).click();
  const download = await pending;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert(backup.sections.find((s) => s.kind === 'work').hidden);
  assert.equal(backup.sectionOrder[0], 'skills');
  assert.deepEqual(normalizeResume(backup), backup);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.resume-section')].some((n) => n.textContent === '工作经历'),
  );
  backup.name = '备份恢复测试';
  await restore(page, backup);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.resume-section')].some((n) => n.textContent === '工作经历'),
  );
  await page.reload();
  assert.equal(await page.locator('#tabs button').nth(1).textContent(), '专业技能');
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '备份恢复测试');
});

test('invalid imports preserve current data and storage failure still permits backup', async (t) => {
  const page = await open(t, () => {
    Storage.prototype.setItem = function () {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await page.getByLabel('姓名', { exact: true }).fill('未保存但可备份');
  await page.getByLabel('姓名', { exact: true }).blur();
  assert((await page.locator('#save-state').textContent()).includes('无法自动保存'));
  await page.locator('#file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"name":1}'),
  });
  await page.waitForFunction(() =>
    document.querySelector('#toast').textContent.startsWith('恢复失败'),
  );
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '未保存但可备份');
  await page.getByText('更多', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份', exact: true }).click();
  const download = await pending;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.equal(backup.name, '未保存但可备份');
});

test('split ratio persists across reload and mobile; narrow layout stays within viewport', async (t) => {
  const page = await open(t);
  const splitter = page.getByRole('separator');
  assert.equal(await splitter.getAttribute('aria-valuenow'), '50');
  const rect = await splitter.boundingBox();
  await page.mouse.move(rect.x + 4, rect.y + 100);
  await page.mouse.down();
  await page.mouse.move(970, rect.y + 100, { steps: 8 });
  await page.mouse.up();
  const ratio = await splitter.getAttribute('aria-valuenow');
  assert.notEqual(ratio, '50');
  await page.reload();
  assert.equal(await splitter.getAttribute('aria-valuenow'), ratio);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.equal(await splitter.isVisible(), false);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    (expected) => document.querySelector('#splitter').getAttribute('aria-valuenow') === expected,
    ratio,
  );
  await splitter.focus();
  await page.keyboard.press('Enter');
  await page.reload();
  assert.equal(await splitter.getAttribute('aria-valuenow'), '50');
});

test('long formatted text has no content loss, and PDF uses the same pagination', async (t) => {
  const page = await open(t);
  const long = '加粗😀完整内容。'.repeat(2500);
  const fixture = {
    name: '超长分页测试',
    role: '',
    phone: '',
    email: '',
    website: '',
    summary: `**${long}**`,
    sections: [],
    fontSize: 13,
  };
  await restore(page, fixture);
  await page.waitForFunction(() => document.querySelectorAll('.sheet').length > 3);
  await noOverflow(page);
  assert.equal(
    (await page.locator('#pages').textContent()).split('加粗😀完整内容。').length - 1,
    2500,
  );
  assert((await page.locator('.sheet strong').count()) > 3);
  const pageCount = await page.locator('.sheet').count();
  const viewport = page.locator('#preview-scroll');
  await viewport.evaluate((node) => {
    node.scrollTop = 1000;
  });
  await page.getByLabel('联系电话', { exact: true }).fill('123');
  await page.waitForTimeout(100);
  assert(
    await viewport.evaluate((node) => node.scrollTop > 900),
    'typing must not reset preview scroll',
  );
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, pageCount);
  await noOverflow(page);
  assert.equal(await page.locator('.editor').isVisible(), false);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.title(), '青柠简历');
});

test('normal entries move intact to the next page with their section heading', async (t) => {
  const page = await open(t);
  const fixture = {
    name: '整条经历分页测试',
    role: '',
    phone: '',
    email: '',
    website: '',
    summary: Array.from({ length: 30 }, (_, i) => `摘要段落 ${i}`).join('\n'),
    fontSize: 13,
    sections: [
      {
        title: '工作经历',
        entries: [
          {
            title: '完整经历',
            date: '',
            body: Array.from({ length: 9 }, (_, i) => `经历内容 ${i}`).join('\n'),
          },
        ],
      },
    ],
  };
  await restore(page, fixture);
  await page.waitForFunction(() => document.querySelectorAll('.sheet').length > 1);
  assert(
    await page.evaluate(() => {
      const sheet = [...document.querySelectorAll('.sheet')].find((node) =>
        node.textContent.includes('完整经历'),
      );
      return (
        sheet.textContent.includes('工作经历') &&
        sheet.textContent.includes('经历内容 0') &&
        sheet.textContent.includes('经历内容 8')
      );
    }),
  );
  await noOverflow(page);
});

test('relative assets also work under a GitHub Pages project subpath', async (t) => {
  const http = require('node:http');
  const allowed = new Set([
    'index.html',
    'styles.css',
    'defaults.js',
    'data.js',
    'dom.js',
    'history.js',
    'preview.js',
    'split-pane.js',
    'app.js',
  ]);
  const server = http.createServer(async (request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname;
    const name = route === '/demo/' ? 'index.html' : route.replace(/^\/demo\//, '');
    if (!route.startsWith('/demo/') || !allowed.has(name)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
    );
    response.end(await fs.readFile(path.resolve(__dirname, '..', name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const page = await open(t);
  await page.goto(`http://127.0.0.1:${server.address().port}/demo/`);
  await page.waitForFunction(() => document.querySelectorAll('.sheet').length === 3);
  assert.equal(await page.locator('#tabs button').count(), 8);
  await noOverflow(page);
});

test('typing previews immediately, blur commits one edit and undo/redo survive reload', async (t) => {
  const page = await open(t);
  const name = page.getByLabel('姓名', { exact: true });
  const original = await name.inputValue();
  await name.fill('第一段');
  await name.fill('最终输入');
  assert.equal(await page.evaluate(() => localStorage.getItem('resume-studio-v1')), null);
  assert.equal(await page.locator('#save-state').textContent(), '未保存');
  await page.waitForFunction(
    () => document.querySelector('.resume-header h1').textContent === '最终输入',
  );
  await name.blur();
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resume-studio-v1')));
  assert.equal(stored.name, '最终输入');
  assert.equal(stored.history.past.length, 1);
  const savedAt = stored.savedAt;
  await name.focus();
  await name.blur();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('resume-studio-v1')).savedAt),
    savedAt,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await name.inputValue(), original);
  await page.reload();
  assert.equal(await name.inputValue(), original);
  assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await name.inputValue(), '最终输入');
  await page.reload();
  assert.equal(await name.inputValue(), '最终输入');
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), true);
});

test('native text undo remains native; global shortcuts apply outside inputs', async (t) => {
  const page = await open(t);
  const name = page.getByLabel('姓名', { exact: true });
  const original = await name.inputValue();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await name.focus();
  await name.press('End');
  await name.pressSequentially('X');
  await name.press(`${mod}+z`);
  assert.equal(await name.inputValue(), original);
  assert.equal(await page.evaluate(() => localStorage.getItem('resume-studio-v1')), null);
  await name.fill('可以全局撤销');
  await name.blur();
  await page.keyboard.press(`${mod}+z`);
  assert.equal(await name.inputValue(), original);
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.equal(await name.inputValue(), '可以全局撤销');
});

test('deleted custom content and visibility can be undone and redone', async (t) => {
  const page = await open(t);
  await page.getByRole('button', { name: '添加自定义栏目', exact: true }).click();
  await page.getByLabel('栏目名称', { exact: true }).fill('可回退的栏目');
  await page.getByLabel('内容', { exact: true }).fill('删除后也要完整恢复');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除当前自定义栏目', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '可回退的栏目', exact: true }).count(), 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.locator('#form-title').textContent(), '可回退的栏目');
  assert.equal(await page.getByLabel('内容', { exact: true }).inputValue(), '删除后也要完整恢复');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '可回退的栏目', exact: true }).count(), 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('switch').uncheck();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.getByRole('switch').isChecked(), true);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  assert.equal(await page.getByRole('switch').isChecked(), false);
});

test('reloading while still focused saves the pending text and its undo history', async (t) => {
  const page = await open(t);
  const name = page.getByLabel('姓名', { exact: true });
  const original = await name.inputValue();
  await name.fill('刷新前未失焦');
  assert.equal(await page.evaluate(() => localStorage.getItem('resume-studio-v1')), null);
  await page.reload();
  assert.equal(await name.inputValue(), '刷新前未失焦');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await name.inputValue(), original);
});

test('More remains open within the menu and closes on focusout, outside clicks and Escape', async (t) => {
  const page = await open(t);
  const summary = page.locator('.settings > summary');
  const isOpen = () => page.locator('.settings').evaluate((node) => node.open);
  await summary.click();
  await page.locator('#font-size').focus();
  await page.locator('#font-size').selectOption('14');
  assert.equal(await isOpen(), true);
  await page.getByRole('button', { name: '备份', exact: true }).focus();
  assert.equal(await isOpen(), true);
  await page.locator('#print').focus();
  await page.waitForFunction(() => !document.querySelector('.settings').open);
  await summary.click();
  await page.locator('.app-title').click();
  assert.equal(await isOpen(), false);
  await summary.click();
  await page.keyboard.press('Escape');
  assert.equal(await isOpen(), false);
  assert.equal(await summary.evaluate((node) => node === document.activeElement), true);
});

test('limited storage prunes distant undo records but preserves the current resume', async (t) => {
  const page = await open(t, () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'resume-studio-v1' && JSON.parse(value).history?.past.length > 2)
        throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const name = page.getByLabel('姓名', { exact: true });
  for (const text of ['A', 'B', 'C', 'D']) {
    await name.fill(text);
    await name.blur();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('resume-studio-v1')));
  assert.equal(stored.name, 'D');
  assert.equal(stored.history.past.length, 2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await name.inputValue(), 'C');
});
