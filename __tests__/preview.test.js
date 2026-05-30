const { previewInSimulator, isSimulatorRunning, launchSimulator } = require('../lib/preview');

describe('Preview Module', () => {
  const mockCfg = {
    simExe: '/fake/simulator.exe',
    monkeydo: '/fake/monkeydo',
    exportDir: '/fake/export',
    tempDir: '/fake/temp',
  };

  describe('isSimulatorRunning', () => {
    it('returns a Promise', () => {
      const result = isSimulatorRunning();
      expect(result instanceof Promise).toBe(true);
    });

    // Windows-only tests would require mocking execFile
    it('assumes simulator not running on non-Windows', async () => {
      if (process.platform !== 'win32') {
        const running = await isSimulatorRunning();
        expect(running).toBe(false);
      }
    });
  });

  describe('launchSimulator', () => {
    it('is exported and callable', () => {
      expect(typeof launchSimulator).toBe('function');
    });
  });

  describe('previewInSimulator', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('is exported and callable', () => {
      expect(typeof previewInSimulator).toBe('function');
    });

    it('returns immediately (fire-and-forget pattern)', () => {
      const start = Date.now();
      previewInSimulator(mockCfg, '/fake/prg');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Returns almost immediately
      // Use fake timers to prevent setImmediate from running async work
    });

    it('accepts optional error callback', () => {
      const onError = jest.fn();
      expect(() => {
        previewInSimulator(mockCfg, '/fake/prg', onError);
      }).not.toThrow();
      // Fire-and-forget: callback called asynchronously, not synchronously
    });
  });
});
