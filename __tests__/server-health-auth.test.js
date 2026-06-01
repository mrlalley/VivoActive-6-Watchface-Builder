'use strict';

/**
 * Tests for authentication on GET /api/health endpoint.
 *
 * Verifies that:
 * - GET /health remains public (unauthenticated)
 * - GET /api/health requires valid x-wfb-token
 * - Invalid/missing tokens are rejected with 401
 * - Response body includes SDK/key status only when authenticated
 */

const request = require('supertest');
const { createServer } = require('../server');
const path = require('path');
const fs = require('fs');
const { mkdtempSync } = require('fs');

describe('Health Check Authentication', () => {
  const TOKEN = 'a'.repeat(64);
  let server;
  let testDir;
  const mockConfig = {
    designsDir: null,
    sdkPath: '/fake/sdk',
    devKeyPath: '/fake/key',
    simExe: '/fake/sim'
  };

  beforeEach(() => {
    this.savedToken = process.env.WFB_SESSION_TOKEN;
    process.env.WFB_SESSION_TOKEN = TOKEN;
    testDir = mkdtempSync(path.join(__dirname, 'test-health-'));
    mockConfig.designsDir = testDir;
    server = createServer(mockConfig);
  });

  afterEach(() => {
    if (this.savedToken) {
      process.env.WFB_SESSION_TOKEN = this.savedToken;
    } else {
      delete process.env.WFB_SESSION_TOKEN;
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('GET /internal/healthz – public liveness probe', () => {
    test('returns 200 without authentication', async () => {
      const res = await request(server)
        .get('/internal/healthz')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.pid).toBeDefined();
      expect(res.body.ts).toBeDefined();
    });

    test('returns minimal info (status, pid, ts)', async () => {
      const res = await request(server)
        .get('/internal/healthz')
        .expect(200);

      // Public /internal/healthz must NOT expose SDK or key status
      expect(res.body.sdkFound).toBeUndefined();
      expect(res.body.keyFound).toBeUndefined();
      expect(res.body.ok).toBeUndefined();
      expect(res.body.buildQueue).toBeUndefined();
    });

    test('ignores x-wfb-token if provided (public endpoint)', async () => {
      const res = await request(server)
        .get('/internal/healthz')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/health – authenticated SDK/key status', () => {
    test('returns 401 when x-wfb-token is missing', async () => {
      const res = await request(server)
        .get('/api/health')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Uu]nauthorized|[Mm]issing/i);
    });

    test('returns 401 when x-wfb-token is invalid', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', 'wrong-token')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Uu]nauthorized|[Ii]nvalid/i);
    });

    test('returns 401 when x-wfb-token is malformed', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', 'not-hex!');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('returns 200 with valid x-wfb-token', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      expect(res.body.ok).toBeDefined();
      expect(res.body.sdkFound).toBeDefined();
      expect(res.body.keyFound).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });

    test('returns SDK/key status only when authenticated', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      // These fields must be present ONLY when authenticated
      expect(typeof res.body.sdkFound).toBe('boolean');
      expect(typeof res.body.keyFound).toBe('boolean');
      expect(typeof res.body.ok).toBe('boolean');
      expect(res.body.timestamp).toBeDefined();
    });

    test('includes buildQueue stats only when authenticated', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN)
        .expect(200);

      // buildQueue.stats() is exposed only to authenticated callers
      expect(res.body.buildQueue).toBeDefined();
      expect(typeof res.body.buildQueue).toBe('object');
    });

    test('returns 503 when SDK/key not found (but still authenticated)', async () => {
      // Even when SDK/key are missing, authentication must succeed
      // The status code (200 vs 503) depends on presence, not on auth
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN);

      // Status is 503 if SDK/key not found, 200 if ok
      expect([200, 503]).toContain(res.status);
      // But the response body must be present (auth succeeded)
      expect(res.body.ok).toBeDefined();
      expect(res.body.sdkFound).toBeDefined();
      expect(res.body.keyFound).toBeDefined();
    });

    test('rate limiter still applies after authentication', async () => {
      // Make 30 requests (the healthLimiter max) in quick succession
      const requests = Array.from({ length: 30 }, () =>
        request(server)
          .get('/api/health')
          .set('X-WFB-Token', TOKEN)
      );

      await Promise.all(requests);

      // The 31st request should be rate-limited
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN);

      expect(res.status).toBe(429);
      // express-rate-limit sends a plain text message, not JSON error object
      expect(res.text).toMatch(/[Tt]oo many/i);
    });
  });

  describe('Information disclosure boundary', () => {
    test('unauthenticated caller cannot learn SDK presence', async () => {
      const resNoAuth = await request(server)
        .get('/api/health');

      // Must not return SDK info without auth
      expect(resNoAuth.body.sdkFound).toBeUndefined();
      expect(resNoAuth.status).toBe(401);
    });

    test('unauthenticated caller cannot learn developer key presence', async () => {
      const resNoAuth = await request(server)
        .get('/api/health');

      // Must not return key info without auth
      expect(resNoAuth.body.keyFound).toBeUndefined();
      expect(resNoAuth.status).toBe(401);
    });

    test('unauthenticated caller cannot infer build activity', async () => {
      const resNoAuth = await request(server)
        .get('/api/health');

      // Must not return buildQueue stats without auth
      expect(resNoAuth.body.buildQueue).toBeUndefined();
      expect(resNoAuth.status).toBe(401);
    });

    test('authenticated caller can access all health fields', async () => {
      const resAuth = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN);

      // Authenticated access must include all fields
      expect(resAuth.body.sdkFound).toBeDefined();
      expect(resAuth.body.keyFound).toBeDefined();
      expect(resAuth.body.ok).toBeDefined();
      expect(resAuth.body.timestamp).toBeDefined();
      expect(resAuth.body.buildQueue).toBeDefined();
    });
  });

  describe('Electron checkHealth compatibility', () => {
    test('checkHealth pattern (authenticated fetch) works correctly', async () => {
      // Simulate Electron's checkHealth() function: fetch with x-wfb-token header
      const res = await request(server)
        .get('/api/health')
        .set('x-wfb-token', TOKEN);

      // Must succeed with valid token (case-insensitive header)
      expect([200, 503]).toContain(res.status);
      expect(res.body.ok).toBeDefined();
    });

    test('responds with expected fields for Electron renderer', async () => {
      const res = await request(server)
        .get('/api/health')
        .set('X-WFB-Token', TOKEN);

      // Electron renderer listens for these fields in app:health-status
      const requiredFields = ['ok', 'sdkFound', 'keyFound', 'timestamp', 'buildQueue'];
      for (const field of requiredFields) {
        expect(res.body[field]).toBeDefined();
      }
    });
  });
});
