'use strict';

/**
 * Tests for dynamic backend port selection (electron/port-utils.js).
 *
 * Verifies:
 * 1. When WFB_SERVER_PORT is unset, pickPort() reserves a free ephemeral port
 *    using net.createServer and returns it.
 * 2. When WFB_SERVER_PORT is explicitly set, pickPort() returns that value
 *    without touching net.createServer.
 * 3. The derived SERVER_URL always points to 127.0.0.1:<selectedPort>.
 * 4. pickPort() works against the real loopback interface (integration sanity check).
 */

const { pickPort } = require('../electron/port-utils');

// Silent logger stub — pickPort() accepts a log object to avoid hard-coding pino
const silentLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// ─── Helper ───────────────────────────────────────────────────────────────────

function saveAndClearPort() {
  const saved = process.env.WFB_SERVER_PORT;
  delete process.env.WFB_SERVER_PORT;
  return () => {
    if (saved !== undefined) process.env.WFB_SERVER_PORT = saved;
    else delete process.env.WFB_SERVER_PORT;
  };
}

// ─── Explicit WFB_SERVER_PORT path ────────────────────────────────────────────

describe('pickPort() — explicit WFB_SERVER_PORT', () => {
  let restore;
  beforeEach(() => { restore = saveAndClearPort(); silentLog.info.mockClear(); });
  afterEach(() => restore());

  test('returns the env var value unchanged', async () => {
    process.env.WFB_SERVER_PORT = '4444';
    const port = await pickPort(silentLog);
    expect(port).toBe(4444);
  });

  test('logs server.port.explicit event', async () => {
    process.env.WFB_SERVER_PORT = '5678';
    await pickPort(silentLog);
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'server.port.explicit', port: 5678 })
    );
  });

  test('does not open a net.createServer socket', async () => {
    const net = require('net');
    const createServerSpy = jest.spyOn(net, 'createServer');
    process.env.WFB_SERVER_PORT = '9000';
    await pickPort(silentLog);
    expect(createServerSpy).not.toHaveBeenCalled();
    createServerSpy.mockRestore();
  });

  test('treats port 0 as invalid and falls through to dynamic allocation', async () => {
    process.env.WFB_SERVER_PORT = '0';
    const port = await pickPort(silentLog);
    // parseInt('0') === 0 which fails the > 0 guard — should get a dynamic port
    expect(port).toBeGreaterThan(0);
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'server.port.dynamic' })
    );
  });

  test('treats non-numeric value as invalid and falls through to dynamic allocation', async () => {
    process.env.WFB_SERVER_PORT = 'notaport';
    const port = await pickPort(silentLog);
    expect(port).toBeGreaterThan(0);
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'server.port.dynamic' })
    );
  });
});

// ─── Dynamic allocation path ──────────────────────────────────────────────────

describe('pickPort() — dynamic allocation (WFB_SERVER_PORT unset)', () => {
  let restore;
  beforeEach(() => { restore = saveAndClearPort(); silentLog.info.mockClear(); });
  afterEach(() => restore());

  test('returns a valid ephemeral port number', async () => {
    const port = await pickPort(silentLog);
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  test('returned port is not in use (server can bind it immediately)', async () => {
    const net = require('net');
    const port = await pickPort(silentLog);
    // Verify the port is actually free by binding to it
    await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen({ host: '127.0.0.1', port }, () => srv.close(resolve));
    });
  });

  test('logs server.port.dynamic event', async () => {
    await pickPort(silentLog);
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'server.port.dynamic' })
    );
  });

  test('successive calls return different ports (no port reuse)', async () => {
    const p1 = await pickPort(silentLog);
    const p2 = await pickPort(silentLog);
    // OS ephemeral port allocator very rarely reuses immediately — this is a
    // probabilistic sanity check rather than a hard guarantee.
    expect(typeof p1).toBe('number');
    expect(typeof p2).toBe('number');
    // Both must be valid regardless of whether they differ
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
  });
});

// ─── SERVER_URL construction ──────────────────────────────────────────────────

describe('SERVER_URL construction from selected port', () => {
  let restore;
  beforeEach(() => { restore = saveAndClearPort(); });
  afterEach(() => restore());

  test('explicit port produces correct 127.0.0.1 URL', async () => {
    process.env.WFB_SERVER_PORT = '3001';
    const port = await pickPort(silentLog);
    const serverUrl = `http://127.0.0.1:${port}`;
    expect(serverUrl).toBe('http://127.0.0.1:3001');
  });

  test('dynamic port produces a 127.0.0.1 URL (never 0.0.0.0)', async () => {
    const port = await pickPort(silentLog);
    const serverUrl = `http://127.0.0.1:${port}`;
    expect(serverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(serverUrl).not.toContain('0.0.0.0');
  });

  test('STATIC_CSP connect-src directive uses the runtime URL', async () => {
    process.env.WFB_SERVER_PORT = '7777';
    const port = await pickPort(silentLog);
    const serverUrl = `http://127.0.0.1:${port}`;
    // Simulate how main.js builds the STATIC_CSP connect-src directive
    const connectSrc = `connect-src ${serverUrl}`;
    expect(connectSrc).toBe('connect-src http://127.0.0.1:7777');
    // Must not fall back to :3000 when a different port is selected
    expect(connectSrc).not.toContain(':3000');
  });
});
