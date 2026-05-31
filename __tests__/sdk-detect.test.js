'use strict';

const path = require('path');
const os   = require('os');

// Must mock fs before requiring the module under test.
jest.mock('fs');
const fs = require('fs');

const { detectSdk, detectSdkSync, SdkNotFoundError, compareVersions } = require('../lib/sdk-detect');

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockSdkAt(sdkPath, version = '9.1.0') {
  const sdkBin     = path.join(sdkPath, 'bin');
  const versionTxt = path.join(sdkBin, 'version.txt');
  const monkeyc    = path.join(sdkBin, 'monkeyc');

  fs.existsSync.mockImplementation(p =>
    p === sdkPath || p === sdkBin || p === versionTxt || p === monkeyc
  );
  fs.readFileSync.mockImplementation(p => {
    if (p === versionTxt) return version + '\n';
    throw new Error('unexpected readFileSync: ' + p);
  });
  fs.readdirSync.mockReturnValue([]);
  fs.statSync.mockReturnValue({ isDirectory: () => false });
}

// ── compareVersions ───────────────────────────────────────────────────────────

describe('compareVersions', () => {
  test('returns positive when a > b', () => {
    expect(compareVersions('9.1.0', '4.2.0')).toBeGreaterThan(0);
  });
  test('returns negative when a < b', () => {
    expect(compareVersions('4.2.0', '9.1.0')).toBeLessThan(0);
  });
  test('returns 0 when equal', () => {
    expect(compareVersions('9.1.0', '9.1.0')).toBe(0);
  });
  test('handles numeric minor correctly: 4.10.0 > 4.2.0', () => {
    expect(compareVersions('4.10.0', '4.2.0')).toBeGreaterThan(0);
  });
});

// ── SdkNotFoundError ─────────────────────────────────────────────────────────

describe('SdkNotFoundError', () => {
  test('is instanceof Error', () => {
    const e = new SdkNotFoundError(['/foo', '/bar']);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SdkNotFoundError);
  });
  test('exposes searchedPaths array', () => {
    const paths = ['/foo', '/bar'];
    const e = new SdkNotFoundError(paths);
    expect(e.searchedPaths).toEqual(paths);
  });
  test('message includes a download hint', () => {
    const e = new SdkNotFoundError(['/nowhere']);
    expect(e.message).toMatch(/developer\.garmin\.com/);
  });
});

// ── detectSdkSync: env-var resolution ────────────────────────────────────────
// GARMIN_SDK_PATH points to the Sdks/ root that contains connectiq-sdk-* subdirs.

describe('detectSdkSync via GARMIN_SDK_PATH env var', () => {
  const sdksRoot = '/fake/Sdks';
  const sdkDir   = path.join(sdksRoot, 'connectiq-sdk-9.1.0');
  const sdkBin   = path.join(sdkDir, 'bin');
  const vTxt     = path.join(sdkBin, 'version.txt');
  const mc       = path.join(sdkBin, 'monkeyc');

  beforeEach(() => {
    process.env.GARMIN_SDK_PATH = sdksRoot;
    delete process.env.CIQ_HOME;

    fs.existsSync.mockImplementation(p =>
      [sdksRoot, sdkDir, sdkBin, vTxt, mc].includes(p)
    );
    fs.readdirSync.mockImplementation(p => {
      if (p === sdksRoot) return ['connectiq-sdk-9.1.0'];
      return [];
    });
    fs.readFileSync.mockImplementation(p => {
      if (p === vTxt) return '9.1.0';
      throw new Error('unexpected readFileSync: ' + p);
    });
    fs.statSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => {
    delete process.env.GARMIN_SDK_PATH;
    jest.resetAllMocks();
  });

  test('returns SDK found via env var Sdks root', () => {
    const sdk = detectSdkSync();
    expect(sdk.sdkPath).toBe(sdkDir);
    expect(sdk.sdkVersion).toBe('9.1.0');
    expect(sdk.sdkBin).toBe(sdkBin);
    expect(sdk.source).toBe(sdksRoot);
  });
});

// ── detectSdkSync: filesystem scan ───────────────────────────────────────────

describe('detectSdkSync via filesystem scan', () => {
  const home        = os.homedir();
  const sdksRoot    = path.join(home, 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks');
  const sdkDir      = path.join(sdksRoot, 'connectiq-sdk-9.1.0');
  const sdkBin      = path.join(sdkDir, 'bin');
  const versionTxt  = path.join(sdkBin, 'version.txt');
  const monkeyc     = path.join(sdkBin, 'monkeyc');

  beforeEach(() => {
    delete process.env.GARMIN_SDK_PATH;
    delete process.env.CIQ_HOME;

    fs.existsSync.mockImplementation(p =>
      [sdksRoot, sdkDir, sdkBin, versionTxt, monkeyc].includes(p)
    );
    fs.readdirSync.mockImplementation(p => {
      if (p === sdksRoot) return ['connectiq-sdk-9.1.0'];
      return [];
    });
    fs.readFileSync.mockImplementation(p => {
      if (p === versionTxt) return '9.1.0';
      throw new Error('unexpected readFileSync: ' + p);
    });
    fs.statSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => jest.resetAllMocks());

  test('returns SDK found by directory scan', () => {
    const sdk = detectSdkSync();
    expect(sdk.sdkPath).toBe(sdkDir);
    expect(sdk.sdkVersion).toBe('9.1.0');
    expect(sdk.source).toBe(sdksRoot);
  });
});

// ── detectSdkSync: multiple versions — latest wins ───────────────────────────

describe('detectSdkSync returns highest version when multiple are installed', () => {
  const home     = os.homedir();
  const sdksRoot = path.join(home, 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks');
  const v8Dir    = path.join(sdksRoot, 'connectiq-sdk-8.2.0');
  const v9Dir    = path.join(sdksRoot, 'connectiq-sdk-9.1.0');

  function sdkFiles(dir, ver) {
    return [
      dir,
      path.join(dir, 'bin'),
      path.join(dir, 'bin', 'version.txt'),
      path.join(dir, 'bin', 'monkeyc'),
    ];
  }

  beforeEach(() => {
    delete process.env.GARMIN_SDK_PATH;
    delete process.env.CIQ_HOME;

    const allFiles = [sdksRoot, ...sdkFiles(v8Dir, '8.2.0'), ...sdkFiles(v9Dir, '9.1.0')];
    fs.existsSync.mockImplementation(p => allFiles.includes(p));
    fs.readdirSync.mockImplementation(p => {
      if (p === sdksRoot) return ['connectiq-sdk-8.2.0', 'connectiq-sdk-9.1.0'];
      return [];
    });
    fs.readFileSync.mockImplementation(p => {
      if (p.includes('8.2.0')) return '8.2.0';
      if (p.includes('9.1.0')) return '9.1.0';
      throw new Error('unexpected readFileSync: ' + p);
    });
    fs.statSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => jest.resetAllMocks());

  test('returns version 9.1.0 not 8.2.0', () => {
    const sdk = detectSdkSync();
    expect(sdk.sdkVersion).toBe('9.1.0');
    expect(sdk.sdkPath).toBe(v9Dir);
  });
});

// ── detectSdkSync: not found ─────────────────────────────────────────────────

describe('detectSdkSync when no SDK is installed', () => {
  beforeEach(() => {
    delete process.env.GARMIN_SDK_PATH;
    delete process.env.CIQ_HOME;
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
  });

  afterEach(() => jest.resetAllMocks());

  test('throws SdkNotFoundError', () => {
    expect(() => detectSdkSync()).toThrow(SdkNotFoundError);
  });

  test('SdkNotFoundError.searchedPaths is a non-empty array', () => {
    let err;
    try { detectSdkSync(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SdkNotFoundError);
    expect(err.searchedPaths).toBeInstanceOf(Array);
    expect(err.searchedPaths.length).toBeGreaterThan(0);
  });
});

// ── detectSdk (async wrapper) ─────────────────────────────────────────────────

describe('detectSdk (async)', () => {
  const sdksRoot = '/fake/async-Sdks';
  const sdkDir   = path.join(sdksRoot, 'connectiq-sdk-9.1.0');
  const sdkBin   = path.join(sdkDir, 'bin');
  const vTxt     = path.join(sdkBin, 'version.txt');
  const mc       = path.join(sdkBin, 'monkeyc');

  beforeEach(() => {
    process.env.GARMIN_SDK_PATH = sdksRoot;
    delete process.env.CIQ_HOME;

    fs.existsSync.mockImplementation(p =>
      [sdksRoot, sdkDir, sdkBin, vTxt, mc].includes(p)
    );
    fs.readdirSync.mockImplementation(p => {
      if (p === sdksRoot) return ['connectiq-sdk-9.1.0'];
      return [];
    });
    fs.readFileSync.mockImplementation(p => {
      if (p === vTxt) return '9.1.0';
      throw new Error('unexpected readFileSync: ' + p);
    });
    fs.statSync.mockReturnValue({ isDirectory: () => false });
  });

  afterEach(() => {
    delete process.env.GARMIN_SDK_PATH;
    jest.resetAllMocks();
  });

  test('resolves with same result as detectSdkSync', async () => {
    const sdk = await detectSdk();
    expect(sdk.sdkVersion).toBe('9.1.0');
    expect(sdk.sdkPath).toBe(sdkDir);
  });

  test('rejects with SdkNotFoundError when SDK absent', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.readdirSync.mockReturnValue([]);
    await expect(detectSdk()).rejects.toThrow(SdkNotFoundError);
  });
});
