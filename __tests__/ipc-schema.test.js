/**
 * IPC Schema Validation Tests
 *
 * Tests for input validation functions in src/shared/ipc-schema.js.
 * Validators are pure functions with no side effects — testable without mocking.
 */

const { validateSettingsSaveConfig } = require('../src/shared/ipc-schema');

describe('validateSettingsSaveConfig', () => {
  describe('PASSING cases (valid: true)', () => {
    test('P1: Valid absolute paths for current platform (Unix)', () => {
      // Mock Unix platform for this test
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = validateSettingsSaveConfig({
        sdkBin: '/opt/garmin/sdk/bin/monkeyc',
        devKey: '/home/user/.garmin/dev.der',
      });

      Object.defineProperty(process, 'platform', originalPlatform);
      expect(result.valid).toBe(true);
    });

    test('P1: Valid absolute paths for Windows', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const result = validateSettingsSaveConfig({
        sdkBin: 'C:\\Garmin\\sdk\\bin\\monkeyc.bat',
        devKey: 'C:\\Users\\user\\.garmin\\dev.der',
      });

      Object.defineProperty(process, 'platform', originalPlatform);
      expect(result.valid).toBe(true);
    });

    test('P2: Paths with redundant separators (normalization)', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = validateSettingsSaveConfig({
        sdkBin: '/usr/local//garmin//bin/monkeyc',
        devKey: '/home/user/.garmin/dev.der',
      });

      Object.defineProperty(process, 'platform', originalPlatform);
      expect(result.valid).toBe(true);
    });

    test('P3: devKey extension is case-insensitive (.DER)', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = validateSettingsSaveConfig({
        sdkBin: '/opt/garmin/sdk/bin/monkeyc',
        devKey: '/home/user/.garmin/dev.DER',
      });

      Object.defineProperty(process, 'platform', originalPlatform);
      expect(result.valid).toBe(true);
    });

    test('P4: Optional fields — sdkBin undefined is allowed', () => {
      const result = validateSettingsSaveConfig({
        devKey: '/home/user/.garmin/dev.der',
      });

      expect(result.valid).toBe(true);
    });

    test('P5: Optional fields — devKey undefined is allowed', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = validateSettingsSaveConfig({
        sdkBin: '/opt/garmin/sdk/bin/monkeyc',
      });

      Object.defineProperty(process, 'platform', originalPlatform);
      expect(result.valid).toBe(true);
    });
  });

  describe('FAILING cases (valid: false)', () => {
    describe('Rule 1: Type and structure', () => {
      test('F10: config is null → error', () => {
        const result = validateSettingsSaveConfig(null);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('settings:saveConfig config must be an object');
      });

      test('F11: config is a string → error', () => {
        const result = validateSettingsSaveConfig('not an object');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('settings:saveConfig config must be an object');
      });

      test('F12: sdkBin is a number → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: 12345,
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('settings:saveConfig sdkBin must be a string');
      });

      test('F12b: devKey is a number → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: 54321,
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('settings:saveConfig devKey must be a string');
      });
    });

    describe('Rule 2: Non-empty strings', () => {
      test('F1: Empty sdkBin string → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must not be empty');
      });

      test('F2: Whitespace-only sdkBin → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '   \t  ',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must not be empty');
      });

      test('F3: Empty devKey string → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: '',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('devKey must not be empty');
      });
    });

    describe('Rule 3: No control characters', () => {
      test('F4: Control char (null byte) in sdkBin → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk\x00/monkeyc',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin contains invalid characters');
      });

      test('F5: Newline in devKey → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: '/home/user/.garmin/dev\n.der',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('devKey contains invalid characters');
      });

      test('F5b: Tab character in sdkBin → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin\t/sdk/bin/monkeyc',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin contains invalid characters');
      });
    });

    describe('Rule 4: Absolute path required', () => {
      test('F6: Relative sdkBin path → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '../garmin/sdk/bin/monkeyc',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must be an absolute path');
      });

      test('F7: Relative devKey path → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: './keys/dev.der',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('devKey must be an absolute path');
      });

      test('F6b: Path traversal attempt in sdkBin → error', () => {
        const result = validateSettingsSaveConfig({
          sdkBin: '../../etc/passwd',
          devKey: '/home/user/.garmin/dev.der',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must be an absolute path');
      });
    });

    describe('Rule 5: Expected filename semantics', () => {
      test('F8: sdkBin pointing to wrong binary (monkeydo) → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeydo',
          devKey: '/home/user/.garmin/dev.der',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must point to the monkeyc binary (monkeyc)');
      });

      test('F8: sdkBin pointing to wrong binary on Windows → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: 'C:\\Garmin\\sdk\\bin\\monkeydo.bat',
          devKey: 'C:\\Users\\user\\.garmin\\dev.der',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('sdkBin must point to the monkeyc binary (monkeyc.bat)');
      });

      test('F9: devKey with wrong extension (.key) → error', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: '/home/user/.garmin/dev.key',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('devKey must point to a .der file');
      });

      test('F9b: devKey with uppercase extension (.DER uppercase) should pass', () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        const result = validateSettingsSaveConfig({
          sdkBin: '/opt/garmin/sdk/bin/monkeyc',
          devKey: '/home/user/.garmin/dev.DER',
        });

        Object.defineProperty(process, 'platform', originalPlatform);
        expect(result.valid).toBe(true);
      });
    });
  });
});

describe('validateSettingsSaveConfig — Integration tests', () => {
  test('Handler normalization: normalized paths would pass validation', () => {
    // This test verifies that paths with redundant separators pass validation,
    // confirming that the handler's path.normalize() step is a safe transformation.
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const unnormalized = {
      sdkBin: '/usr/local//garmin//bin/monkeyc',
      devKey: '/home/user//.garmin/dev.der',
    };

    const result = validateSettingsSaveConfig(unnormalized);
    expect(result.valid).toBe(true);

    Object.defineProperty(process, 'platform', originalPlatform);
  });
});
