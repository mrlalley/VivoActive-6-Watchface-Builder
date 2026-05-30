// Safe name generation for compiled binaries.

function safePrgName(name) {
  return ((name || 'WatchFace')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 30)) || 'WatchFace';
}

module.exports = { safePrgName };
