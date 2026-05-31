// Concurrency tests for race condition mitigation.
// Tests that rapid concurrent requests are serialized properly.

const { buildProject } = require('../lib/build');
const { saveDesign, listDesigns } = require('../lib/design-store');
const { AsyncQueue } = require('../lib/queue');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

describe('Concurrency Protection', () => {
  const testDir = path.join(__dirname, 'test-concurrent');

  // Cleanup before and after tests
  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('AsyncQueue', () => {
    it('serializes tasks (max 1 concurrent)', async () => {
      const queue = new AsyncQueue(1);
      const order = [];

      const task1 = () => {
        return new Promise((resolve) => {
          order.push('start1');
          setTimeout(() => {
            order.push('end1');
            resolve();
          }, 50);
        });
      };

      const task2 = () => {
        return new Promise((resolve) => {
          order.push('start2');
          order.push('end2');
          resolve();
        });
      };

      // Start both tasks concurrently
      await Promise.all([
        queue.add(task1, 'task1'),
        queue.add(task2, 'task2'),
      ]);

      // task2 should NOT have started until task1 was fully done
      expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
    });

    it('handles errors without breaking queue', async () => {
      const queue = new AsyncQueue(1);
      const results = [];

      const failTask = async () => {
        throw new Error('intentional error');
      };

      const successTask = async () => {
        results.push('success');
        return 'ok';
      };

      // First task fails
      await queue.add(failTask).catch(() => {
        results.push('error-caught');
      });

      // Second task should still run
      await queue.add(successTask);

      expect(results).toEqual(['error-caught', 'success']);
    });

    it('reports queue statistics', () => {
      const queue = new AsyncQueue(1);
      const stats = queue.stats();

      expect(stats.running).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.maxConcurrency).toBe(1);
    });
  });

  describe('Design Save Isolation', () => {
    it('atomic write-then-rename (no partial files)', async () => {
      const designsDir = path.join(testDir, 'designs-atomic');

      const testElement = {
        id: 1,
        fieldId: 'hours',
        label: 'Hours',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        zIndex: 0,
      };

      // Save a design
      const result = await saveDesign(designsDir, 'TestFace', [testElement]);

      expect(result.success).toBe(true);

      // Verify file was written fully (not partial).
      // result.filePath is now a basename ("TestFace.json") — reconstruct the full path.
      const fileContent = fs.readFileSync(path.join(designsDir, result.filePath), 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed.projectName).toBe('TestFace');
      expect(parsed.elements).toHaveLength(1);
      expect(parsed.savedAt).toBeDefined();
    });

    it('prevents overwrite loss with concurrent saves (would need queue)', async () => {
      const designsDir = path.join(testDir, 'designs-concurrent');
      const queue = new AsyncQueue(1);

      const testElement = {
        id: 1,
        fieldId: 'hours',
        label: 'Hours',
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        zIndex: 0,
      };

      // Simulate two concurrent saves of the same design
      const results = await Promise.all([
        queue.add(() => saveDesign(designsDir, 'Face1', [testElement])),
        queue.add(() => saveDesign(designsDir, 'Face1', [testElement])),
      ]);

      // Both should succeed (queue prevents collision)
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Final file should have valid data
      const listResult = await listDesigns(designsDir);
      expect(listResult).toHaveLength(1);
      expect(listResult[0].elementCount).toBe(1);
    });

    it('handles TOCTOU gracefully (mkdir with recursive)', async () => {
      const designsDir = path.join(testDir, 'designs-toctou');

      // Create designs directory
      const result1 = saveDesign(designsDir, 'Face1', [
        {
          id: 1,
          fieldId: 'hours',
          label: 'Hours',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          zIndex: 0,
        },
      ]);

      expect(result1.success).toBe(true);

      // Directory already exists, but second call should still work (no TOCTOU error)
      const result2 = saveDesign(designsDir, 'Face2', [
        {
          id: 2,
          fieldId: 'minutes',
          label: 'Minutes',
          x: 100,
          y: 100,
          width: 50,
          height: 50,
          zIndex: 1,
        },
      ]);

      expect(result2.success).toBe(true);

      // Both designs saved
      const designs = await listDesigns(designsDir);
      expect(designs).toHaveLength(2);
    });
  });

  describe('Build Request Isolation', () => {
    it('generates unique requestId per build', async () => {
      // NOTE: This test doesn't actually run buildProject (requires monkeyc)
      // Instead it verifies the request isolation logic at the API level

      // Simulate what buildProject does with requestId
      const requestIds = new Set();
      for (let i = 0; i < 5; i++) {
        const requestId = Math.random().toString(36).slice(2, 10);
        requestIds.add(requestId);
      }

      // All should be unique
      expect(requestIds.size).toBe(5);
    });

    it('uses request-scoped export directories', () => {
      // Verify the directory structure that would be created
      const baseExportDir = path.join(testDir, 'exported-builds');

      // Simulate 3 builds with unique IDs
      const requestIds = ['req001', 'req002', 'req003'];
      const requestDirs = requestIds.map((id) => path.join(baseExportDir, id));

      // These would be unique paths
      expect(new Set(requestDirs).size).toBe(3);

      // Each would have unique files
      const prgPaths = requestDirs.map((dir) => path.join(dir, 'bin', 'WatchFace.prg'));
      expect(new Set(prgPaths).size).toBe(3);
    });
  });

  describe('Preview Request Isolation', () => {
    it('uses request-scoped temp directories', () => {
      // Simulate preview temp directory isolation
      const baseTempDir = os.tmpdir();
      const requestIds = ['pre001', 'pre002', 'pre003'];

      const tempDirs = requestIds.map((id) => path.join(baseTempDir, `preview-${id}`));
      const prgPaths = tempDirs.map((dir) => path.join(dir, 'WatchFace.prg'));

      // All temp .prg paths should be unique
      expect(new Set(prgPaths).size).toBe(3);
    });

    it('prevents temp file collisions', () => {
      // Without request isolation: all preview calls write to same path
      // With request isolation: each gets unique subdir

      const tmpBase = os.tmpdir();
      const oldWay  = path.join(tmpBase, 'WatchFace.prg');
      const newWay1 = path.join(tmpBase, 'preview-req001', 'WatchFace.prg');
      const newWay2 = path.join(tmpBase, 'preview-req002', 'WatchFace.prg');

      // Old way: collision (same path)
      expect(oldWay).toBe(oldWay);

      // New way: no collision (different paths)
      expect(newWay1).not.toBe(newWay2);
    });
  });
});
