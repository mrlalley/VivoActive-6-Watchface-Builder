module.exports = {
  packagerConfig: {
    asar: false,
    name: 'WatchFace Builder',
  },

  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};
