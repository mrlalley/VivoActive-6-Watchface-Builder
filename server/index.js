// Server middleware and route exports
// This module encapsulates all middleware and route registration

const { createSecurityMiddleware } = require('./middleware/security');
const { createCspMiddleware } = require('./middleware/csp');
const { createRateLimiters } = require('./middleware/rateLimiters');
const { registerHealthRoutes } = require('./routes/health');
const { registerDesignRoutes } = require('./routes/designs');
const { registerExportRoutes } = require('./routes/export');
const { registerPreviewRoutes } = require('./routes/preview');
const { registerKeygenRoutes } = require('./routes/keygen');

module.exports = {
  createSecurityMiddleware,
  createCspMiddleware,
  createRateLimiters,
  registerHealthRoutes,
  registerDesignRoutes,
  registerExportRoutes,
  registerPreviewRoutes,
  registerKeygenRoutes,
};
