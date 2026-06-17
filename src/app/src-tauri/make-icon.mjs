// Generates a plain 1024x1024 PNG to use as the app icon source.
//
// Tauri needs real icon files to build. Rather than ship a binary blob in the
// repo, we generate a simple solid-color PNG here, then `tauri icon` turns it
// into all the platform-specific sizes/formats. Run via: npm run app:icons
//
// Encodes a minimal valid PNG (RGBA, no compression filters) by hand using
// node:zlib. You never need to touch this for the app itself — it just
// satisfies the build. Replace icons later with `tauri icon your-logo.png`.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZE = 1024;
const COLOR = [255, 206, 77, 255]; // the app's accent yellow, opaque

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
// bytes 10-12 default to 0 (compression, filter, interlace)

// Raw image: each row starts with a filter byte (0), then SIZE RGBA pixels.
const rowLen = 1 + SIZE * 4;
const raw = Buffer.alloc(rowLen * SIZE);
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * rowLen;
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const px = rowStart + 1 + x * 4;
    raw[px] = COLOR[0];
    raw[px + 1] = COLOR[1];
    raw[px + 2] = COLOR[2];
    raw[px + 3] = COLOR[3];
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "app-icon.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
