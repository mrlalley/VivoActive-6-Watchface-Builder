// Safe name generation for compiled binaries.

// PRG_NAME_MAX_LENGTH is a hard constraint from the Garmin watch filesystem.
// The .prg filename on-device must not exceed this length. Validation,
// truncation, and the UI prompt must all respect this limit. Do not increase
// without confirming the device filesystem supports longer filenames.
const PRG_NAME_MAX_LENGTH = 30;

function safePrgName(name) {
  return ((name || 'WatchFace')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, PRG_NAME_MAX_LENGTH)) || 'WatchFace';
}

module.exports = { safePrgName, PRG_NAME_MAX_LENGTH };
