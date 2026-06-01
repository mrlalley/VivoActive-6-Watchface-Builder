// Server middleware and middleware factory exports
// This module encapsulates all middleware creation and composition

const { createSecurityMiddleware } = require('./middleware/security');
const { createCspMiddleware } = require('./middleware/csp');
const { createRateLimiters } = require('./middleware/rateLimiters');
const { registerHealthRoutes } = require('./routes/health');

module.exports = {
  createSecurityMiddleware,
  createCspMiddleware,
  createRateLimiters,
  registerHealthRoutes,
};
