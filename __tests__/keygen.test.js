// Unit tests for lib/keygen.js
// Tests the validateKeyFile function with known-good and invalid inputs.
// Does NOT test generateKey (30-second runtime is unacceptable for unit tests).

const { getDefaultKeyPath, validateKeyFile } = require('../lib/keygen');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

describe('keygen', () => {
  describe('getDefaultKeyPath', () => {
    test('returns a path ending in .garmin/developer_key.der', () => {
      const keyPath = getDefaultKeyPath();
      expect(keyPath).toMatch(/.garmin[\\\/]developer_key\.der$/);
    });

    test('path starts with home directory', () => {
      const keyPath = getDefaultKeyPath();
      const homePath = os.homedir();
      expect(keyPath).toContain(homePath);
    });
  });

  describe('validateKeyFile', () => {
    test('returns invalid for non-existent file', () => {
      const result = validateKeyFile('/nonexistent/path/to/key.der');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not found|cannot/i);
    });

    test('returns invalid for empty buffer', () => {
      const tempFile = path.join(os.tmpdir(), 'test-empty.der');
      fs.writeFileSync(tempFile, Buffer.alloc(0));
      try {
        const result = validateKeyFile(tempFile);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/SEQUENCE|too small/i);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    test('returns invalid for wrong first byte', () => {
      const tempFile = path.join(os.tmpdir(), 'test-wrong-tag.der');
      const badBuffer = Buffer.from([0x31, 0x82, 0x09, 0x4a]); // 0x31 instead of 0x30
      fs.writeFileSync(tempFile, badBuffer);
      try {
        const result = validateKeyFile(tempFile);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/SEQUENCE/);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    test('returns invalid for file too small', () => {
      const tempFile = path.join(os.tmpdir(), 'test-too-small.der');
      const smallBuffer = Buffer.from([0x30, 0x10]); // valid tag but only 2 bytes
      fs.writeFileSync(tempFile, smallBuffer);
      try {
        const result = validateKeyFile(tempFile);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/too small/i);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    test('returns invalid for missing RSA OID', () => {
      const tempFile = path.join(os.tmpdir(), 'test-no-oid.der');
      // Create a buffer with valid SEQUENCE tag and sufficient size, but no RSA OID
      const buffer = Buffer.alloc(600);
      buffer[0] = 0x30;
      buffer[1] = 0x82;
      buffer[2] = 0x02;
      buffer[3] = 0x58;
      // Don't set the RSA OID at offset 9 — leave it as 0x00
      fs.writeFileSync(tempFile, buffer);
      try {
        const result = validateKeyFile(tempFile);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/OID|RSA/);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    test('returns valid for buffer with correct ASN.1 header and RSA OID', () => {
      const tempFile = path.join(os.tmpdir(), 'test-valid.der');
      // Build a minimal valid PKCS#8 DER structure with RSA OID
      const buffer = Buffer.alloc(600);
      buffer[0] = 0x30; // SEQUENCE tag
      buffer[1] = 0x82;
      buffer[2] = 0x02;
      buffer[3] = 0x58; // length
      // Set RSA OID at offset 9: 06 09 2a 86 48 86 f7 0d 01 01 01
      const rsaOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
      rsaOid.copy(buffer, 9);
      fs.writeFileSync(tempFile, buffer);
      try {
        const result = validateKeyFile(tempFile);
        expect(result.valid).toBe(true);
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    test('returns valid for a real generated 4096-bit key', (done) => {
      // Generate a real RSA-4096 key and validate it
      crypto.generateKeyPair(
        'rsa',
        {
          modulusLength: 4096,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'der' },
        },
        (err, publicKey, privateKey) => {
          if (err) {
            done(err);
            return;
          }

          const tempFile = path.join(os.tmpdir(), 'test-real-key.der');
          fs.writeFileSync(tempFile, privateKey);
          try {
            const result = validateKeyFile(tempFile);
            expect(result.valid).toBe(true);
            done();
          } finally {
            fs.unlinkSync(tempFile);
          }
        }
      );
    }, 60000); // 60-second timeout for key generation
  });
});
