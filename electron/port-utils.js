'use strict';

// Backend port selection for Electron startup.
// Extracted from main.js so it can be unit-tested without requiring the full
// Electron environment and all of main.js's side-effects.

const net = require('net');

/**
 * Resolve the port that server.js should bind on.
 *
 * - If WFB_SERVER_PORT is set in the environment, parse and return it unchanged.
 *   This preserves the existing behaviour for test isolation and controlled launches.
 * - Otherwise, bind a temporary TCP server to 127.0.0.1:0, read the OS-assigned
 *   ephemeral port, close the reservation, and return the number. server.js will
 *   bind that same port a moment later. The window between release and rebind is
 *   negligible on the loopback interface but non-zero — acceptable trade-off over
 *   a fixed port that cannot tolerate any collision.
 *
 * @param {import('pino').Logger} log
 * @returns {Promise<number>}
 */
async function pickPort(log) {
  const explicit = parseInt(process.env.WFB_SERVER_PORT, 10);
  if (!isNaN(explicit) && explicit > 0) {
    log.info({ event: 'server.port.explicit', port: explicit });
    return explicit;
  }

  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ host: '127.0.0.1', port: 0 }, () => {
      const { port } = srv.address();
      srv.close(() => {
        log.info({ event: 'server.port.dynamic', port });
        resolve(port);
      });
    });
  });
}

module.exports = { pickPort };
