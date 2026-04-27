#!/usr/bin/env node
/**
 * Generates media/icon.png — the Vibe Check Marketplace logo.
 * Renders Glitch (WIN mood, sparkles + happy face) on a VS-Code-dark
 * canvas. Pure Node, no new deps. Run with `node scripts/generate-icon.js`.
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
	'7': [122, 40, 81],
	'8': [111, 220, 122],
	'9': [255, 90, 106],
	a: [255, 179, 212],
};

const WIN = `
................
.....55....55...
....5..5..5..5..
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163338833312..
.0163088880312..
.0163088880312..
.0163338833312..
.01666666666127.
.0111188888112..
.0111155551112..
.02222222222227.
..7777777777777.
`
	.trim()
	.split('\n')
	.map((r) => r.trim());

const SIZE = 128;
const SCALE = 7;
const SPRITE = 16;
const BG = [30, 30, 30];
const offset = Math.floor((SIZE - SPRITE * SCALE) / 2);

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < pixels.length; i += 4) {
	pixels[i] = BG[0];
	pixels[i + 1] = BG[1];
	pixels[i + 2] = BG[2];
	pixels[i + 3] = 255;
}

for (let py = 0; py < SPRITE; py++) {
	for (let px = 0; px < SPRITE; px++) {
		const ch = WIN[py][px];
		const color = PALETTE[ch];
		if (!color) {
			continue;
		}
		for (let dy = 0; dy < SCALE; dy++) {
			for (let dx = 0; dx < SCALE; dx++) {
				const x = offset + px * SCALE + dx;
				const y = offset + py * SCALE + dy;
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

// Add a subtle 1-pixel border in pink to give the icon a frame
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
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
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
