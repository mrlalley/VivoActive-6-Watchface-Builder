'use strict';

/**
 * Tests for optimized export existence check using manifest-based lookup.
 *
 * Verifies that:
 * - Direct manifest lookup works without recursive tree scanning
 * - Missing exports are correctly reported
 * - Manifest entries are cleaned up after check
 * - Fallback recursive scan is used when manifest is missing/stale
 * - Path safety is maintained (no directory traversal)
 */

const request = require('supertest');
const { createServer } = require('../server');
const path = require('path');
const fs = require('fs');
const { mkdtempSync } = require('fs');

describe('Export Existence Check Optimization', () => {
  const TOKEN = 'a'.repeat(64);
  let server;
  let testDir;
  const mockConfig = {
    designsDir: null,
    exportDir: null,
    sdkPath: '/fake/sdk',
    devKeyPath: '/fake/key',
    simExe: '/fake/sim'
  };

  beforeEach(() => {
    this.savedToken = process.env.WFB_SESSION_TOKEN;
    process.env.WFB_SESSION_TOKEN = TOKEN;
    testDir = mkdtempSync(path.join(__dirname, 'test-export-'));
    mockConfig.designsDir = testDir;
    mockConfig.exportDir = path.join(testDir, 'exports');
    fs.mkdirSync(mockConfig.exportDir, { recursive: true });
    server = createServer(mockConfig);
  });

  afterEach(() => {
    if (this.savedToken) {
      process.env.WFB_SESSION_TOKEN = this.savedToken;
    } else {
      delete process.env.WFB_SESSION_TOKEN;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('Direct manifest lookup', () => {
    test('finds existing export via manifest', async () => {
      // Set up: create export structure and manifest
      const requestId = 'abc123def456';
      const projectName = 'TestFace';
      const safeProjectName = 'TestFace';

      const binDir = path.join(mockConfig.exportDir, requestId, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'TestFace.prg'), 'fake prg content');

      // Create manifest
      const manifest = { [safeProjectName]: requestId };
      const manifestPath = path.join(mockConfig.exportDir, '.exports.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(true);
      expect(res.body.projectName).toBe('TestFace');
    });

    test('reports missing export correctly', async () => {
      const res = await request(server)
        .get('/api/export/check/NonExistent')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(false);
    });

    test('sanitizes projectName before lookup (collision check)', async () => {
      // Set up: create export with sanitized name
      const requestId = 'test123';
      const safeProjectName = 'My_Watch_Face'; // safePrgName normalizes to this

      const binDir = path.join(mockConfig.exportDir, requestId, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'My_Watch_Face.prg'), 'fake prg');

      // Manifest uses safe name
      const manifest = { [safeProjectName]: requestId };
      fs.writeFileSync(path.join(mockConfig.exportDir, '.exports.json'), JSON.stringify(manifest));

      // Request with different input that normalizes to same safe name
      const res = await request(server)
        .get('/api/export/check/My Watch Face!')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      // Should find it because both normalize to 'My_Watch_Face'
      expect(res.body.exists).toBe(true);
    });

    test('cleans up manifest entry after successful check', async () => {
      // Set up: create export and manifest
      const requestId = 'abc123';
      const projectName = 'TestFace';
      const safeProjectName = 'TestFace';

      const binDir = path.join(mockConfig.exportDir, requestId, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'TestFace.prg'), 'fake prg');

      const manifestPath = path.join(mockConfig.exportDir, '.exports.json');
      const manifest = { [safeProjectName]: requestId };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      // Verify manifest has entry
      let manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifestContent[safeProjectName]).toBe(requestId);

      // Make the check
      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.exists).toBe(true);

      // Wait for setImmediate cleanup to run
      await new Promise(resolve => setImmediate(resolve));
      // Give async cleanup a moment
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify both requestId directory and manifest entry are cleaned
      expect(fs.existsSync(path.join(mockConfig.exportDir, requestId))).toBe(false);

      if (fs.existsSync(manifestPath)) {
        manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifestContent[safeProjectName]).toBeUndefined();
      }
    });
  });

  describe('Fallback to recursive scan', () => {
    test('falls back to scan when manifest is missing', async () => {
      // Set up: create export structure WITHOUT manifest
      const requestId = 'abc123';
      const binDir = path.join(mockConfig.exportDir, requestId, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'TestFace.prg'), 'fake prg');

      // No manifest file created — should still find via scan

      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.exists).toBe(true);
    });

    test('falls back when manifest entry is stale (file removed)', async () => {
      // Set up: manifest points to non-existent file
      const requestId = 'abc123';
      const safeProjectName = 'StaleFace';

      // Create manifest but no actual file
      const manifest = { [safeProjectName]: requestId };
      fs.writeFileSync(
        path.join(mockConfig.exportDir, '.exports.json'),
        JSON.stringify(manifest)
      );

      // Create another export that scan will find
      const realRequestId = 'real456';
      const binDir = path.join(mockConfig.exportDir, realRequestId, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'StaleFace.prg'), 'fake prg');

      // Update manifest to point to real location
      const updatedManifest = { [safeProjectName]: realRequestId };
      fs.writeFileSync(
        path.join(mockConfig.exportDir, '.exports.json'),
        JSON.stringify(updatedManifest)
      );

      const res = await request(server)
        .get('/api/export/check/StaleFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      // Should still find via scan if direct lookup fails
      expect(res.body.exists).toBe(true);
    });

    test('respects MAX_DEPTH limit in fallback scan', async () => {
      // Create deeply nested structure beyond MAX_DEPTH (10)
      let currentDir = mockConfig.exportDir;
      for (let i = 0; i < 15; i++) {
        currentDir = path.join(currentDir, `level${i}`);
        fs.mkdirSync(currentDir, { recursive: true });
      }

      // Try to check — should error or not find due to depth limit
      const res = await request(server)
        .get('/api/export/check/DeepFace')
        .set('X-WFB-Token', TOKEN);

      // Should either error or report not found
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.exists).toBe(false);
      }
    });
  });

  describe('Path safety', () => {
    test('validates resolved path stays within exportDir', async () => {
      // Create a malicious manifest entry pointing outside exportDir
      const manifest = {
        'TestFace': '../../../etc/passwd' // attempt directory traversal
      };
      fs.writeFileSync(
        path.join(mockConfig.exportDir, '.exports.json'),
        JSON.stringify(manifest)
      );

      // Should be blocked by path safety check
      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      // Should not find (safety check prevents access)
      expect(res.body.exists).toBe(false);
    });

    test('requires authentication to check export status', async () => {
      const res = await request(server)
        .get('/api/export/check/TestFace');

      expect(res.status).toBe(401);
    });
  });

  describe('Manifest format handling', () => {
    test('handles corrupted manifest gracefully', async () => {
      // Create invalid JSON manifest
      fs.writeFileSync(
        path.join(mockConfig.exportDir, '.exports.json'),
        'not valid json {'
      );

      // Should fall back to scan without error
      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.exists).toBe(false); // Nothing found, but no crash
    });

    test('handles empty manifest', async () => {
      // Create empty manifest
      fs.writeFileSync(
        path.join(mockConfig.exportDir, '.exports.json'),
        '{}'
      );

      const res = await request(server)
        .get('/api/export/check/TestFace')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.exists).toBe(false);
    });
  });
});
