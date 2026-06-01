'use strict';

/**
 * Tests for the background:import IPC handler logic.
 * Validates all guard conditions without requiring an actual Electron environment.
 *
 * The handler implementation is in src/main/ipc/handlers.js. We extract its
 * core validation and path-resolution logic into helpers that are tested directly.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const zlib   = require('zlib');

// ─── Replicated helpers (mirrors handlers.js) ─────────────────────────────────

const MAX_BACKGROUND_BYTES = 512 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function parsePngDimensions(buf) {
  if (buf.length < 24) return null;
  if (!buf.slice(0, 4).equals(PNG_MAGIC)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Build a minimal valid PNG with given dimensions using the same technique as
// lib/icon-generator.js — zlib-compressed raw scanlines, proper chunks.
function makeMinimalPng(width, height) {
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
  const pixels = Buffer.alloc(height * (1 + width * 3), 0);
  for (let y = 0; y < height; y++) pixels[y * (1 + width * 3)] = 0; // filter byte
  const compressed = zlib.deflateSync(pixels);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── parsePngDimensions ───────────────────────────────────────────────────────

describe('parsePngDimensions()', () => {
  test('returns correct dimensions for a valid 390×390 PNG', () => {
    const buf = makeMinimalPng(390, 390);
    expect(parsePngDimensions(buf)).toEqual({ width: 390, height: 390 });
  });

  test('returns correct dimensions for a 60×60 PNG', () => {
    const buf = makeMinimalPng(60, 60);
    expect(parsePngDimensions(buf)).toEqual({ width: 60, height: 60 });
  });

  test('returns null for a buffer that is too short', () => {
    expect(parsePngDimensions(Buffer.alloc(10))).toBeNull();
  });

  test('returns null when PNG magic bytes are wrong', () => {
    const buf = makeMinimalPng(390, 390);
    buf[0] = 0x00; // corrupt magic
    expect(parsePngDimensions(buf)).toBeNull();
  });
});

// ─── File size guard ──────────────────────────────────────────────────────────

describe('MAX_BACKGROUND_BYTES guard', () => {
  test('a 390×390 placeholder PNG is well under 512 KB', () => {
    const buf = makeMinimalPng(390, 390);
    // Solid-color PNGs compress very well — expect well under the limit
    expect(buf.length).toBeLessThan(MAX_BACKGROUND_BYTES);
  });
});

// ─── Import handler guard logic ───────────────────────────────────────────────
// We test the guard conditions rather than the full Electron handler so these
// tests run in a plain Node.js environment without requiring electron context.

describe('background:import guard conditions', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-bg-import-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function simulateImport(fileBuffer, bgDir) {
    // Replicate the guard logic from handlers.js
    if (fileBuffer.length > MAX_BACKGROUND_BYTES) {
      return { success: false, error: `File too large (${(fileBuffer.length / 1024).toFixed(0)} KB). Maximum is 512 KB.` };
    }
    if (!fileBuffer.slice(0, 4).equals(PNG_MAGIC)) {
      return { success: false, error: 'File is not a valid PNG image. Please select a PNG file.' };
    }
    const dims = parsePngDimensions(fileBuffer);
    if (!dims) {
      return { success: false, error: 'Could not read image dimensions. File may be corrupt.' };
    }
    if (dims.width !== 390 || dims.height !== 390) {
      return { success: false, error: `Image must be 390×390 pixels. This image is ${dims.width}×${dims.height}.` };
    }
    // Copy
    fs.mkdirSync(bgDir, { recursive: true });
    const uuid    = crypto.randomUUID();
    const assetId = `custom-${uuid}`;
    const dstPath = path.join(bgDir, `${assetId}.png`);
    fs.writeFileSync(dstPath, fileBuffer);
    const dataUrl = `data:image/png;base64,${fileBuffer.toString('base64')}`;
    return { success: true, assetId, dataUrl };
  }

  test('valid 390×390 PNG succeeds and creates file in bgDir', () => {
    const buf    = makeMinimalPng(390, 390);
    const result = simulateImport(buf, tmpDir);
    expect(result.success).toBe(true);
    expect(result.assetId).toMatch(/^custom-[0-9a-f-]{36}$/);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    // File must exist in managed directory
    expect(fs.existsSync(path.join(tmpDir, `${result.assetId}.png`))).toBe(true);
  });

  test('wrong dimensions (100×100) are rejected', () => {
    const buf    = makeMinimalPng(100, 100);
    const result = simulateImport(buf, tmpDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/390×390/);
  });

  test('wrong dimensions (800×600) are rejected', () => {
    const buf    = makeMinimalPng(800, 600);
    const result = simulateImport(buf, tmpDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/800×600/);
  });

  test('file exceeding 512 KB is rejected', () => {
    const bigBuf = Buffer.alloc(MAX_BACKGROUND_BYTES + 1, 0x89);
    const result = simulateImport(bigBuf, tmpDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  test('non-PNG file (JPEG magic) is rejected', () => {
    const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(100)]);
    const result  = simulateImport(jpegBuf, tmpDir);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid PNG/i);
  });

  test('each import generates a unique assetId', () => {
    const buf = makeMinimalPng(390, 390);
    const r1  = simulateImport(buf, tmpDir);
    const r2  = simulateImport(buf, tmpDir);
    expect(r1.assetId).not.toBe(r2.assetId);
  });
});
