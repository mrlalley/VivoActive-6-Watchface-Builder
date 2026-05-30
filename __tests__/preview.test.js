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
    it('does not throw on execution', () => {
      // Mock spawn would be required for full testing
      expect(() => launchSimulator({ simExe: '/fake/sim' })).not.toThrow();
    });
  });

  describe('previewInSimulator', () => {
    it('returns immediately (fire-and-forget)', () => {
      const start = Date.now();
      previewInSimulator(mockCfg, '/fake/prg');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Should return almost immediately
    });

    it('accepts optional error callback', () => {
      const onError = jest.fn();
      previewInSimulator(mockCfg, '/fake/prg', onError);
      // Callback would be called asynchronously in real scenario
    });
  });
});
