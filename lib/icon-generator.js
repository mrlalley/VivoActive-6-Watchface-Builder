const zlib = require('zlib');

// Generate a 54x54 PNG with solid blue background (matching the current icon style)
function generate54x54Icon() {
  const width = 54;
  const height = 54;
  const blue_r = 0;
  const blue_g = 0x88;
  const blue_b = 0xcc;

  // Build the raw image data (PNG scanlines with filter bytes)
  const imageData = Buffer.alloc(height * (1 + width * 3)); // RGB, 1 filter byte per row
  let offset = 0;

  for (let y = 0; y < height; y++) {
    imageData[offset++] = 0; // filter type 0 (None) for this scanline
    for (let x = 0; x < width; x++) {
      imageData[offset++] = blue_r;
      imageData[offset++] = blue_g;
      imageData[offset++] = blue_b;
    }
  }

  const compressedData = zlib.deflateSync(imageData);

  // Build PNG chunks
  const chunks = [];

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type (RGB, not RGBA)
  ihdr[10] = 0;   // compression method
  ihdr[11] = 0;   // filter method
  ihdr[12] = 0;   // interlace method
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT chunk
  chunks.push(makeChunk('IDAT', compressedData));

  // IEND chunk
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  // Assemble: PNG signature + chunks
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    ...chunks
  ]);

  return png;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcData = Buffer.concat([typeBytes, data]);
  const crc = computeCrc32(crcData);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBytes, data, crcBytes]);
}

function computeCrc32(data) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { generate54x54Icon };
