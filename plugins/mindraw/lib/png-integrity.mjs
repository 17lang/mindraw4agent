import { inflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Canvas-exported, non-interlaced PNGs only. Fail closed on unsupported encodings.
export function validateCanvasPng(bytes, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || bytes.length < 57) throw new Error('Invalid PNG dimensions.');
  const idat = []; let offset = 8, header = false, ended = false, dataEnded = false, channels;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk.');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG data.');
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG checksum mismatch.');
    if (!header && type !== 'IHDR') throw new Error('PNG header missing.');
    if (type === 'IHDR') {
      if (header || length !== 13 || data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height || data[8] !== 8 || data[10] || data[11] || data[12]) throw new Error('Unsupported PNG header.');
      channels = ({0:1,2:3,4:2,6:4})[data[9]];
      if (!channels) throw new Error('Unsupported PNG color mode.');
      header = true;
    } else if (type === 'IDAT') {
      if (dataEnded) throw new Error('Nonconsecutive PNG image data.');
      idat.push(data);
    } else if (type === 'IEND') {
      if (length || !idat.length || end !== bytes.length) throw new Error('Invalid PNG ending.');
      ended = true; offset = end; break;
    } else {
      if (idat.length) dataEnded = true;
      if (type[0] === type[0].toUpperCase() && type !== 'PLTE') throw new Error('Unsupported critical PNG chunk.');
    }
    offset = end;
  }
  if (!ended) throw new Error('PNG ending missing.');
  const rowBytes = width * channels, expected = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(expected) || expected > 128 * 1024 * 1024) throw new Error('PNG decoded image too large.');
  const pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  if (pixels.length !== expected) throw new Error('Invalid PNG scanline length.');
  for (let y = 0; y < height; y++) if (pixels[y * (rowBytes + 1)] > 4) throw new Error('Invalid PNG scanline filter.');
}
