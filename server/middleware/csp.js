// CSP middleware: per-request nonce generation and security header injection

const crypto = require('crypto');

function createCspMiddleware(log) {
  // Generate a random nonce for this request's inline scripts
  function generateNonce() {
    return crypto.randomBytes(16).toString('base64');
  }

  // CSP header injection middleware
  // Generates a new nonce per request and injects it into the CSP header
  function cspMiddleware(req, res, next) {
    const nonce = generateNonce();
    res.locals.nonce = nonce;

    // Content Security Policy header with per-request nonce
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'strict-dynamic' 'nonce-${nonce}';
      style-src 'self';
      img-src 'self' data:;
      font-src 'self';
      connect-src 'self';
      worker-src 'none';
      frame-src 'none';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
    `.replace(/\s+/g, ' ').trim();

    res.setHeader('Content-Security-Policy', cspHeader);
    next();
  }

  return {
    generateNonce,
    cspMiddleware,
  };
}

module.exports = { createCspMiddleware };
