const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file));

test('favicon.ico is a valid multi-size icon', () => {
  const ico = read('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'reserved field');
  assert.equal(ico.readUInt16LE(2), 1, 'type must be icon');
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 2, 'expected several sizes in one file');

  const sizes = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const width = ico[entry] || 256;
    const height = ico[entry + 1] || 256;
    const bytes = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(width, height);
    assert.ok(offset + bytes <= ico.length, `entry ${i} fits in the file`);
    assert.ok(offset >= 6 + count * 16, `entry ${i} starts after the directory`);
    assert.equal(ico.readUInt32LE(offset), 40, 'BMP header size');
    assert.equal(ico.readUInt16LE(offset + 12), 1, 'single colour plane');
    assert.equal(ico.readUInt16LE(offset + 14), 32, '32-bit pixels');
    sizes.push(width);
  }
  for (const size of [16, 32, 48]) assert.ok(sizes.includes(size), `missing ${size}px`);
});

test('index.html points at icons that exist', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link\s+[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map(
    (match) => match[0],
  );
  const hrefs = links.map((tag) => tag.match(/href="([^"]+)"/)?.[1]);
  for (const href of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    assert.ok(hrefs.includes(href), `index.html should link ${href}`);
    assert.ok(fs.existsSync(path.join(root, href)), `${href} is referenced but missing`);
  }
  for (const [index, tag] of links.entries()) {
    if (hrefs[index].endsWith('.svg')) {
      assert.match(tag, /type="image\/svg\+xml"/, 'SVG icons declare their type');
    }
  }
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}" \/>/);
});

test('apple-touch-icon.png is a 180px RGBA PNG', () => {
  const png = read('apple-touch-icon.png');
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 6, 'RGBA colour type');
});
