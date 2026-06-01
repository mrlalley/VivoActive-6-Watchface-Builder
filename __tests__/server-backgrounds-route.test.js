'use strict';

/**
 * Tests for GET /api/backgrounds/custom/:assetId
 *
 * Verifies:
 * - Returns base64 dataUrl for existing custom backgrounds
 * - Returns 404 for missing images
 * - Rejects invalid assetId formats with 400
 * - Requires authentication
 * - Path traversal attempts are rejected
 */

const request = require('supertest');
const { createServer } = require('../server');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const zlib = require('zlib');

// Build a minimal 390×390 PNG buffer for test fixtures
function makeMinimalPng(w, h) {
  const crc32 = (() => {
    const t = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return (data) => {
      let c = 0xffffffff;
      for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
  })();
  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
    return Buffer.concat([len, tb, data, crcb]);
  }
  const pixels = Buffer.alloc(h * (1 + w * 3), 0);
  const compressed = zlib.deflateSync(pixels);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('GET /api/backgrounds/custom/:assetId', () => {
  const TOKEN = 'b'.repeat(64);
  let server;
  let bgDir;

  beforeEach(() => {
    process.env.WFB_SESSION_TOKEN = TOKEN;
    bgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-bgroute-test-'));
    server = createServer({ backgroundsDir: bgDir, designsDir: bgDir });
  });

  afterEach(() => {
    delete process.env.WFB_SESSION_TOKEN;
    fs.rmSync(bgDir, { recursive: true, force: true });
  });

  test('returns dataUrl for an existing custom background', async () => {
    const assetId = 'custom-00000000-0000-0000-0000-000000000001';
    const pngBuf  = makeMinimalPng(390, 390);
    fs.writeFileSync(path.join(bgDir, `${assetId}.png`), pngBuf);

    const res = await request(server)
      .get(`/api/backgrounds/custom/${assetId}`)
      .set('X-WFB-Token', TOKEN)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    // Round-trip: decode base64 and verify PNG magic
    const decoded = Buffer.from(res.body.dataUrl.split(',')[1], 'base64');
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
    expect(decoded[2]).toBe(0x4e);
    expect(decoded[3]).toBe(0x47);
  });

  test('returns 404 for a missing background', async () => {
    const res = await request(server)
      .get('/api/backgrounds/custom/custom-00000000-0000-0000-0000-does-not-exist')
      .set('X-WFB-Token', TOKEN)
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  test('returns 400 for an invalid assetId (no custom- prefix)', async () => {
    const res = await request(server)
      .get('/api/backgrounds/custom/bundled-analog-dress')
      .set('X-WFB-Token', TOKEN)
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('requires authentication', async () => {
    const res = await request(server)
      .get('/api/backgrounds/custom/custom-00000000-0000-0000-0000-000000000001')
      .expect(401);

    expect(res.body.error).toBeTruthy();
  });

  test('rejects assetId with path traversal chars (400)', async () => {
    // Use %2F encoding so Express routes the URL to this handler rather than
    // treating the extra slashes as path separators and returning 404.
    const res = await request(server)
      .get('/api/backgrounds/custom/custom-..%2Fetc%2Fpasswd')
      .set('X-WFB-Token', TOKEN)
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});
