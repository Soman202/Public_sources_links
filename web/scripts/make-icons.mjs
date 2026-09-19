/** Generate the PWA icons the manifest points at, with no image dependency.
 *
 *  A home-screen icon has to be a real PNG (iOS will not take an SVG), and pulling in an
 *  image library to draw two flat squares with a mark on them is not worth it. So this
 *  writes the PNGs directly: raw scanlines, deflated, wrapped in the three chunks a PNG
 *  needs.
 *
 *  Run: node scripts/make-icons.mjs
 *  Replace public/icon-*.png with anything nicer whenever you like -- nothing reads them
 *  but the manifest.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const BACKGROUND = [0x11, 0x16, 0x1d];
const LINK = [0x4b, 0x9f, 0xff];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A rounded-square mark: three stacked bars, like the entries in a list. */
function pixel(x, y, size) {
  const unit = size / 16;
  const inside = (left, top, width, height) =>
    x >= left * unit && x < (left + width) * unit && y >= top * unit && y < (top + height) * unit;

  if (inside(3, 3.5, 10, 2)) return LINK;
  if (inside(3, 7, 7, 2)) return LINK;
  if (inside(3, 10.5, 9, 2)) return LINK;
  return BACKGROUND;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let at = 0;
  for (let y = 0; y < size; y += 1) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y, size);
      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(PUBLIC, { recursive: true });
for (const size of [192, 512]) {
  const file = join(PUBLIC, `icon-${size}.png`);
  writeFileSync(file, png(size));
  console.log(`wrote public/icon-${size}.png`);
}
