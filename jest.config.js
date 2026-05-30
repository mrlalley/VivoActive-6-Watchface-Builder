module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/index.js',
    '!node_modules/**',
  ],
  testMatch: ['**/__tests__/**/*.test.js', '**/*.spec.js'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
