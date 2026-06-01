'use strict';

// AOD (Always-On Display) background image generator.
// Produces a luminance-reduced variant of a PNG for use in AOD mode.
// Supports 8-bit RGB PNGs (the only format our background pipeline produces).
// No external dependencies — uses Node.js built-in zlib.

const zlib = require('zlib');

// ─── PNG chunk helpers ────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const tb  = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcb = Buffer.alloc(4);
  crcb.writeUInt32BE(crc32(Buffer.concat([tb, data])) >>> 0, 0);
  return Buffer.concat([len, tb, data, crcb]);
}

// Parse all chunks from a PNG buffer. Skips the 8-byte signature.
function readChunks(buf) {
  const PNG_SIG_LEN = 8;
  if (buf.length < PNG_SIG_LEN) throw new Error('Buffer too short for PNG signature');
  const sig = buf.slice(0, PNG_SIG_LEN);
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Not a valid PNG (bad signature)');
  }
  let pos = PNG_SIG_LEN;
  const chunks = [];
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type   = buf.slice(pos + 4, pos + 8).toString('ascii');
    const data   = buf.slice(pos + 8, pos + 8 + length);
    chunks.push({ type, data });
    pos += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

// ─── PNG filter types (defiltering) ──────────────────────────────────────────
// Reconstruct the original raw pixel values from a filtered+compressed scanline stream.
// Only supports RGB (color type 2), 8 bits per channel.

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function defilterScanlines(rawData, width, height) {
  const bpp    = 3; // bytes per pixel — RGB
  const stride = 1 + width * bpp; // filter byte + pixel bytes per row
  const pixels = Buffer.alloc(height * width * bpp);

  for (let y = 0; y < height; y++) {
    const ft  = rawData[y * stride]; // filter type
    const ro  = y * stride + 1;     // row byte offset in rawData
    const po  = y * width * bpp;    // pixel byte offset in output

    for (let x = 0; x < width * bpp; x++) {
      const filt  = rawData[ro + x];
      const left  = x >= bpp ? pixels[po + x - bpp] : 0;
      const up    = y > 0    ? pixels[(y - 1) * width * bpp + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? pixels[(y - 1) * width * bpp + x - bpp] : 0;

      let raw;
      switch (ft) {
        case 0: raw = filt; break;
        case 1: raw = (filt + left)                           & 0xFF; break;
        case 2: raw = (filt + up)                             & 0xFF; break;
        case 3: raw = (filt + Math.floor((left + up) / 2))   & 0xFF; break;
        case 4: raw = (filt + paeth(left, up, upLeft))        & 0xFF; break;
        default: throw new Error(`Unknown PNG filter type ${ft} at row ${y}`);
      }
      pixels[po + x] = raw;
    }
  }

  return pixels;
}

// Re-encode raw pixel buffer as filter-0 scanlines and deflate.
function buildImageData(pixels, width, height) {
  const bpp       = 3;
  const scanlines = Buffer.alloc(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * bpp)] = 0; // filter type 0 (None)
    pixels.copy(
      scanlines,
      y * (1 + width * bpp) + 1,
      y * width * bpp,
      (y + 1) * width * bpp,
    );
  }
  return zlib.deflateSync(scanlines);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Produce a luminance-reduced copy of a PNG for use in AOD (always-on display) mode.
 *
 * Only supports 8-bit RGB PNGs (color type 2). Alpha channel (RGBA) is not supported.
 *
 * @param {Buffer} pngBuffer  - Input PNG buffer
 * @param {number} [factor=0.25] - Luminance factor: 0 = black, 1 = unchanged, 0.25 = 25%
 * @returns {Buffer} Dimmed PNG buffer
 * @throws {Error} on unsupported PNG format
 */
function dimBackground(pngBuffer, factor = 0.25) {
  const chunks = readChunks(pngBuffer);

  const ihdrChunk = chunks.find(c => c.type === 'IHDR');
  if (!ihdrChunk) throw new Error('PNG missing IHDR chunk');

  const width     = ihdrChunk.data.readUInt32BE(0);
  const height    = ihdrChunk.data.readUInt32BE(4);
  const bitDepth  = ihdrChunk.data[8];
  const colorType = ihdrChunk.data[9];

  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(
      `dimBackground requires 8-bit RGB PNG (colorType=2). ` +
      `Got bitDepth=${bitDepth}, colorType=${colorType}.`
    );
  }

  // Concatenate all IDAT chunk data before inflating (multi-IDAT PNGs are valid)
  const idatData = Buffer.concat(
    chunks.filter(c => c.type === 'IDAT').map(c => c.data)
  );
  if (idatData.length === 0) throw new Error('PNG missing IDAT data');

  const rawData = zlib.inflateSync(idatData);
  const pixels  = defilterScanlines(rawData, width, height);

  // Apply luminance reduction: clamp to [0, 1] to guard against bad input
  const f = Math.max(0, Math.min(1, factor));
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.round(pixels[i] * f);
  }

  const compressedData = buildImageData(pixels, width, height);
  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdrChunk.data),
    makeChunk('IDAT', compressedData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { dimBackground };
