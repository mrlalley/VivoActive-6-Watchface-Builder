'use strict';

// Generates placeholder 390×390 PNG backgrounds for assets/backgrounds/.
// Also generates 60×60 thumbnails in assets/backgrounds/thumbs/.
// Run: node scripts/create-placeholder-backgrounds.js
//
// Does not require external dependencies — uses Node.js built-in zlib.
// Backgrounds are simple solid-color fills with a subtle circular grad ring.

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT_DIR   = path.join(__dirname, '..', 'assets', 'backgrounds');
const THUMB_DIR = path.join(OUT_DIR, 'thumbs');

const BACKGROUNDS = [
  { id: 'analog-dress-gold',    bg: [0x12, 0x0c, 0x1e], ring: [0xcc, 0xa8, 0x30], text: 'DRESS' },
  { id: 'analog-tool-black',    bg: [0x08, 0x08, 0x08], ring: [0xe0, 0xe0, 0xe0], text: 'TOOL'  },
  { id: 'analog-roman-silver',  bg: [0x0e, 0x12, 0x1c], ring: [0xa8, 0xb4, 0xc8], text: 'ROMAN' },
  { id: 'analog-minimal-white', bg: [0xf0, 0xf0, 0xf0], ring: [0x60, 0x60, 0x60], text: 'MINI'  },
  { id: 'analog-sport-dark',    bg: [0x08, 0x10, 0x14], ring: [0x00, 0xcc, 0x88], text: 'SPORT' },
];

// ─── PNG building helpers (same approach as lib/icon-generator.js) ─────────────

const CRC32_TABLE = (() => {
  const t = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const tb   = Buffer.from(type, 'ascii');
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
  return Buffer.concat([len, tb, data, crcb]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(pixels, width, height) {
  // pixels: Buffer of height*(1+width*3) bytes (filter byte per row + RGB)
  const compressed = zlib.deflateSync(pixels);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// ─── Pixel generators ─────────────────────────────────────────────────────────

function buildPixels(size, paintFn) {
  const buf = Buffer.alloc(size * (1 + size * 3));
  let off = 0;
  for (let y = 0; y < size; y++) {
    buf[off++] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paintFn(x, y);
      buf[off++] = r;
      buf[off++] = g;
      buf[off++] = b;
    }
  }
  return buf;
}

function lerp(a, b, t) { return Math.round(a + (b - a) * Math.min(1, Math.max(0, t))); }

function paintBackground(size, bgRgb, ringRgb) {
  const cx = size / 2, cy = size / 2;
  const maxR = size / 2;

  // Ring params: outer ring at 95% radius, inner at 88%, thin accent at 50%
  const outerRing  = { r1: maxR * 0.92, r2: maxR * 0.96, rgb: ringRgb };
  const innerAccent = { r1: maxR * 0.46, r2: maxR * 0.50, rgb: ringRgb };

  return buildPixels(size, (x, y) => {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Outside bezel → very dark
    if (dist > maxR * 0.98) {
      return [bgRgb[0] >> 2, bgRgb[1] >> 2, bgRgb[2] >> 2];
    }

    // Outer ring band
    if (dist >= outerRing.r1 && dist <= outerRing.r2) {
      const fade = 1.0 - Math.abs(dist - (outerRing.r1 + outerRing.r2) / 2) / ((outerRing.r2 - outerRing.r1) / 2);
      return [
        lerp(bgRgb[0], ringRgb[0], fade * 0.9),
        lerp(bgRgb[1], ringRgb[1], fade * 0.9),
        lerp(bgRgb[2], ringRgb[2], fade * 0.9),
      ];
    }

    // Inner accent ring
    if (dist >= innerAccent.r1 && dist <= innerAccent.r2) {
      const fade = 1.0 - Math.abs(dist - (innerAccent.r1 + innerAccent.r2) / 2) / ((innerAccent.r2 - innerAccent.r1) / 2);
      return [
        lerp(bgRgb[0], ringRgb[0], fade * 0.5),
        lerp(bgRgb[1], ringRgb[1], fade * 0.5),
        lerp(bgRgb[2], ringRgb[2], fade * 0.5),
      ];
    }

    // Subtle radial gradient on the fill (center brighter, edge darker)
    const t = dist / maxR; // 0=center, 1=edge
    const darken = 1.0 - t * 0.25;
    return [
      Math.round(bgRgb[0] * darken),
      Math.round(bgRgb[1] * darken),
      Math.round(bgRgb[2] * darken),
    ];
  });
}

// ─── Generate files ────────────────────────────────────────────────────────────

fs.mkdirSync(THUMB_DIR, { recursive: true });

for (const bg of BACKGROUNDS) {
  // Full-size (390×390)
  const fullPixels = paintBackground(390, bg.bg, bg.ring);
  const fullPng    = makePng(fullPixels, 390, 390);
  const fullPath   = path.join(OUT_DIR, `${bg.id}.png`);
  fs.writeFileSync(fullPath, fullPng);
  console.log(`  wrote ${path.basename(fullPath)} (${fullPng.length} bytes)`);

  // Thumbnail (60×60)
  const thumbPixels = paintBackground(60, bg.bg, bg.ring);
  const thumbPng    = makePng(thumbPixels, 60, 60);
  const thumbPath   = path.join(THUMB_DIR, `${bg.id}.png`);
  fs.writeFileSync(thumbPath, thumbPng);
  console.log(`  wrote thumbs/${path.basename(thumbPath)} (${thumbPng.length} bytes)`);
}

console.log('\nDone — backgrounds and thumbnails generated.');
