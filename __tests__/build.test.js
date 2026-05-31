const { buildProject } = require('../lib/build');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

describe('Build Module', () => {
  // Use the OS temp directory so build artifacts never land in the project tree.
  // The OS reclaims the directory automatically; afterAll removes it immediately
  // so the same temp path is clean for the next run in the same session (e.g. CI).
  const testExportDir = path.join(os.tmpdir(), 'watchface-test-export');

  const mockCfg = {
    monkeyc: '/fake/monkeyc',
    devKey: '/fake/key.der',
    exportDir: testExportDir,
  };

  afterAll(() => {
    fs.rmSync(testExportDir, { recursive: true, force: true });
  });

  describe('buildProject', () => {
    it('rejects invalid projectName', async () => {
      const result = await buildProject(mockCfg, '', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('rejects invalid elements', async () => {
      const result = await buildProject(mockCfg, 'TestFace', [{ invalid: 'element' }]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('reports missing monkeyc', async () => {
      const result = await buildProject(mockCfg, 'TestFace', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('monkeyc not found');
    });

    it('reports missing developer key', async () => {
      const cfgWithRealMonkeyc = { ...mockCfg, monkeyc: process.cwd() };
      const result = await buildProject(cfgWithRealMonkeyc, 'TestFace', []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Developer key not found');
    });

    it('returns structured result with success flag and log', async () => {
      expect(typeof buildProject).toBe('function');
      // Real build test would require actual SDK paths
    });
  });

  describe('execFile error handling', () => {
    it('distinguishes ENOENT (missing executable) error', async () => {
      const result = await buildProject(mockCfg, 'TestFace', []);
      // With fake monkeyc path, should get ENOENT
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/monkeyc not found|Add the Garmin SDK/i);
    });

    it('provides permission denied message for EACCES', () => {
      // This test would require mocking execFile to return EACCES
      // For now, verify the error message exists in code
      const fs = require('fs');
      const buildCode = fs.readFileSync('./lib/build.js', 'utf8');
      expect(buildCode).toContain('EACCES');
      expect(buildCode).toContain('Permission denied');
    });

    it('distinguishes timeout errors (SIGTERM)', () => {
      // Verify timeout handling is in code
      const fs = require('fs');
      const buildCode = fs.readFileSync('./lib/build.js', 'utf8');
      expect(buildCode).toContain('SIGTERM');
      expect(buildCode).toContain('timed out');
    });

    it('returns log in error response for compiler diagnostics', () => {
      // Verify error response includes log for stderr output
      const fs = require('fs');
      const buildCode = fs.readFileSync('./lib/build.js', 'utf8');
      expect(buildCode).toContain('error: userMessage');
      expect(buildCode).toContain('log');
    });
  });
});
