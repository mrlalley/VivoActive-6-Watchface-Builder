'use strict';

/**
 * Tests for the async startup-validation helpers in electron/main.js.
 *
 * Covers:
 * 1. Missing VERSION file → fatal log + error dialog + app.quit(), checkSdkCompatibility
 *    is NOT called (early return added in this fix).
 * 2. VERSION file readable but invalid JSON → warn log, non-fatal return, no dialog, no quit.
 * 3. Valid VERSION + compatible SDK → startup proceeds to createServerManager.
 */

// ─── fs mock — must be hoisted before any require ────────────────────────────
// We mock only promises.access and promises.readFile since those are the only
// fs.promises calls the startup helpers make after this fix.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access:   jest.fn(),
      readFile: jest.fn(),
    },
  };
});

// ─── Electron mock ────────────────────────────────────────────────────────────
const appHandlers  = {};
const mockQuit     = jest.fn();
const mockShowErrorBox       = jest.fn();
const mockShowMessageBoxSync = jest.fn();
const mockShowMessageBox     = jest.fn();

jest.mock('electron', () => ({
  app: {
    on:         jest.fn((ev, cb) => { appHandlers[ev] = cb; }),
    getPath:    jest.fn(() => '/tmp/wfb-test'),
    getVersion: jest.fn(() => '1.0.0-test'),
    quit:       mockQuit,
  },
  BrowserWindow: jest.fn(),
  Menu:   { buildFromTemplate: jest.fn(() => ({})), setApplicationMenu: jest.fn() },
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  dialog: {
    showErrorBox:       mockShowErrorBox,
    showMessageBoxSync: mockShowMessageBoxSync,
    showMessageBox:     mockShowMessageBox,
  },
  shell:   { openExternal: jest.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: jest.fn() } } },
}), { virtual: false });

// ─── electron-store mock ──────────────────────────────────────────────────────
jest.mock('electron-store', () => {
  const MockStore = jest.fn().mockImplementation(() => ({
    get: jest.fn(() => ''),
    set: jest.fn(),
  }));
  return { default: MockStore };
});

// ─── Stub out heavy dependencies ──────────────────────────────────────────────
jest.mock('dotenv',           () => ({ config: jest.fn() }), { virtual: false });
jest.mock('../lib/logger',    () => ({
  createLogger: () => ({
    info:  jest.fn(), warn: mockWarn, error: jest.fn(),
    debug: jest.fn(), fatal: mockFatal, child: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('../lib/keygen',    () => ({
  generateKey: jest.fn(), getDefaultKeyPath: jest.fn(() => '/fake/key.der'), validateKeyFile: jest.fn(),
}));
jest.mock('../lib/sdk-detect', () => ({
  detectSdk:        mockDetectSdk,
  detectSdkSync:    jest.fn().mockReturnValue({ sdkBin: '/fake/sdk/bin', sdkVersion: '9.1.0' }),
  SdkNotFoundError: class SdkNotFoundError extends Error {},
  compareVersions:  jest.fn(() => 0),   // 0 = compatible by default
}));
jest.mock('../lib/config',             () => ({ getConfig: jest.fn(() => ({})), scanForLatestSdk: jest.fn(() => null) }));
jest.mock('../src/shared/ipc-schema',  () => ({
  validateDialogOpenOptions:  jest.fn(() => ({ valid: true })),
  validateSettingsSaveConfig:  jest.fn(() => ({ valid: true })),
  validateKeyGenerateOptions: jest.fn(() => ({ valid: true })),
  validateShellOpenVSCode:    jest.fn(() => ({ valid: true })),
}));
jest.mock('../electron/ipc-helpers',    () => ({ createLoggedHandle: jest.fn(() => jest.fn()), createRateLimitHandler: jest.fn(() => jest.fn()) }));
jest.mock('../electron/health-polling', () => ({ createHealthPollingManager: jest.fn(() => ({ startHealthPolling: jest.fn(), stopHealthPolling: jest.fn() })) }));
jest.mock('../electron/window-manager', () => ({ createWindowManager: jest.fn(() => ({ createWindow: jest.fn(), getMainWindow: jest.fn(() => null) })) }));
jest.mock('../src/main/ipc/handlers',   () => ({ registerIpcHandlers: jest.fn() }));
jest.mock('../electron/port-utils',     () => ({ pickPort: jest.fn().mockResolvedValue(13579) }));
jest.mock('../electron/server-manager', () => ({
  createServerManager: jest.fn(() => ({
    startServer:   jest.fn(),
    waitForServer: jest.fn().mockResolvedValue(),
    killServer:    jest.fn(),
  })),
}));

// ─── Mutable logger and sdk stubs ─────────────────────────────────────────────
// Defined here so tests can assert on them.
const mockFatal     = jest.fn();
const mockWarn      = jest.fn();
const mockDetectSdk = jest.fn();

// ─── Pull in mocked fs.promises ──────────────────────────────────────────────
const fs = require('fs');

// ─── Require main.js — registers app event handlers ──────────────────────────
require('../electron/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_VERSION = JSON.stringify({
  templateVersion:  '1.0.0',
  minSdkVersion:    '8.0.0',
  minApiLevel:      '4.2.0',
  targetDeviceId:   'vivoactive6',
  fallbackDeviceId: 'venu3',
});

function resetMocks() {
  mockQuit.mockClear();
  mockShowErrorBox.mockClear();
  mockShowMessageBoxSync.mockClear();
  mockFatal.mockClear();
  mockWarn.mockClear();
  mockDetectSdk.mockReset();
  fs.promises.access.mockReset();
  fs.promises.readFile.mockReset();
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('ensureTemplateVersionExists — missing VERSION file', () => {
  beforeEach(() => {
    resetMocks();
    // File does not exist
    fs.promises.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // readFile should never be reached, but set a default just in case
    fs.promises.readFile.mockResolvedValue(VALID_VERSION);
    mockDetectSdk.mockResolvedValue({ sdkVersion: '9.1.0', deviceIds: ['vivoactive6'] });
  });

  test('logs fatal event', async () => {
    await appHandlers['ready']();
    expect(mockFatal).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'startup.version_file_missing' })
    );
  });

  test('shows the error dialog with correct title', async () => {
    await appHandlers['ready']();
    expect(mockShowErrorBox).toHaveBeenCalledWith(
      'Template Version File Missing',
      expect.stringContaining('garmin-project-template/VERSION')
    );
  });

  test('calls app.quit()', async () => {
    await appHandlers['ready']();
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  test('does NOT proceed to checkSdkCompatibility (fs.promises.readFile not called)', async () => {
    await appHandlers['ready']();
    expect(fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('does NOT call createServerManager after quit', async () => {
    const { createServerManager } = require('../electron/server-manager');
    createServerManager.mockClear();
    await appHandlers['ready']();
    expect(createServerManager).not.toHaveBeenCalled();
  });
});

describe('checkSdkCompatibility — VERSION file present but invalid JSON', () => {
  beforeEach(() => {
    resetMocks();
    // File exists
    fs.promises.access.mockResolvedValue();
    // File contains garbage
    fs.promises.readFile.mockResolvedValue('this is not valid json {{{');
    mockDetectSdk.mockResolvedValue({ sdkVersion: '9.1.0', deviceIds: ['vivoactive6'] });
  });

  test('logs startup.version_file_unreadable warning', async () => {
    await appHandlers['ready']();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'startup.version_file_unreadable' })
    );
  });

  test('does NOT call app.quit() (non-fatal)', async () => {
    await appHandlers['ready']();
    expect(mockQuit).not.toHaveBeenCalled();
  });

  test('does NOT show an error dialog', async () => {
    await appHandlers['ready']();
    expect(mockShowErrorBox).not.toHaveBeenCalled();
  });
});

describe('checkSdkCompatibility — valid VERSION + compatible SDK', () => {
  beforeEach(() => {
    resetMocks();
    fs.promises.access.mockResolvedValue();
    fs.promises.readFile.mockResolvedValue(VALID_VERSION);
    mockDetectSdk.mockResolvedValue({ sdkVersion: '9.1.0', deviceIds: ['vivoactive6'] });
  });

  test('does not quit or show any error', async () => {
    await appHandlers['ready']();
    expect(mockQuit).not.toHaveBeenCalled();
    expect(mockShowErrorBox).not.toHaveBeenCalled();
  });

  test('proceeds to createServerManager', async () => {
    const { createServerManager } = require('../electron/server-manager');
    createServerManager.mockClear();
    await appHandlers['ready']();
    expect(createServerManager).toHaveBeenCalledTimes(1);
  });

  test('createServerManager receives the runtime URL derived from pickPort', async () => {
    const { createServerManager } = require('../electron/server-manager');
    createServerManager.mockClear();
    await appHandlers['ready']();
    // pickPort mock returns 13579; URL must be 127.0.0.1:13579
    expect(createServerManager).toHaveBeenCalledWith(
      13579,
      'http://127.0.0.1:13579',
      expect.any(String), // SESSION_TOKEN
      expect.anything(),  // LOG_FILE_PATH
      expect.anything(),  // store
      expect.anything(),  // log
    );
  });
});
