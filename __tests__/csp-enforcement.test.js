'use strict';

/**
 * CSP enforcement tests verify that:
 * 1. The server sends a strong CSP header with nonce on each request
 * 2. The Electron session handler's STATIC_CSP fallback is properly restrictive
 * 3. connect-src is limited to the local server only, blocking external origins
 */

const request = require('supertest');
const { createServer } = require('../server');
const path = require('path');
const fs = require('fs');

describe('Content Security Policy Enforcement', () => {
  const TOKEN = 'a'.repeat(64);
  let server;
  const testDir = path.join(__dirname, 'test-csp');
  const mockConfig = {
    designsDir: testDir,
    sdkPath: '/fake/sdk',
    devKeyPath: '/fake/key',
    simExe: '/fake/sim'
  };

  beforeEach(() => {
    this.savedToken = process.env.WFB_SESSION_TOKEN;
    process.env.WFB_SESSION_TOKEN = TOKEN;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
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

  describe('Server CSP Header', () => {
    test('every route response includes a CSP header with nonce', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      expect(res.headers['content-security-policy']).toBeDefined();
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain('script-src');
      expect(csp).toContain('nonce-');
    });

    test('CSP header includes nonce for inline scripts', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      // Extract the nonce: script-src 'self' 'strict-dynamic' 'nonce-xxxxx'
      // nonce is base64 (crypto.randomBytes(16)) — may contain +, /, and =
      const nonceMatch = csp.match(/nonce-([A-Za-z0-9+/=]+)/);
      expect(nonceMatch).toBeTruthy();
      expect(nonceMatch[1].length).toBeGreaterThan(10); // sanity check nonce length
    });

    test('CSP header restricts connect-src to self only', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/connect-src\s+'self'/);
      // Verify no external URLs in connect-src
      expect(csp).not.toMatch(/connect-src\s+.*https?:\/\//);
    });

    test('CSP header blocks frame-ancestors (cannot be embedded)', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("frame-ancestors 'none'");
    });

    test('CSP header blocks plugins and objects', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("worker-src 'none'");
    });

    test('CSP header blocks form submissions to external origins', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/form-action\s+'self'/);
    });

    test('CSP enforces strict-dynamic for scripts', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("'strict-dynamic'");
    });
  });

  describe('CSP Structure', () => {
    test('connect-src is explicitly limited and does not use wildcards', async () => {
      // This test verifies the code structure by checking that the CSP header
      // does not contain permissive patterns like "*", "https:", or "wss:"
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      const connectMatch = csp.match(/connect-src\s+([^;]+)/);
      expect(connectMatch).toBeTruthy();

      const connectValue = connectMatch[1];
      // Should be exactly 'self' and nothing else (no wildcards, no schemes)
      expect(connectValue).toBe("'self'");
      expect(connectValue).not.toContain('*');
      expect(connectValue).not.toContain('https:');
      expect(connectValue).not.toContain('wss:');
    });

    test('default-src is set to self (server) or none (fallback STATIC_CSP)', async () => {
      // The server.js CSP uses default-src 'self' for same-origin requests.
      // The Electron STATIC_CSP fallback uses default-src 'none' for strictness.
      // Both are acceptable for defense-in-depth.
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/default-src\s+'self'/);
    });

    test('script-src includes both self and strict-dynamic', async () => {
      const res = await request(server)
        .get('/')
        .expect(200);

      const csp = res.headers['content-security-policy'];
      const scriptMatch = csp.match(/script-src\s+([^;]+)/);
      expect(scriptMatch).toBeTruthy();

      const scriptValue = scriptMatch[1];
      expect(scriptValue).toContain("'self'");
      expect(scriptValue).toContain("'strict-dynamic'");
    });
  });

  describe('CSP Fallback Layer (Electron STATIC_CSP contract)', () => {
    test('should document that STATIC_CSP is used as Electron fallback', () => {
      // This test verifies the code contains the right comments about STATIC_CSP
      const fs = require('fs');
      const mainJs = fs.readFileSync(
        path.join(__dirname, '../electron/main.js'),
        'utf8'
      );

      // Check for defense-in-depth comment
      expect(mainJs).toContain('defense-in-depth');

      // Check for connect-src restriction comment
      expect(mainJs).toContain('ONLY the runtime-selected local server');
      expect(mainJs).toContain('STATIC_CSP');
    });

    test('STATIC_CSP in electron/main.js must not allow external origins', () => {
      const fs = require('fs');
      const mainJs = fs.readFileSync(
        path.join(__dirname, '../electron/main.js'),
        'utf8'
      );

      // Extract STATIC_CSP definition
      const cspMatch = mainJs.match(/const STATIC_CSP = \[([\s\S]*?)\]\.join/);
      expect(cspMatch).toBeTruthy();

      const cspContent = cspMatch[1];

      // Verify no wildcards in connect-src
      expect(cspContent).not.toMatch(/connect-src.*\*/);

      // Verify no permissive https: or wss: schemes
      expect(cspContent).not.toMatch(/connect-src\s+.*(?:https:|wss:)/);
    });
  });

  describe('CSP Header Preservation', () => {
    test('session handler only injects fallback when no CSP is present', () => {
      // This test documents the expected behavior in electron/main.js
      const fs = require('fs');
      const mainJs = fs.readFileSync(
        path.join(__dirname, '../electron/main.js'),
        'utf8'
      );

      // Verify the check for existing CSP before injection
      expect(mainJs).toContain("!headers['content-security-policy']");
      expect(mainJs).toContain("!headers['Content-Security-Policy']");

      // Verify the comment about preservation
      expect(mainJs).toContain('PRESERVES');
    });
  });

  describe('CSP and CLAUDE.md Contract', () => {
    test('CLAUDE.md documents the strict connect-src contract', () => {
      const fs = require('fs');
      const claudeMd = fs.readFileSync(
        path.join(__dirname, '../CLAUDE.md'),
        'utf8'
      );

      // Verify documentation about connect-src restriction
      expect(claudeMd).toContain('connect-src');
      expect(claudeMd).toContain('local server only');
      expect(claudeMd).toContain('defense-in-depth');
      expect(claudeMd).toContain('STATIC_CSP');
    });

    test('CLAUDE.md warns against adding external origins without justification', () => {
      const fs = require('fs');
      const claudeMd = fs.readFileSync(
        path.join(__dirname, '../CLAUDE.md'),
        'utf8'
      );

      expect(claudeMd).toContain('Do not');
      expect(claudeMd).toContain('external');
      expect(claudeMd).toContain('two-layer requirement');
    });
  });
});
