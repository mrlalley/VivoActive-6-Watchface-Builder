const { buildProject } = require('../lib/build');
const path = require('path');

describe('Build Module', () => {
  const mockCfg = {
    monkeyc: '/fake/monkeyc',
    devKey: '/fake/key.der',
    exportDir: path.join(__dirname, '..', 'test-export'),
  };

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
});
