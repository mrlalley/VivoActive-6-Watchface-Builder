// Configuration management for SDK paths and settings.

const path = require('path');

function getConfig(overrides = {}) {
  const SDK_BIN = overrides.sdkBin || 'C:\\Users\\mr_la\\AppData\\Roaming\\Garmin\\ConnectIQ\\Sdks\\connectiq-sdk-win-9.1.0-2026-03-09-6a872a80b\\bin';
  const DEV_KEY = overrides.devKey || 'C:\\Users\\mr_la\\.garmin\\developer_key.der';
  const EXPORT_DIR = overrides.exportDir || path.join(__dirname, '..', 'exported-garmin-project');

  return {
    sdkBin: SDK_BIN,
    monkeyc: path.join(SDK_BIN, 'monkeyc.bat'),
    monkeydo: path.join(SDK_BIN, 'monkeydo.bat'),
    simExe: path.join(SDK_BIN, 'simulator.exe'),
    devKey: DEV_KEY,
    exportDir: EXPORT_DIR,
    tempDir: overrides.tempDir || 'C:\\Temp\\CIQPreview',
  };
}

module.exports = { getConfig };
