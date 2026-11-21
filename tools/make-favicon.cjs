#!/usr/bin/env node
// Generates favicon.ico, favicon.svg and apple-touch-icon.png from one design.
// No dependencies: the ICO uses 32-bit BMP entries and the PNG is written by hand.
//
// Design: a lime-green leaf on a deep green rounded tile, matching the app palette
// (--brand #397443, --brand-strong #285b32).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');

/* ------------------------------ palette ------------------------------ */
const TILE_TOP = [0x47, 0x8a, 0x53];
const TILE_BOTTOM = [0x2c, 0x62, 0x36];
const LEAF_LIGHT = [0xe6, 0xf5, 0xc9];
const LEAF_DARK = [0xcf, 0xe9, 0x9f];
const LEAF_VEIN = [0x4e, 0x8a, 0x56];

/* ---------------------------- geometry ---------------------------- */
// Everything is drawn in a 64x64 design space, the same space the SVG uses.
const LEAF_AXIS = { ax: 11, ay: 53, bx: 53, by: 11 };
const LEAF_WIDTH = 20;
const VEIN_HALF_WIDTH = 0.65;

function insideRoundedTile(x, y, radius, size = 64) {
  const hw = size / 2;
  const qx = Math.abs(x - hw) - hw + radius;
  const qy = Math.abs(y - hw) - hw + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius <= 0;
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/**
 * The leaf is the overlap of two discs of equal radius through both tips. Defining
 * it this way keeps the raster and SVG outputs identical: the same radius and
 * centres drive both.
 */
function leafGeometry() {
  const { ax, ay, bx, by } = LEAF_AXIS;
  const dx = bx - ax;
  const dy = by - ay;
  const chord = Math.hypot(dx, dy);
  const halfChord = chord / 2;
  const radius = (halfChord * halfChord + LEAF_WIDTH * LEAF_WIDTH) / (2 * LEAF_WIDTH);
  const mid = [(ax + bx) / 2, (ay + by) / 2];
  let nx = -dy / chord;
  let ny = dx / chord;
  if (nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  const offset = radius - LEAF_WIDTH;
  return {
    radius,
    // Index 0 sits on the lower-right side of the axis, index 1 on the upper-left.
    centers: [
      [mid[0] + nx * offset, mid[1] + ny * offset],
      [mid[0] - nx * offset, mid[1] - ny * offset],
    ],
  };
}

function sampleLeaf(x, y) {
  const { radius, centers } = leafGeometry();
  for (const [cx, cy] of centers) {
    if (Math.hypot(x - cx, y - cy) > radius) return null;
  }
  const { ax, ay, bx, by } = LEAF_AXIS;
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
  if (Math.hypot(x - (ax + vx * t), y - (ay + vy * t)) <= VEIN_HALF_WIDTH) return LEAF_VEIN;
  // Shade the two halves of the leaf so it reads as a folded surface.
  const mid = [(ax + bx) / 2, (ay + by) / 2];
  const side = (x - mid[0]) * -vy + (y - mid[1]) * vx >= 0 ? 0 : 1;
  return side ? LEAF_DARK : LEAF_LIGHT;
}

/**
 * Renders one icon. `rounded` tiles are the favicon look; flat tiles are used for
 * apple-touch-icon, which iOS crops to its own rounded mask.
 */
function render(size, { rounded = true } = {}) {
  const radius = rounded ? 15 : 0;
  const samples = 8;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let cover = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 64;
          const y = ((py + (sy + 0.5) / samples) / size) * 64;
          if (!insideRoundedTile(x, y, radius)) continue;
          const leaf = sampleLeaf(x, y);
          const color = leaf || mix(TILE_TOP, TILE_BOTTOM, (x + y) / 128);
          r += color[0];
          g += color[1];
          b += color[2];
          cover++;
        }
      }
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / cover) || 0;
      rgba[i + 1] = Math.round(g / cover) || 0;
      rgba[i + 2] = Math.round(b / cover) || 0;
      rgba[i + 3] = Math.round((cover / (samples * samples)) * 255);
    }
  }
  return rgba;
}

/* ---------------------------- PNG output ---------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- ICO output ---------------------------- */
function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR bitmap + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4; // BMP rows are bottom-up
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
    }
  }
  // AND mask: keep the alpha channel authoritative, but flag transparent pixels
  // so 24-bit-era consumers also render the rounded corners correctly.
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = rgba[(y * size + x) * 4 + 3];
      if (alpha >= 128) continue;
      const row = size - 1 - y;
      mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, mask]);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = [];
  const images = [];
  for (const { size, rgba } of pngs) {
    const image = bmpEntry(rgba, size);
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(image);
    offset += image.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

/* ---------------------------- SVG output ---------------------------- */
function fmt(n) {
  return Number(n.toFixed(2)).toString();
}

function leafPath() {
  const { ax, ay, bx, by } = LEAF_AXIS;
  const { radius, centers } = leafGeometry();
  const r = Number(radius.toFixed(3));
  const sweep = (from, to, center) => {
    const cross =
      (from[0] - center[0]) * (to[1] - center[1]) - (from[1] - center[1]) * (to[0] - center[0]);
    return cross > 0 ? 1 : 0;
  };
  const tipA = [ax, ay];
  const tipB = [bx, by];
  // Each arc bulges away from its own centre, so the +n edge uses centers[1].
  const first = sweep(tipA, tipB, centers[1]);
  const second = sweep(tipB, tipA, centers[0]);
  return (
    `M${ax} ${ay}` + `A${r} ${r} 0 0 ${first} ${bx} ${by}` + `A${r} ${r} 0 0 ${second} ${ax} ${ay}Z`
  );
}

function buildSvg() {
  const hexColor = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const [ax, ay] = [LEAF_AXIS.ax, LEAF_AXIS.ay];
  const [bx, by] = [LEAF_AXIS.bx, LEAF_AXIS.by];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hexColor(TILE_TOP)}"/>
      <stop offset="1" stop-color="${hexColor(TILE_BOTTOM)}"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hexColor(LEAF_LIGHT)}"/>
      <stop offset="1" stop-color="${hexColor(LEAF_DARK)}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#tile)"/>
  <path d="${leafPath()}" fill="url(#leaf)"/>
  <path d="M${ax} ${ay} ${bx} ${by}" stroke="${hexColor(LEAF_VEIN)}" stroke-width="${VEIN_HALF_WIDTH * 2}" stroke-linecap="round"/>
</svg>
`;
}

/* ---------------------------- write files ---------------------------- */
const icoSizes = [16, 32, 48];
const ico = encodeIco(icoSizes.map((size) => ({ size, rgba: render(size) })));
fs.writeFileSync(path.join(ROOT, 'favicon.ico'), ico);

const touchSize = 180;
const touch = encodePng(render(touchSize, { rounded: false }), touchSize, touchSize);
fs.writeFileSync(path.join(ROOT, 'apple-touch-icon.png'), touch);

fs.writeFileSync(path.join(ROOT, 'favicon.svg'), buildSvg());

console.log(
  `favicon.ico (${icoSizes.join(', ')} px, ${ico.length} B), ` +
    `apple-touch-icon.png (${touchSize} px, ${touch.length} B), favicon.svg`,
);
