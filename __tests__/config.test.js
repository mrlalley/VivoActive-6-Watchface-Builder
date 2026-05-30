const { getConfig } = require('../lib/config');
const path = require('path');
const os = require('os');

describe('Config - Cross-Platform Path Detection', () => {
  // Save original environment
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment after each test
    Object.defineProperty(process, 'platform', originalPlatform);
    process.env = { ...originalEnv };
  });

describe('getConfig - Priority Chain', () => {
    it('prioritizes parameter overrides over all other sources', () => {
      process.env.GARMIN_SDK_BIN = '/env/sdk';

      const config = getConfig({
        sdkBin: '/override/sdk',
      });

      expect(config.sdkBin).toBe('/override/sdk');
    });

    it('uses environment variable when override not provided', () => {
      process.env.GARMIN_SDK_BIN = '/env/sdk';

      const config = getConfig({});

      expect(config.sdkBin).toBe('/env/sdk');
    });

    it('uses detector function when env var not set', () => {
      delete process.env.GARMIN_SDK_BIN;
      const mockDetector = jest.fn(() => '/detected/sdk');

      const config = getConfig({}, { detectSdkPath: mockDetector });

      expect(mockDetector).toHaveBeenCalled();
      expect(config.sdkBin).toBe('/detected/sdk');
    });

    it('falls back to default when no other sources available', () => {
      delete process.env.GARMIN_SDK_BIN;

      const config = getConfig({}, { detectSdkPath: () => null });

      // Should return a default path (platform-aware)
      expect(config.sdkBin).toBeDefined();
      expect(config.sdkBin).toContain('Garmin');
    });

    it('respects full priority chain for devKey', () => {
      delete process.env.GARMIN_DEV_KEY;

      // Only override
      let config = getConfig({ devKey: '/override/key' });
      expect(config.devKey).toBe('/override/key');

      // Env var
      process.env.GARMIN_DEV_KEY = '/env/key';
      config = getConfig({});
      expect(config.devKey).toBe('/env/key');

      // Detector
      delete process.env.GARMIN_DEV_KEY;
      const mockDetector = jest.fn(() => '/detected/key');
      config = getConfig({}, { getDefaultKeyPath: mockDetector });
      expect(mockDetector).toHaveBeenCalled();
      expect(config.devKey).toBe('/detected/key');
    });
  });

  describe('getConfig - Environment Variables', () => {
    it('respects GARMIN_SDK_BIN environment variable', () => {
      process.env.GARMIN_SDK_BIN = '/custom/sdk/bin';

      const config = getConfig({});

      expect(config.sdkBin).toBe('/custom/sdk/bin');
    });

    it('respects GARMIN_DEV_KEY environment variable', () => {
      process.env.GARMIN_DEV_KEY = '/custom/key.der';

      const config = getConfig({});

      expect(config.devKey).toBe('/custom/key.der');
    });

    it('respects GARMIN_EXPORT_DIR environment variable', () => {
      process.env.GARMIN_EXPORT_DIR = '/custom/export';

      const config = getConfig({});

      expect(config.exportDir).toBe('/custom/export');
    });

    it('respects GARMIN_TEMP_DIR environment variable', () => {
      process.env.GARMIN_TEMP_DIR = '/custom/temp';

      const config = getConfig({});

      expect(config.tempDir).toBe('/custom/temp');
    });
  });

  describe('getConfig - Tool Paths', () => {
    it('generates correct monkeyc path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const config = getConfig({ sdkBin: 'C:\\SDK\\bin' });

      expect(config.monkeyc).toContain('monkeyc.bat');
      expect(config.monkeyc).toContain('SDK');
    });

    it('generates correct monkeyc path on macOS/Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const config = getConfig({ sdkBin: '/sdk/bin' });

      expect(config.monkeyc).toContain('monkeyc');
      expect(config.monkeyc).not.toContain('.bat');
    });

    it('generates correct monkeydo path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const config = getConfig({ sdkBin: 'C:\\SDK\\bin' });

      expect(config.monkeydo).toContain('monkeydo.bat');
    });

    it('generates correct simulator path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const config = getConfig({ sdkBin: 'C:\\SDK\\bin' });

      expect(config.simExe).toContain('simulator.exe');
    });

    it('generates correct simulator path on macOS/Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const config = getConfig({ sdkBin: '/sdk/bin' });

      expect(config.simExe).toContain('simulator');
      expect(config.simExe).not.toContain('.exe');
    });
  });

  describe('getConfig - Return Structure', () => {
    it('returns object with all required properties', () => {
      const config = getConfig({});

      expect(config).toHaveProperty('sdkBin');
      expect(config).toHaveProperty('monkeyc');
      expect(config).toHaveProperty('monkeydo');
      expect(config).toHaveProperty('simExe');
      expect(config).toHaveProperty('devKey');
      expect(config).toHaveProperty('exportDir');
      expect(config).toHaveProperty('tempDir');
    });

    it('all path properties are strings', () => {
      const config = getConfig({});

      expect(typeof config.sdkBin).toBe('string');
      expect(typeof config.monkeyc).toBe('string');
      expect(typeof config.monkeydo).toBe('string');
      expect(typeof config.simExe).toBe('string');
      expect(typeof config.devKey).toBe('string');
      expect(typeof config.exportDir).toBe('string');
      expect(typeof config.tempDir).toBe('string');
    });
  });

  describe('getConfig - Detector Functions', () => {
    it('calls detectSdkPath if provided and override not set', () => {
      delete process.env.GARMIN_SDK_BIN;
      const mockDetector = jest.fn(() => '/detected/sdk');

      getConfig({}, { detectSdkPath: mockDetector });

      expect(mockDetector).toHaveBeenCalled();
    });

    it('does not call detector if override already provided', () => {
      const mockDetector = jest.fn(() => '/detected/sdk');

      getConfig({ sdkBin: '/override/sdk' }, { detectSdkPath: mockDetector });

      expect(mockDetector).not.toHaveBeenCalled();
    });

    it('does not call detector if env var already set', () => {
      process.env.GARMIN_SDK_BIN = '/env/sdk';
      const mockDetector = jest.fn(() => '/detected/sdk');

      getConfig({}, { detectSdkPath: mockDetector });

      expect(mockDetector).not.toHaveBeenCalled();
    });

    it('handles detector returning null gracefully', () => {
      delete process.env.GARMIN_SDK_BIN;
      const mockDetector = jest.fn(() => null);

      const config = getConfig({}, { detectSdkPath: mockDetector });

      // Should fall back to default
      expect(config.sdkBin).toBeDefined();
      expect(config.sdkBin).toContain('Garmin');
    });
  });
});
