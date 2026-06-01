// Rate limiter middleware: factories for express-rate-limit instances

const rateLimit = require('express-rate-limit');

function createRateLimiters() {
  // Limiter for trivial, fast routes (health checks, key existence checks)
  // 30 requests per 60 seconds
  const healthLimiter = rateLimit({
    windowMs: 60 * 1000,     // 60 seconds
    max: 30,                 // limit each IP to 30 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: false,  // return rate limit info in the RateLimit-* headers
    legacyHeaders: false,    // disable the X-RateLimit-* headers
  });

  // Limiter for filesystem reads (design load/list, design existence check)
  // 30 requests per 60 seconds
  const loadDesignLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many design load requests, please try again later.',
    standardHeaders: false,
    legacyHeaders: false,
  });

  // Limiter for CPU/disk-heavy operations (export, preview, key generation, save-design)
  // 10 requests per 60 seconds
  const buildLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many build/export requests, please try again later.',
    standardHeaders: false,
    legacyHeaders: false,
  });

  return {
    healthLimiter,
    loadDesignLimiter,
    buildLimiter,
  };
}

module.exports = { createRateLimiters };
