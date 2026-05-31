'use strict';

/**
 * Regression tests for session token enforcement.
 *
 * Prior to this fix:
 * - requireSessionToken() passed all requests through when WFB_SESSION_TOKEN was absent
 * - The standalone startup block only warned instead of exiting
 *
 * After this fix (Option A):
 * - requireSessionToken() rejects with 401 when WFB_SESSION_TOKEN is absent
 * - The standalone startup block exits(1) with a clear error message
 *
 * Reference: server.js lines 111-139 (middleware) and 450-503 (standalone startup)
 */

const express = require('express');
const request = require('supertest');
const { createServer } = require('../server');
const path = require('path');
const fs = require('fs');

describe('[Option A] Session token enforcement', () => {
  // Use a valid 64-character hex string (32 bytes * 2 hex chars per byte)
  const TOKEN = 'a'.repeat(64);
  let server;
  const testDir = path.join(__dirname, 'test-designs-auth');
  const mockConfig = {
    designsDir: testDir,
    sdkPath: '/fake/sdk',
    devKeyPath: '/fake/key',
    simExe: '/fake/sim'
  };

  beforeEach(() => {
    // Save current env
    this.savedToken = process.env.WFB_SESSION_TOKEN;
  });

  afterEach(() => {
    // Restore env
    if (this.savedToken) {
      process.env.WFB_SESSION_TOKEN = this.savedToken;
    } else {
      delete process.env.WFB_SESSION_TOKEN;
    }

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('when WFB_SESSION_TOKEN is set', () => {
    beforeEach(() => {
      process.env.WFB_SESSION_TOKEN = TOKEN;
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
      server = createServer(mockConfig);
    });

    test('rejects request with no X-WFB-Token header — HTTP 401', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Uu]nauthorized/);
    });

    test('rejects request with wrong token — HTTP 401', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .set('X-WFB-Token', 'wrong-token-xyz')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Uu]nauthorized|[Ii]nvalid/);
    });

    test('passes request with correct X-WFB-Token header', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .set('X-WFB-Token', TOKEN);

      // Should not be 401 — the token is valid.
      // May be 400 or 404 (not found), but not 401.
      expect(res.status).not.toBe(401);
    });

    test('rejects request with malformed token — HTTP 401', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .set('X-WFB-Token', 'not-a-valid-hex-string!')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Uu]nauthorized|[Mm]alformed/);
    });
  });

  describe('when WFB_SESSION_TOKEN is absent (misconfigured)', () => {
    beforeEach(() => {
      delete process.env.WFB_SESSION_TOKEN;
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
      server = createServer(mockConfig);
    });

    test('rejects all requests with HTTP 401 — not 200', async () => {
      // Under Option A, absent token is a misconfiguration.
      // The server must reject all API requests, not silently accept them.
      const res = await request(server)
        .get('/api/export/check/test')
        .expect(401);

      expect(res.body.error).toBeDefined();
      expect(res.body.error).toMatch(/[Mm]isconfigured|not set/i);
      expect(res.body.hint).toBeDefined();
    });

    test('rejects even when X-WFB-Token header is provided (but token is not configured)', async () => {
      // If the server is misconfigured (no token), it should reject all requests
      // regardless of what header is sent.
      const res = await request(server)
        .get('/api/export/check/test')
        .set('X-WFB-Token', 'any-value')
        .expect(401);

      expect(res.body.error).toBeDefined();
    });

    test('includes helpful hint in error response', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .expect(401);

      expect(res.body.hint).toBeDefined();
      expect(res.body.hint).toMatch(/npm start|Electron/i);
    });

    test('returns HTTP 401, not 403', async () => {
      // 401 = unauthenticated (credentials required)
      // 403 = authenticated but not authorized
      // The correct status for missing token is 401.
      const res = await request(server)
        .get('/api/export/check/test');

      expect(res.status).toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('token enforcement applies to sensitive routes', () => {
    beforeEach(() => {
      process.env.WFB_SESSION_TOKEN = TOKEN;
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
      server = createServer(mockConfig);
    });

    test('GET /api/export/check requires token', async () => {
      const res = await request(server)
        .get('/api/export/check/test')
        .expect(401);

      expect(res.body.error).toBeDefined();
    });

    test('GET /api/designs requires token', async () => {
      const res = await request(server)
        .get('/api/designs')
        .expect(401);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('requireSessionToken', () => {
    // Focused regression tests: ensure the middleware enforces the token strictly.
    // Prior behavior: passed through when token was absent (dangerous).
    // Current behavior: rejects with 401 (correct).

    describe('no-token misconfiguration', () => {
      beforeEach(() => {
        delete process.env.WFB_SESSION_TOKEN;
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true });
        }
        fs.mkdirSync(testDir, { recursive: true });
        server = createServer(mockConfig);
      });

      it('returns 401 when expectedTokenBuf is null (no token configured)', async () => {
        // When WFB_SESSION_TOKEN is not set, expectedTokenBuf is null.
        // The middleware must reject the request, not pass through.
        const res = await request(server)
          .get('/api/designs')
          .expect(401);

        expect(res.body.error).toBeDefined();
        expect(res.body.error).toMatch(/[Mm]isconfigured|not set/i);
      });
    });

    describe('wrong-token rejection', () => {
      beforeEach(() => {
        process.env.WFB_SESSION_TOKEN = TOKEN;
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true });
        }
        fs.mkdirSync(testDir, { recursive: true });
        server = createServer(mockConfig);
      });

      it('returns 401 when Authorization header token does not match', async () => {
        // A provided token that doesn't match expectedTokenBuf must be rejected.
        // This prevents unauthorized requests even when a token is sent.
        const res = await request(server)
          .get('/api/designs')
          .set('X-WFB-Token', 'b'.repeat(64)) // Wrong token
          .expect(401);

        expect(res.body.error).toBeDefined();
        expect(res.body.error).toMatch(/[Uu]nauthorized|[Ii]nvalid/);
      });
    });
  });
});
