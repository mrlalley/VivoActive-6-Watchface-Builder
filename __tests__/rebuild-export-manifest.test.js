'use strict';

/**
 * Unit tests for rebuildExportManifest function
 *
 * Verifies that:
 * - Manifest is correctly rebuilt by scanning .prg files
 * - Atomic write pattern (tmp-then-rename) is used
 * - Non-fatal error handling (warnings, no throws)
 * - Returns correct count of .prg files found
 */

const fs = require('fs');
const path = require('path');
const { mkdtempSync } = require('fs');
const { rebuildExportManifest } = require('../lib/build');

describe('rebuildExportManifest function', () => {
  let testDir;

  beforeEach(() => {
    testDir = mkdtempSync(path.join(__dirname, 'test-rebuild-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('rebuilds manifest from .prg files in exportDir', async () => {
    // Set up: create export structure with .prg files
    const requestId1 = 'req001';
    const binDir1 = path.join(testDir, requestId1, 'bin');
    fs.mkdirSync(binDir1, { recursive: true });
    fs.writeFileSync(path.join(binDir1, 'Face1.prg'), 'content');

    const requestId2 = 'req002';
    const binDir2 = path.join(testDir, requestId2, 'bin');
    fs.mkdirSync(binDir2, { recursive: true });
    fs.writeFileSync(path.join(binDir2, 'Face2.prg'), 'content');

    // Call rebuild function
    const count = await rebuildExportManifest(testDir);

    expect(count).toBe(2);

    // Verify manifest was created correctly
    const manifestPath = path.join(testDir, '.exports.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest['Face1']).toBe(requestId1);
    expect(manifest['Face2']).toBe(requestId2);
  });

  test('uses atomic write pattern (tmp-then-rename)', async () => {
    // Set up: create one export
    const requestId = 'req123';
    const binDir = path.join(testDir, requestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'Face.prg'), 'content');

    // Spy on fs.promises.rename to verify atomic pattern
    const originalRename = fs.promises.rename;
    let renameWasCalled = false;

    fs.promises.rename = async (oldPath, newPath) => {
      renameWasCalled = true;
      expect(oldPath).toContain('.tmp');
      return originalRename.call(fs.promises, oldPath, newPath);
    };

    try {
      await rebuildExportManifest(testDir);
      expect(renameWasCalled).toBe(true);
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  test('handles empty exportDir gracefully', async () => {
    // Call rebuild on empty directory
    const count = await rebuildExportManifest(testDir);

    expect(count).toBe(0);

    // Manifest should still be created (empty)
    const manifestPath = path.join(testDir, '.exports.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(Object.keys(manifest).length).toBe(0);
  });

  test('handles missing bin directories gracefully', async () => {
    // Create request directory without bin subdirectory
    const requestId = 'req123';
    fs.mkdirSync(path.join(testDir, requestId), { recursive: true });
    // No bin directory created

    const count = await rebuildExportManifest(testDir);

    // Should return 0 (no .prg files found)
    expect(count).toBe(0);
  });

  test('ignores non-.prg files', async () => {
    // Create a request with various file types
    const requestId = 'req123';
    const binDir = path.join(testDir, requestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    fs.writeFileSync(path.join(binDir, 'Face.prg'), 'prg content');
    fs.writeFileSync(path.join(binDir, 'design.json'), 'json content');
    fs.writeFileSync(path.join(binDir, 'readme.txt'), 'text content');

    const count = await rebuildExportManifest(testDir);

    expect(count).toBe(1); // Only .prg file counted
  });

  test('handles multiple .prg files in same request directory', async () => {
    // Create request with multiple .prg files (unusual but should handle)
    const requestId = 'req123';
    const binDir = path.join(testDir, requestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    fs.writeFileSync(path.join(binDir, 'Face1.prg'), 'content');
    fs.writeFileSync(path.join(binDir, 'Face2.prg'), 'content');

    const count = await rebuildExportManifest(testDir);

    // Both .prg files should be found
    expect(count).toBe(2);

    const manifest = JSON.parse(fs.readFileSync(path.join(testDir, '.exports.json'), 'utf8'));
    expect(manifest['Face1']).toBe(requestId);
    expect(manifest['Face2']).toBe(requestId);
  });

  test('extracts prgName correctly from filename', async () => {
    // Create file with complex name
    const requestId = 'req123';
    const binDir = path.join(testDir, requestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const prgName = 'My_Complex_Watch_Face_v2';
    fs.writeFileSync(path.join(binDir, `${prgName}.prg`), 'content');

    const count = await rebuildExportManifest(testDir);

    expect(count).toBe(1);

    const manifest = JSON.parse(fs.readFileSync(path.join(testDir, '.exports.json'), 'utf8'));
    expect(manifest[prgName]).toBe(requestId);
  });

  test('returns 0 when exportDir does not exist', async () => {
    const nonExistentDir = path.join(testDir, 'does-not-exist');

    const count = await rebuildExportManifest(nonExistentDir);

    expect(count).toBe(0);
  });

  test('overwrites existing manifest (rebuild pattern)', async () => {
    // Create old manifest with stale entries
    const oldManifest = { 'OldFace': 'oldreq123', 'AnotherOld': 'oldreq456' };
    fs.writeFileSync(path.join(testDir, '.exports.json'), JSON.stringify(oldManifest));

    // Create new export
    const newRequestId = 'newreq789';
    const binDir = path.join(testDir, newRequestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'NewFace.prg'), 'content');

    // Rebuild manifest
    const count = await rebuildExportManifest(testDir);

    expect(count).toBe(1);

    const newManifest = JSON.parse(fs.readFileSync(path.join(testDir, '.exports.json'), 'utf8'));
    expect(newManifest['OldFace']).toBeUndefined();
    expect(newManifest['AnotherOld']).toBeUndefined();
    expect(newManifest['NewFace']).toBe(newRequestId);
  });

  test('skips non-directory entries in exportDir', async () => {
    // Create request directory with .prg file
    const requestId = 'req123';
    const binDir = path.join(testDir, requestId, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'Face.prg'), 'content');

    // Create a file (not directory) at top level of exportDir
    fs.writeFileSync(path.join(testDir, 'toplevel.txt'), 'should be ignored');

    const count = await rebuildExportManifest(testDir);

    // Should find 1 .prg file, ignore the .txt file
    expect(count).toBe(1);
  });
});
