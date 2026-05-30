module.exports = {
  packagerConfig: {
    // Don't use asar (simpler, avoids archive path issues with launcher_icon.png)
    asar: false,

    // App metadata
    appVersion: '1.0.0',
    name: 'WatchFace Builder',
    appBundleId: 'com.garmin.watchfacebuilder',

    // Files to exclude from the packaged app
    ignore: [
      /^\/\.git$/,
      /^\/\.gitignore$/,
      /^\/\.claude$/,
      /^\/exported-garmin-project$/,
      /^\/minimal-test$/,
      /^\/\.env$/,
      /^\/.*\.log$/,
      /^\/forge\.config\.js$/,
      /^\/README\.md$/,
      /^\/Claude\.md$/,
      /^\/Claude\.md\.old$/,
      /^\/src$/,
      /^\/test$/,
    ],
  },

  makers: [
    {
      // Windows installer via Squirrel.Windows
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'WatchFace Builder',
        // Icon for the installer (optional — will skip if missing)
        // setupIcon: './assets/icon.ico',
        // certificateFile: process.env.CERTIFICATE_FILE,
        // certificatePassword: process.env.CERTIFICATE_PASSWORD,
      },
    },
    {
      // ZIP archive for distribution
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],

  // Configuration for building the app before packaging
  buildIdentifier: 'default',
};
