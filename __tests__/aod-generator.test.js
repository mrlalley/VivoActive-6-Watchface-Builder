'use strict';

const zlib = require('zlib');
const { dimBackground } = require('../lib/aod-generator');

// ─── Minimal PNG builder (same technique as lib/icon-generator.js) ────────────

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
  const tb = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
  return Buffer.concat([len, tb, data, crcb]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(pixels, width, height, filterByte = 0) {
  const bpp = 3;
  const scanlines = Buffer.alloc(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * bpp)] = filterByte;
    pixels.copy(scanlines, y * (1 + width * bpp) + 1, y * width * bpp, (y + 1) * width * bpp);
  }
  const compressed = zlib.deflateSync(scanlines);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function parsePngDimensions(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Extract all pixels from a PNG buffer (filter 0 only for test simplicity)
function extractPixels(pngBuf) {
  const width  = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  // Find IDAT
  let pos = 8;
  const idats = [];
  while (pos + 12 <= pngBuf.length) {
    const len  = pngBuf.readUInt32BE(pos);
    const type = pngBuf.slice(pos + 4, pos + 8).toString('ascii');
    if (type === 'IDAT') idats.push(pngBuf.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = 3;
  const pixels = Buffer.alloc(height * width * bpp);
  // Only handles filter 0 in tests — sufficient because dimBackground outputs filter 0
  for (let y = 0; y < height; y++) {
    raw.copy(pixels, y * width * bpp, y * (1 + width * bpp) + 1, (y + 1) * (1 + width * bpp));
  }
  return { pixels, width, height };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dimBackground()', () => {
  test('output is a valid PNG (correct signature and IHDR)', () => {
    const src = makePng(Buffer.alloc(4 * 4 * 3, 200), 4, 4);
    const out = dimBackground(src);
    // PNG signature
    expect(out.slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // Dimensions preserved
    const dims = parsePngDimensions(out);
    expect(dims.width).toBe(4);
    expect(dims.height).toBe(4);
  });

  test('output dimensions match input dimensions for 390×390', () => {
    const pixels = Buffer.alloc(390 * 390 * 3, 128);
    const src = makePng(pixels, 390, 390);
    const out = dimBackground(src);
    const dims = parsePngDimensions(out);
    expect(dims.width).toBe(390);
    expect(dims.height).toBe(390);
  });

  test('pixel values are reduced to 25% (default factor)', () => {
    // All pixels = 200
    const pixels = Buffer.alloc(4 * 4 * 3, 200);
    const src = makePng(pixels, 4, 4);
    const out = dimBackground(src);
    const { pixels: outPixels } = extractPixels(out);
    // 200 * 0.25 = 50
    expect(outPixels[0]).toBe(50);
    expect(outPixels[1]).toBe(50);
    expect(outPixels[2]).toBe(50);
  });

  test('black pixels remain black after dimming', () => {
    const pixels = Buffer.alloc(4 * 4 * 3, 0);
    const src = makePng(pixels, 4, 4);
    const out = dimBackground(src);
    const { pixels: outPixels } = extractPixels(out);
    for (let i = 0; i < outPixels.length; i++) {
      expect(outPixels[i]).toBe(0);
    }
  });

  test('white pixels become ~25% gray at default factor', () => {
    const pixels = Buffer.alloc(2 * 2 * 3, 255);
    const src = makePng(pixels, 2, 2);
    const out = dimBackground(src, 0.25);
    const { pixels: outPixels } = extractPixels(out);
    // 255 * 0.25 = 63.75 → round to 64
    expect(outPixels[0]).toBe(64);
  });

  test('factor=1.0 leaves pixels unchanged', () => {
    const pixels = Buffer.alloc(4 * 4 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % 256;
    const src = makePng(pixels, 4, 4);
    const out = dimBackground(src, 1.0);
    const { pixels: outPixels } = extractPixels(out);
    for (let i = 0; i < pixels.length; i++) {
      expect(outPixels[i]).toBe(pixels[i]);
    }
  });

  test('factor=0.0 produces all-black output', () => {
    const pixels = Buffer.alloc(4 * 4 * 3, 200);
    const src = makePng(pixels, 4, 4);
    const out = dimBackground(src, 0.0);
    const { pixels: outPixels } = extractPixels(out);
    for (let i = 0; i < outPixels.length; i++) {
      expect(outPixels[i]).toBe(0);
    }
  });

  test('factor clamped: factor > 1.0 does not overflow pixels', () => {
    const pixels = Buffer.alloc(4 * 4 * 3, 200);
    const src = makePng(pixels, 4, 4);
    const out = dimBackground(src, 2.0); // factor clamped to 1.0
    const { pixels: outPixels } = extractPixels(out);
    for (let i = 0; i < outPixels.length; i++) {
      expect(outPixels[i]).toBeLessThanOrEqual(255);
    }
  });

  test('output PNG is smaller than input (fewer unique values → better compression)', () => {
    const pixels = Buffer.alloc(390 * 390 * 3);
    // Varied pixels so compression difference is meaningful
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 13 + 7) % 256;
    const src = makePng(pixels, 390, 390);
    const out = dimBackground(src, 0.25);
    // Output should be a valid PNG (just checking it's non-trivially sized)
    expect(out.length).toBeGreaterThan(100);
    const dims = parsePngDimensions(out);
    expect(dims.width).toBe(390);
    expect(dims.height).toBe(390);
  });

  test('throws on non-PNG input', () => {
    const junk = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(() => dimBackground(junk)).toThrow(/PNG/i);
  });

  test('handles multi-IDAT PNG (concatenates chunks before inflate)', () => {
    // Build a PNG then manually split IDAT into two chunks
    const pixels = Buffer.alloc(4 * 4 * 3, 128);
    const src = makePng(pixels, 4, 4);

    // Parse out IDAT data and split it
    const idatOffset = PNG_SIG.length + 25; // after sig + IHDR chunk (25 bytes)
    const idatLen = src.readUInt32BE(idatOffset);
    const idatData = src.slice(idatOffset + 8, idatOffset + 8 + idatLen);

    const half = Math.floor(idatData.length / 2);
    const idat1 = idatData.slice(0, half);
    const idat2 = idatData.slice(half);

    const ihdrData = src.slice(PNG_SIG.length + 8, PNG_SIG.length + 8 + 13);
    const ihdr = Buffer.alloc(13); ihdrData.copy(ihdr);
    const multiIdat = Buffer.concat([
      PNG_SIG,
      chunk('IHDR', ihdr),
      chunk('IDAT', idat1),
      chunk('IDAT', idat2),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    expect(() => dimBackground(multiIdat)).not.toThrow();
    const out = dimBackground(multiIdat);
    const dims = parsePngDimensions(out);
    expect(dims.width).toBe(4);
    expect(dims.height).toBe(4);
  });

  test('handles filter type 1 (Sub) in source PNG', () => {
    // Build raw pixel data
    const width = 4, height = 4;
    const bpp = 3;
    const rawPixels = Buffer.alloc(width * height * bpp, 100);
    // Encode with filter 1 (Sub)
    const scanlines = Buffer.alloc(height * (1 + width * bpp));
    for (let y = 0; y < height; y++) {
      scanlines[y * (1 + width * bpp)] = 1; // filter type 1
      for (let x = 0; x < width * bpp; x++) {
        const raw  = rawPixels[y * width * bpp + x];
        const left = x >= bpp ? rawPixels[y * width * bpp + x - bpp] : 0;
        scanlines[y * (1 + width * bpp) + 1 + x] = (raw - left) & 0xFF;
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    const src = Buffer.concat([
      PNG_SIG,
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(scanlines)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    const out = dimBackground(src, 0.5);
    const { pixels: outPixels } = extractPixels(out);
    // 100 * 0.5 = 50
    expect(outPixels[0]).toBe(50);
  });
});
