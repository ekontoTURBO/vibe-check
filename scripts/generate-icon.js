#!/usr/bin/env node
/**
 * Generates media/icon.png — the Vibe Check Marketplace logo.
 * Renders Glitch in the WIN mood (star eyes + grin) using the
 * mascot composition system (18 rows x 16 cols).
 *
 * Pure Node, no new deps. Run with `node scripts/generate-icon.js`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PALETTE = {
	'.': null,
	'0': [26, 26, 26],
	'1': [255, 119, 184],
	'2': [200, 77, 142],
	'3': [255, 255, 255],
	'4': [26, 26, 26],
	'5': [255, 210, 63],
	'6': [78, 201, 255],
	'7': [10, 10, 10],
	'8': [111, 220, 122],
	'9': [255, 90, 106],
	a: [255, 179, 212],
	b: [43, 127, 168],
	c: [122, 40, 81],
};

const GLITCH_BASE = `
.......55.......
.......55.......
.......00.......
......0550......
.000000000000...
.0aaaaaaaaaa0c..
.0066666666600c.
.0066666666600c7
.0066666666600c.
.0066666666600c7
.0066666666600c.
.0066666666600c7
.0a1111111112c7.
.0111111111112c.
.0c1111111111c7.
.0cccccccccccc7.
..7777777777777.
.7..............
`;

// Eye overlay 8x6, painted into rows 6-11 cols 4-11
const EYES_STAR = ['...55...', '..5555..', '.555555.', '.555555.', '..5555..', '...55...'];
// Mouth overlay 8x2, painted into rows 13-14 cols 4-11
const MOUTH_GRIN = ['.000000.', '.000000.'];
// Antenna LED palette key (row 3 cols 7-8) — gold for the win mood.
const ANTENNA = '5';

function composeWin() {
	const rows = GLITCH_BASE.trim().split('\n').map((r) => r.split(''));
	rows[3][7] = ANTENNA;
	rows[3][8] = ANTENNA;
	for (let dy = 0; dy < 6; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = EYES_STAR[dy][dx];
			if (c !== '.') {
				rows[6 + dy][4 + dx] = c;
			}
		}
	}
	for (let dy = 0; dy < 2; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = MOUTH_GRIN[dy][dx];
			if (c !== '.') {
				rows[13 + dy][4 + dx] = c;
			}
		}
	}
	return rows.map((r) => r.join(''));
}

const SPRITE = composeWin();
const SPRITE_H = SPRITE.length; // 18
const SPRITE_W = SPRITE[0].length; // 16

const SIZE = 128;
const SCALE = 6; // 18*6=108, 16*6=96 — leaves 10px / 16px margins for the pink border to breathe
const BG = [30, 30, 30];
const offsetX = Math.floor((SIZE - SPRITE_W * SCALE) / 2);
const offsetY = Math.floor((SIZE - SPRITE_H * SCALE) / 2);

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < pixels.length; i += 4) {
	pixels[i] = BG[0];
	pixels[i + 1] = BG[1];
	pixels[i + 2] = BG[2];
	pixels[i + 3] = 255;
}

for (let py = 0; py < SPRITE_H; py++) {
	for (let px = 0; px < SPRITE_W; px++) {
		const ch = SPRITE[py][px];
		const color = PALETTE[ch];
		if (!color) {
			continue;
		}
		for (let dy = 0; dy < SCALE; dy++) {
			for (let dx = 0; dx < SCALE; dx++) {
				const x = offsetX + px * SCALE + dx;
				const y = offsetY + py * SCALE + dy;
				if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
					continue;
				}
				const i = (y * SIZE + x) * 4;
				pixels[i] = color[0];
				pixels[i + 1] = color[1];
				pixels[i + 2] = color[2];
				pixels[i + 3] = 255;
			}
		}
	}
}

// Subtle 1-pixel pink border for the marketplace frame.
const borderColor = [255, 119, 184];
for (let i = 0; i < SIZE; i++) {
	for (const [x, y] of [
		[i, 0],
		[i, SIZE - 1],
		[0, i],
		[SIZE - 1, i],
	]) {
		const idx = (y * SIZE + x) * 4;
		pixels[idx] = borderColor[0];
		pixels[idx + 1] = borderColor[1];
		pixels[idx + 2] = borderColor[2];
		pixels[idx + 3] = 255;
	}
}

const filtered = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
	filtered[y * (1 + SIZE * 4)] = 0; // filter: None
	pixels.copy(filtered, y * (1 + SIZE * 4) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idatData = zlib.deflateSync(filtered);

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
	SIGNATURE,
	chunk('IHDR', ihdr),
	chunk('IDAT', idatData),
	chunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${SIZE}x${SIZE})`);
