/**
 * Electron Forge Configuration
 *
 * Primary packaging entrypoint for building WatchFace Builder desktop distributables.
 * Forge is Electron's recommended packaging and distribution solution [web:24][web:46][web:62].
 *
 * This config defines:
 * - packagerConfig: Base app bundling options
 * - makers: Platform-specific installer generators (Windows, macOS, Linux)
 * - publishers: Distribution targets (deferred until Phase 3)
 *
 * For unsigned local builds and smoke testing, all signing and notarization values
 * are intentionally null or false. Post-MVP, these will be populated via CI secrets.
 */

module.exports = {
  packagerConfig: {
    name: 'WatchFace Builder',
    executableName: 'watchface-builder',
    icon: './assets/icon',
    asar: true,
  },

  makers: [
    // Windows: ZIP (simplest, unsigned)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    // macOS: ZIP (unsigned; DMG deferred to post-MVP)
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    // Linux: DEB package
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
    },
    // Linux: RPM package
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
    },
  ],

  publishers: [],
};
