// Monkey C Developer Key Generation
// Generates 4096-bit RSA PKCS#8 DER keys without external OpenSSL dependency.
// Uses Node.js built-in crypto module.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Returns the canonical default path for the developer key file.
// Matches the VS Code Monkey C extension's default location.
function getDefaultKeyPath() {
  return path.join(os.homedir(), '.garmin', 'developer_key.der');
}

// Generates a 4096-bit RSA private key in PKCS#8 DER format and writes it to outputPath.
// Creates parent directory if needed (idempotent).
// Sets file permissions to 0o600 (owner read/write only).
// Note: mode 0o600 has no effect on Windows; file inherits directory ACLs instead.
//
// @param {string} outputPath - Absolute path to write the .der file to
// @returns {Promise<{success: true, path: string}>} - Resolves on success
// @throws {Error} - User-displayable error message on failure
function generateKey(outputPath) {
  return new Promise((resolve, reject) => {
    // Resolve to absolute path
    const absPath = path.resolve(outputPath);
    const parentDir = path.dirname(absPath);

    // Create parent directory if needed
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch (err) {
      if (err.code === 'EACCES') {
        reject(new Error(`Cannot create directory: ${parentDir} — check permissions`));
      } else {
        reject(new Error(`Cannot create directory: ${err.message}`));
      }
      return;
    }

    // Check if outputPath is a directory (not a file path)
    try {
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        reject(new Error('Output path is a directory, not a file'));
        return;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        reject(new Error(`Cannot access output path: ${err.message}`));
        return;
      }
      // File doesn't exist yet — this is expected
    }

    // Generate RSA-4096 key in PKCS#8 DER format
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'der',
        },
      },
      (err, publicKey, privateKey) => {
        if (err) {
          reject(new Error(`Key generation failed: ${err.message}`));
          return;
        }

        // privateKey is a Buffer in PKCS#8 DER format — exactly what monkeyc expects
        try {
          fs.writeFileSync(absPath, privateKey, { mode: 0o600 });
        } catch (writeErr) {
          if (writeErr.code === 'EACCES') {
            reject(new Error(`Cannot write to ${absPath} — check permissions`));
          } else {
            reject(new Error(`Write failed: ${writeErr.message}`));
          }
          return;
        }

        // Validate the file we just wrote
        const validation = validateKeyFile(absPath);
        if (!validation.valid) {
          reject(new Error(`Key written but validation failed: ${validation.reason}`));
          return;
        }

        resolve({ success: true, path: absPath });
      }
    );
  });
}

// Validates that a file is a plausible PKCS#8 DER RSA private key without doing crypto math.
// Checks only the ASN.1 binary envelope: SEQUENCE tag, key size, RSA OID.
//
// @param {string} filePath - Path to the .der file
// @returns {{valid: true} | {valid: false, reason: string}}
function validateKeyFile(filePath) {
  // Check file exists
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: 'File not found' };
  }

  // Read file
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return { valid: false, reason: `Cannot read file: ${err.message}` };
  }

  // DER SEQUENCE outer tag (0x30)
  if (buffer.length < 2 || buffer[0] !== 0x30) {
    return { valid: false, reason: 'Not a valid DER SEQUENCE' };
  }

  // Minimum file size for a real 4096-bit key DER (typically ~2374 bytes).
  // Accept >= 512 bytes to allow smaller test keys during development.
  if (buffer.length < 512) {
    return { valid: false, reason: 'File too small to be a valid RSA key' };
  }

  // RSA OID in PKCS#8 structure: located at offset 9–18 as
  // 06 09 2a 86 48 86 f7 0d 01 01 01
  // This is the DER encoding of OID 1.2.840.113549.1.1.1 (RSA encryption algorithm)
  const rsaOidStart = 9;
  const rsaOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);

  if (buffer.length < rsaOidStart + rsaOid.length) {
    return { valid: false, reason: 'File too short to contain algorithm OID' };
  }

  const fileOid = buffer.slice(rsaOidStart, rsaOidStart + rsaOid.length);
  if (!fileOid.equals(rsaOid)) {
    return { valid: false, reason: 'Missing RSA OID — not an RSA key or invalid format' };
  }

  return { valid: true };
}

module.exports = {
  getDefaultKeyPath,
  generateKey,
  validateKeyFile,
};
