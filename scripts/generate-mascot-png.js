#!/usr/bin/env node
/**
 * Generates a standalone Glitch mascot PNG for use outside the extension
 * (README headers, social cards, etc). Run once and commit the output.
 *
 * Usage:
 *   node scripts/generate-mascot-png.js [mood] [outName] [scale]
 *
 *   mood    — idle, happy, sad, surprise, think, win, focus, sleep, load
 *   outName — file name written under media/   (default: glitch-<mood>.png)
 *   scale   — int >= 4 for crisp readme rendering (default: 12 → 192x216 px)
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

const EYES = {
	open: ['...00...', '..0440..', '.044440.', '.043440.', '..0440..', '...00...'],
	closed: ['........', '........', '.0....0.', '00....00', '.000000.', '........'],
	sad: ['.000000.', '0......0', '...00...', '..0440..', '...00...', '........'],
	wide: ['..0000..', '.044440.', '.044340.', '.044440.', '.044440.', '..0000..'],
	side: ['........', '....000.', '...0440.', '...0430.', '....000.', '........'],
	star: ['...55...', '..5555..', '.555555.', '.555555.', '..5555..', '...55...'],
	focus: ['00000000', '00000000', '...00...', '..0440..', '...00...', '........'],
	sleep: ['..0000..', '0....50.', '....50..', '...50000', '..00000.', '........'],
	load: ['........', '00000000', '........', '00000000', '........', '00000000'],
};

const MOUTHS = {
	flat: ['........', '..0000..'],
	bigsmile: ['.000000.', '.088880.'],
	frown: ['..0000..', '.0....0.'],
	o: ['..0000..', '..0990..'],
	wave: ['.0.00.0.', '..0..0..'],
	grin: ['.000000.', '.000000.'],
};

const ANTENNA = { default: '5', red: '9', green: '8', cyan: '6', off: '2' };

const RECIPES = {
	idle: { eyes: 'open', mouth: 'flat', antenna: 'default' },
	happy: { eyes: 'closed', mouth: 'bigsmile', antenna: 'green' },
	sad: { eyes: 'sad', mouth: 'frown', antenna: 'off' },
	surprise: { eyes: 'wide', mouth: 'o', antenna: 'red' },
	think: { eyes: 'side', mouth: 'wave', antenna: 'cyan' },
	win: { eyes: 'star', mouth: 'grin', antenna: 'default' },
	focus: { eyes: 'focus', mouth: 'flat', antenna: 'default' },
	sleep: { eyes: 'sleep', mouth: 'flat', antenna: 'off' },
	load: { eyes: 'load', mouth: 'flat', antenna: 'cyan' },
};

function compose(mood) {
	const r = RECIPES[mood] ?? RECIPES.idle;
	const rows = GLITCH_BASE.trim().split('\n').map((row) => row.split(''));
	const led = ANTENNA[r.antenna];
	rows[3][7] = led;
	rows[3][8] = led;
	const eye = EYES[r.eyes];
	for (let dy = 0; dy < 6; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = eye[dy][dx];
			if (c !== '.') rows[6 + dy][4 + dx] = c;
		}
	}
	const m = MOUTHS[r.mouth];
	for (let dy = 0; dy < 2; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = m[dy][dx];
			if (c !== '.') rows[13 + dy][4 + dx] = c;
		}
	}
	return rows;
}

const mood = process.argv[2] || 'idle';
const outName = process.argv[3] || `glitch-${mood}.png`;
const SCALE = parseInt(process.argv[4] || '12', 10);

const sprite = compose(mood);
const SH = sprite.length; // 18
const SW = sprite[0].length; // 16
const W = SW * SCALE;
const H = SH * SCALE;

const pixels = Buffer.alloc(W * H * 4); // transparent by default
for (let py = 0; py < SH; py++) {
	for (let px = 0; px < SW; px++) {
		const ch = sprite[py][px];
		const color = PALETTE[ch];
		if (!color) continue;
		for (let dy = 0; dy < SCALE; dy++) {
			for (let dx = 0; dx < SCALE; dx++) {
				const x = px * SCALE + dx;
				const y = py * SCALE + dy;
				const i = (y * W + x) * 4;
				pixels[i] = color[0];
				pixels[i + 1] = color[1];
				pixels[i + 2] = color[2];
				pixels[i + 3] = 255;
			}
		}
	}
}

const filtered = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
	filtered[y * (1 + W * 4)] = 0;
	pixels.copy(filtered, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const idatData = zlib.deflateSync(filtered);

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
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

const outPath = path.join(__dirname, '..', 'media', outName);
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}x${H}, mood=${mood})`);
