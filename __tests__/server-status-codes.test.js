'use strict';

/**
 * Tests for correct HTTP status code semantics across API routes.
 *
 * Strategy:
 * - jest.mock() calls are hoisted by Jest before any require(), so the
 *   mocked versions are what server.js captures when it destructures them at
 *   module load time.
 * - Queue singletons (buildQueue, designSaveQueue) are shared objects: spying
 *   on their .add method in the test affects the same reference the route
 *   handler holds.
 * - Call-through defaults preserve real validation behaviour for existing 4xx
 *   tests without duplicating lib unit-test coverage.
 */

// ─── Module-level mocks (hoisted before require('../server')) ─────────────────

jest.mock('../lib/build', () => {
  return { ...jest.requireActual('../lib/build'), buildProject: jest.fn() };
});

jest.mock('../lib/design-store', () => {
  return {
    ...jest.requireActual('../lib/design-store'),
    listDesigns: jest.fn(),
    saveDesign:  jest.fn(),
    loadDesign:  jest.fn(),
  };
});

// Stub the simulator launcher — we never want to actually launch a process in tests.
jest.mock('../lib/preview', () => ({
  ...jest.requireActual('../lib/preview'),
  previewInSimulator: jest.fn(),
}));

// ─── Requires (after mock hoisting) ──────────────────────────────────────────

const request = require('supertest');
const { createServer } = require('../server');
const path = require('path');
const fs   = require('fs');

// References to the jest.fn() instances captured by server.js at require time
const { buildProject }               = require('../lib/build');
const { listDesigns, saveDesign, loadDesign } = require('../lib/design-store');
const { buildQueue, designSaveQueue } = require('../lib/queue');
const { QueueFullError }             = require('../lib/errors');

// Actual implementations used as call-through defaults
const _actual = {
  buildProject: jest.requireActual('../lib/build').buildProject,
  listDesigns:  jest.requireActual('../lib/design-store').listDesigns,
  saveDesign:   jest.requireActual('../lib/design-store').saveDesign,
  loadDesign:   jest.requireActual('../lib/design-store').loadDesign,
};

// ─── Suite setup ─────────────────────────────────────────────────────────────

describe('HTTP Status Code Semantics', () => {
  const TOKEN   = 'a'.repeat(64);
  let server;
  const testDir = path.join(__dirname, 'test-status-codes');
  const mockConfig = {
    designsDir:  testDir,
    exportDir:   path.join(testDir, 'exports'),
    sdkBin:      '/fake/sdk/bin',
    devKey:      '/fake/key.der',
    simExe:      '/fake/sim',
  };

  beforeEach(() => {
    // Restore call-through defaults before every test so 4xx tests see real validation
    buildProject.mockImplementation((...a) => _actual.buildProject(...a));
    listDesigns.mockImplementation((...a)  => _actual.listDesigns(...a));
    saveDesign.mockImplementation((...a)   => _actual.saveDesign(...a));
    loadDesign.mockImplementation((...a)   => _actual.loadDesign(...a));

    process.env.WFB_SESSION_TOKEN = TOKEN;
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(mockConfig.exportDir, { recursive: true });
    server = createServer(mockConfig);
  });

  afterEach(() => {
    delete process.env.WFB_SESSION_TOKEN;
    fs.rmSync(testDir, { recursive: true, force: true });
    jest.restoreAllMocks(); // restores buildQueue / designSaveQueue spies
  });

  // ─── POST /api/export ──────────────────────────────────────────────────────

  describe('POST /api/export', () => {
    test('returns 200 for successful build; internal paths absent from response', async () => {
      buildProject.mockResolvedValueOnce({
        success:     true,
        requestId:   'req-200-ok',
        log:         'Build complete',
        prgPath:     '/srv/exports/req-200-ok/bin/Face.prg',   // must be stripped
        designPath:  '/srv/exports/req-200-ok/design.json',    // must be stripped
        projectPath: '/srv/exports/req-200-ok',                // must be stripped
      });

      const res = await request(server)
        .post('/api/export')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [], projectName: 'GoodFace' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.requestId).toBe('req-200-ok');
      expect(res.body.prgPath).toBeUndefined();
      expect(res.body.designPath).toBeUndefined();
      expect(res.body.projectPath).toBeUndefined();
    });

    test('returns 400 for build failure (invalid elements)', async () => {
      const res = await request(server)
        .post('/api/export')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [{ invalid: 'element' }], projectName: 'TestFace' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 500 for unexpected queue error', async () => {
      jest.spyOn(buildQueue, 'add').mockRejectedValueOnce(new Error('disk full'));

      const res = await request(server)
        .post('/api/export')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [], projectName: 'TestFace' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 503 with Retry-After: 60 when build queue is full', async () => {
      jest.spyOn(buildQueue, 'add').mockRejectedValueOnce(new QueueFullError());

      const res = await request(server)
        .post('/api/export')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [], projectName: 'TestFace' })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.headers['retry-after']).toBe('60');
    });
  });

  // ─── POST /api/save-design ─────────────────────────────────────────────────

  describe('POST /api/save-design', () => {
    test('returns 400 for save failure (invalid elements fail validation)', async () => {
      const res = await request(server)
        .post('/api/save-design')
        .set('X-WFB-Token', TOKEN)
        .send({ projectName: 'TestDesign', elements: [{ invalid: 'element' }] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 500 for unexpected queue error', async () => {
      jest.spyOn(designSaveQueue, 'add').mockRejectedValueOnce(new Error('unexpected failure'));

      const res = await request(server)
        .post('/api/save-design')
        .set('X-WFB-Token', TOKEN)
        .send({ projectName: 'TestDesign', elements: [] })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 503 with Retry-After: 60 when save queue is full', async () => {
      jest.spyOn(designSaveQueue, 'add').mockRejectedValueOnce(new QueueFullError());

      const res = await request(server)
        .post('/api/save-design')
        .set('X-WFB-Token', TOKEN)
        .send({ projectName: 'TestDesign', elements: [] })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.headers['retry-after']).toBe('60');
    });
  });

  // ─── GET /api/designs ─────────────────────────────────────────────────────

  describe('GET /api/designs', () => {
    test('returns 200 for successful list', async () => {
      const res = await request(server)
        .get('/api/designs')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.designs)).toBe(true);
    });

    test('returns 500 when listDesigns throws a filesystem error', async () => {
      listDesigns.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const res = await request(server)
        .get('/api/designs')
        .set('X-WFB-Token', TOKEN)
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/EACCES/);
    });
  });

  // ─── GET /api/designs/:filename ───────────────────────────────────────────

  describe('GET /api/designs/:filename', () => {
    test('returns 404 for design not found', async () => {
      const res = await request(server)
        .get('/api/designs/nonexistent.json')
        .set('X-WFB-Token', TOKEN)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 400 for corrupted design file', async () => {
      fs.writeFileSync(path.join(testDir, 'corrupted.json'), 'not valid json{{{');

      const res = await request(server)
        .get('/api/designs/corrupted.json')
        .set('X-WFB-Token', TOKEN)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/corrupted/i);
    });

    test('returns 200 for valid design', async () => {
      fs.writeFileSync(
        path.join(testDir, 'valid.json'),
        JSON.stringify({ projectName: 'ValidDesign', elements: [], savedAt: new Date().toISOString() }),
      );

      const res = await request(server)
        .get('/api/designs/valid.json')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.design).toBeDefined();
    });
  });

  // ─── GET /api/designs/check/:projectName ─────────────────────────────────

  describe('GET /api/designs/check/:projectName', () => {
    test('returns 200 with exists=false when design does not exist', async () => {
      const res = await request(server)
        .get('/api/designs/check/NonExistent')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(false);
    });

    test('returns 200 with exists=true when design exists', async () => {
      fs.writeFileSync(
        path.join(testDir, 'existent.json'),
        JSON.stringify({ projectName: 'existent', elements: [] }),
      );

      const res = await request(server)
        .get('/api/designs/check/existent')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(true);
    });
  });

  // ─── POST /api/preview ────────────────────────────────────────────────────

  describe('POST /api/preview', () => {
    test('returns 400 for build failure (invalid elements)', async () => {
      const res = await request(server)
        .post('/api/preview')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [{ invalid: 'element' }], projectName: 'TestPreview' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 500 for unexpected queue error', async () => {
      jest.spyOn(buildQueue, 'add').mockRejectedValueOnce(new Error('unexpected failure'));

      const res = await request(server)
        .post('/api/preview')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [], projectName: 'TestPreview' })
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('returns 503 with Retry-After: 60 when build queue is full', async () => {
      jest.spyOn(buildQueue, 'add').mockRejectedValueOnce(new QueueFullError());

      const res = await request(server)
        .post('/api/preview')
        .set('X-WFB-Token', TOKEN)
        .send({ elements: [], projectName: 'TestPreview' })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.headers['retry-after']).toBe('60');
    });
  });

  // ─── GET /api/export/check/:projectName ──────────────────────────────────

  describe('GET /api/export/check/:projectName', () => {
    test('returns 200 with exists=false when export does not exist', async () => {
      const res = await request(server)
        .get('/api/export/check/NonExistent')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(false);
    });

    test('returns 200 with rebuildQueued=true when manifest is absent (no tree scan)', async () => {
      // No .exports.json in exportDir — route returns immediately with rebuildQueued:true
      // rather than doing a synchronous recursive scan.
      const res = await request(server)
        .get('/api/export/check/SomeFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(false);
      expect(res.body.rebuildQueued).toBe(true);
    });
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  describe('Status Code Classification Summary', () => {
    test('success endpoints return 2xx', async () => {
      const res = await request(server)
        .get('/api/designs')
        .set('X-WFB-Token', TOKEN);

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });

    test('client error endpoints return 4xx', async () => {
      const res = await request(server)
        .get('/api/designs/missing.json')
        .set('X-WFB-Token', TOKEN);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
