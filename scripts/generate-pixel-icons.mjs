/**
 * UI-00: Generate minimal valid pixel-art PNG icons (16 & 32) under public/icons/pixel/
 * Pure Node (zlib) — no external image deps.
 *
 * Fallback path when Grok image gen is rate-limited or returns non-alpha JPG.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons", "pixel");

// Dark UI accents (globals.css .dark)
const C = {
  _: null, // transparent
  g: [0xb0, 0x98, 0x70, 255], // accent gold
  c: [0xe8, 0xe4, 0xde, 255], // cream / text-primary
  m: [0x7a, 0x70, 0x60, 255], // muted
  s: [0x4a, 0xde, 0x80, 255], // success
  w: [0xfa, 0xcc, 0x15, 255], // warning
  e: [0xef, 0x44, 0x44, 255], // error
  b: [0x4a, 0x7f, 0xc4, 255], // executing blue
};

/**
 * Each glyph is 16 rows of 16 chars. Keys map to C above.
 * Space or `.` = transparent.
 */
const GLYPHS = {
  "nav-feed": [
    "................",
    "..gggggggggggg..",
    "..g..........g..",
    "..g..cccc....g..",
    "..g..........g..",
    "..gggggggggggg..",
    "................",
    "..gggggggggggg..",
    "..g..........g..",
    "..g..cccc....g..",
    "..g..........g..",
    "..gggggggggggg..",
    "................",
    "..gggggggggggg..",
    "..g..cccc....g..",
    "................",
  ],
  "nav-knowledge": [
    "................",
    "....mmmmmmmm....",
    "...mccccccccm...",
    "...mc......cm...",
    "...mc.gg...cm...",
    "...mc.gg...cm...",
    "...mc......cm...",
    "...mccccccccm...",
    "...mcc....ccm...",
    "...mc.c..c.cm...",
    "...mc..cc..cm...",
    "...mc.c..c.cm...",
    "...mccccccccm...",
    "....mmmmmmmm....",
    "................",
    "................",
  ],
  "nav-history": [
    "................",
    "......mmmm......",
    "....mmccccmm....",
    "...mc......cm...",
    "..mc...g....cm..",
    "..mc...g....cm..",
    "..mc...ggg..cm..",
    "..mc........cm..",
    "..mc........cm..",
    "..mc........cm..",
    "...mc......cm...",
    "....mmccccmm....",
    "......mmmm......",
    "....gg....gg....",
    "...g........g...",
    "................",
  ],
  "action-play": [
    "................",
    "................",
    "...gg...........",
    "...ggg..........",
    "...gggg.........",
    "...ggggg........",
    "...gggggg.......",
    "...ggggggg......",
    "...ggggggg......",
    "...gggggg.......",
    "...ggggg........",
    "...gggg.........",
    "...ggg..........",
    "...gg...........",
    "................",
    "................",
  ],
  "action-check": [
    "................",
    "................",
    "................",
    "............ss..",
    "...........ss...",
    "..........ss....",
    ".........ss.....",
    "..ss....ss......",
    "...ss..ss.......",
    "....ssss........",
    ".....ss.........",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  "action-x": [
    "................",
    "................",
    "..ee........ee..",
    "...ee......ee...",
    "....ee....ee....",
    ".....ee..ee.....",
    "......eeee......",
    ".......ee.......",
    "......eeee......",
    ".....ee..ee.....",
    "....ee....ee....",
    "...ee......ee...",
    "..ee........ee..",
    "................",
    "................",
    "................",
  ],
  "action-plus": [
    "................",
    "................",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    "..gggggggggggg..",
    "..gggggggggggg..",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    "................",
    "................",
  ],
  "plan-goal": [
    "................",
    ".......cc.......",
    "......cccc......",
    ".....ccggcc.....",
    "....ccg..gcc....",
    "...ccg....gcc...",
    "...ccg....gcc...",
    "....ccg..gcc....",
    ".....ccggcc.....",
    "......cccc......",
    ".......cc.......",
    ".......mm.......",
    ".......mm.......",
    "......mmmm......",
    ".....mmmmmm.....",
    "................",
  ],
  "plan-propose": [
    "................",
    "....bbbbbbbb....",
    "...bccccccccb...",
    "...bc......cb...",
    "...bc..gg..cb...",
    "...bc.g..g.cb...",
    "...bc..gg..cb...",
    "...bc......cb...",
    "...bccccccccb...",
    "....bbbb..bb....",
    "..........b.....",
    ".........b......",
    "........b.......",
    ".......b........",
    "................",
    "................",
  ],
  "plan-replan": [
    "................",
    ".....ggggg......",
    "....g.....g.....",
    "...g.......g....",
    "..g.........g...",
    "..g....gg...g...",
    ".......gg.......",
    "......gggg......",
    ".......gg.......",
    "..g...gg....g...",
    "..g.........g...",
    "...g.......g....",
    "....g.....g.....",
    ".....ggggg......",
    "................",
    "................",
  ],
  "plan-skip": [
    "................",
    "................",
    "..gg......gg....",
    "..ggg....ggg....",
    "..gggg..gggg....",
    "..gggggggggg....",
    "..gg.gggg.gg....",
    "..gg..gg..gg....",
    "..gg......gg....",
    "..gg......gg....",
    "..gg......gg....",
    "..gg......gg....",
    "................",
    "................",
    "................",
    "................",
  ],
  "plan-diagnose": [
    "................",
    "......cccc......",
    ".....cmmmmc.....",
    "....cm....mc....",
    "...cm......mc...",
    "...cm..gg..mc...",
    "...cm.g..g.mc...",
    "...cm..gg..mc...",
    "....cm....mc....",
    ".....cmmmmc.....",
    "......c..c......",
    ".......gg.......",
    ".......gg.......",
    "......gggg......",
    "................",
    "................",
  ],
  "session-lock": [
    "................",
    ".....mmmmmm.....",
    "....mm....mm....",
    "....m......m....",
    "....m......m....",
    "....m......m....",
    "...gggggggggg...",
    "...g........g...",
    "...g...cc...g...",
    "...g...cc...g...",
    "...g...cc...g...",
    "...g...mm...g...",
    "...g........g...",
    "...gggggggggg...",
    "................",
    "................",
  ],
  "session-open": [
    "................",
    ".....mmmmmm.....",
    "....mm....mm....",
    "....m......m....",
    "....m......m....",
    "...........m....",
    "...gggggggggg...",
    "...g........g...",
    "...g...cc...g...",
    "...g...cc...g...",
    "...g...cc...g...",
    "...g...mm...g...",
    "...g........g...",
    "...gggggggggg...",
    "................",
    "................",
  ],
  "session-done": [
    "................",
    "...ssssssssss...",
    "...s........s...",
    "...s........s...",
    "...s......ss.s..",
    "...s.....ss..s..",
    "...s..s.ss...s..",
    "...s..sss....s..",
    "...s...s.....s..",
    "...s........s...",
    "...s........s...",
    "...ssssssssss...",
    "................",
    "................",
    "................",
    "................",
  ],
  warn: [
    "................",
    ".......ww.......",
    "......wwww......",
    ".....ww..ww.....",
    "....ww.mm.ww....",
    "....ww.mm.ww....",
    "...ww..mm..ww...",
    "...ww..mm..ww...",
    "..ww...mm...ww..",
    "..ww........ww..",
    ".ww....mm....ww.",
    ".ww....mm....ww.",
    ".wwwwwwwwwwwwww.",
    "..wwwwwwwwwwww..",
    "................",
    "................",
  ],
  search: [
    "................",
    "....cccccc......",
    "...cc....cc.....",
    "..cc......cc....",
    "..c........c....",
    "..c........c....",
    "..cc......cc....",
    "...cc....cc.....",
    "....cccccc.gg...",
    "..........ggg...",
    ".........ggg....",
    "........ggg.....",
    ".......ggg......",
    "......gg........",
    "................",
    "................",
  ],
  upload: [
    "................",
    ".......gg.......",
    "......gggg......",
    ".....gggggg.....",
    "....gg.gg.gg....",
    "...gg..gg..gg...",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    ".......gg.......",
    "..mmmmmmmmmmmm..",
    "..m..........m..",
    "..m..........m..",
    "..mmmmmmmmmmmm..",
    "................",
    "................",
  ],
  send: [
    "................",
    "................",
    "..gggg..........",
    "..gggggg........",
    "..gg..gggg......",
    "..gg....gggg....",
    "..gg......gggg..",
    "..gg....gggg....",
    "..gg..gggg......",
    "..gggggg........",
    "..gggg..........",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  outline: [
    "................",
    "..cccccccccccc..",
    "..c..........c..",
    "..c.gg.......c..",
    "..c.gg.......c..",
    "..c..........c..",
    "..c.gggggg...c..",
    "..c..........c..",
    "..c.gggg.....c..",
    "..c..........c..",
    "..c.gggggg...c..",
    "..c..........c..",
    "..c.gg.......c..",
    "..c..........c..",
    "..cccccccccccc..",
    "................",
  ],
  sources: [
    "................",
    "..mmmm....mmmm..",
    "..mccm....mccm..",
    "..mccm....mccm..",
    "..mmmm....mmmm..",
    "................",
    "..mmmmmmmmmmmm..",
    "..mccccccccccm..",
    "..mc........cm..",
    "..mc.gg..gg.cm..",
    "..mc........cm..",
    "..mccccccccccm..",
    "..mmmmmmmmmmmm..",
    "................",
    "................",
    "................",
  ],
};

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
  // Filter byte 0 per scanline + RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // None filter
    const src = y * width * 4;
    rgba.copy(raw, rowStart + 1, src, src + width * 4);
  }
  const compressed = deflateSync(raw, { level: 9 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function glyphToRgba(rows, scale) {
  const n = 16;
  const size = n * scale;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < n; y++) {
    const row = rows[y] || ".".repeat(n);
    for (let x = 0; x < n; x++) {
      const ch = row[x] || ".";
      const color = ch === "." || ch === " " ? null : C[ch];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          const i = (py * size + px) * 4;
          if (color) {
            rgba[i] = color[0];
            rgba[i + 1] = color[1];
            rgba[i + 2] = color[2];
            rgba[i + 3] = color[3];
          } else {
            rgba[i] = 0;
            rgba[i + 1] = 0;
            rgba[i + 2] = 0;
            rgba[i + 3] = 0;
          }
        }
      }
    }
  }
  return { size, rgba };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const names = Object.keys(GLYPHS);
  let count = 0;
  for (const name of names) {
    const rows = GLYPHS[name];
    if (rows.length !== 16 || rows.some((r) => r.length !== 16)) {
      throw new Error(`Glyph ${name} must be 16x16`);
    }
    for (const scale of [1, 2]) {
      const { size, rgba } = glyphToRgba(rows, scale);
      const png = encodePngRGBA(size, size, rgba);
      const file = join(OUT, `${name}-${size}.png`);
      writeFileSync(file, png);
      count++;
      console.log(`wrote ${file} (${png.length} bytes)`);
    }
  }
  console.log(`\nDone: ${count} files for ${names.length} names -> ${OUT}`);
}

main();
