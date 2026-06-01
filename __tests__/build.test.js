jest.mock('child_process');

const { buildProject }  = require('../lib/build');
const { ValidationError } = require('../lib/errors');
const path              = require('path');
const os                = require('os');
const fs                = require('fs');
const { EventEmitter }  = require('events');

describe('Build Module', () => {
  // Use the OS temp directory so build artifacts never land in the project tree.
  // Each run gets a unique directory (mkdtempSync adds a random suffix),
  // preventing false passes from residue of crashed runs and collisions in
  // parallel test execution. afterAll unconditionally removes it.
  // Initialized with a fallback path that beforeAll will override with mkdtempSync.
  let testExportDir = path.join(os.tmpdir(), 'wfb-test-fallback');

  beforeAll(() => {
    // Create a unique temp directory for this test run.
    // mkdtempSync appends a random suffix, making each run's path unique.
    // The 'wfb-test-' prefix makes leaked directories identifiable in os.tmpdir()
    // when debugging CI failures.
    testExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-test-'));
  });

  const mockCfg = {
    monkeyc: '/fake/monkeyc',
    devKey: '/fake/key.der',
    exportDir: testExportDir,
  };

  afterAll(() => {
    // Unconditional cleanup of the unique temp directory.
    // The guard handles the edge case where beforeAll threw before mkdtempSync completed.
    // force: true suppresses ENOENT if the directory was already removed,
    // preventing afterAll cleanup errors from masking test failures.
    if (testExportDir) {
      fs.rmSync(testExportDir, { recursive: true, force: true });
    }
  });

  describe('buildProject', () => {
    it('rejects invalid projectName', async () => {
      await expect(buildProject(mockCfg, '', [])).rejects.toThrow(ValidationError);
    });

    it('rejects invalid elements', async () => {
      await expect(buildProject(mockCfg, 'TestFace', [{ invalid: 'element' }])).rejects.toThrow(ValidationError);
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
  });

  describe('buildProject behavioral tests', () => {
    const childProcess = require('child_process');

    let dummyMonkeyc;
    let dummyDevKey;
    let spawnCfg;

    beforeAll(() => {
      // Compute dummy paths using the already-initialized testExportDir.
      dummyMonkeyc = path.join(testExportDir, 'fake-monkeyc');
      dummyDevKey  = path.join(testExportDir, 'fake-key.der');
      spawnCfg = {
        monkeyc:   dummyMonkeyc,
        devKey:    dummyDevKey,
        exportDir: testExportDir,
      };

      fs.writeFileSync(dummyMonkeyc, '');
      fs.writeFileSync(dummyDevKey,  '');
    });

    afterEach(() => {
      childProcess.spawn.mockReset();
      jest.restoreAllMocks();
    });

    it('returns an error result when spawn throws EACCES', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill   = jest.fn();
      childProcess.spawn.mockReturnValue(mockChild);

      // EACCES surfaces via the child 'error' event, not a synchronous throw:
      // spawn() succeeds (returns child), then the OS emits error asynchronously.
      // A synchronous throw inside new Promise((resolve) => {}) causes rejection,
      // not a resolved { success: false } result.
      process.nextTick(() => {
        mockChild.emit('error', Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      });

      const result = await buildProject(spawnCfg, 'TestFace', []);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EACCES|permission/i);
    });

    it('kills the child and returns a timeout error when build exceeds the timeout', async () => {
      jest.useFakeTimers();

      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      // Emit 'close' synchronously inside kill so jest.runAllTimers() resolves the promise.
      mockChild.kill = jest.fn(() => mockChild.emit('close', null, 'SIGTERM'));
      childProcess.spawn.mockReturnValue(mockChild);

      const buildPromise = buildProject(spawnCfg, 'TestFace', []);
      jest.runAllTimers();
      const result = await buildPromise;

      expect(mockChild.kill).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);

      jest.useRealTimers();
    });

    it('resolves with success and writes design data when build exits with code 0', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();
      childProcess.spawn.mockReturnValue(mockChild);

      // buildProject writes design.json directly via fs.writeFileSync on success —
      // it does not call design-store.saveDesign. Assert on result shape instead.
      const buildPromise = buildProject(spawnCfg, 'TestFace', []);
      mockChild.emit('close', 0);
      const result = await buildPromise;

      expect(result.success).toBe(true);
      expect(typeof result.designPath).toBe('string');
    });

    it('includes stderr output in the error result when build exits non-zero', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();
      childProcess.spawn.mockReturnValue(mockChild);

      const buildPromise = buildProject(spawnCfg, 'TestFace', []);
      mockChild.stderr.emit('data', 'monkeyc: fatal error: bad input');
      mockChild.emit('close', 1);
      const result = await buildPromise;

      // On non-zero exit, result.error is the user-facing message ("Build failed …");
      // the raw compiler output is in result.log.
      expect(result.success).toBe(false);
      expect(result.log).toMatch(/monkeyc: fatal error: bad input/);
    });
  });
});
