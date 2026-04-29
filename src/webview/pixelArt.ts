/* Pixel art renderer + canonical char grids.
 * Char grids and palettes are copied verbatim from handoff/scripts/pixel-art.jsx. */

import { h } from './dom';

export type PaletteMap = Record<string, string>;

export interface PixelGridOptions {
	scale?: number;
	className?: string;
	style?: Partial<CSSStyleDeclaration>;
}

export function pixelGrid(
	art: string,
	palette: PaletteMap,
	opts: PixelGridOptions = {}
): HTMLDivElement {
	const scale = opts.scale ?? 2;
	const rows = art.trim().split('\n').map((r) => r.trim());
	const cols = rows[0]?.length ?? 0;
	const root = document.createElement('div');
	root.className = `pixelated${opts.className ? ' ' + opts.className : ''}`;
	root.style.position = 'relative';
	root.style.display = 'inline-block';
	root.style.width = `${cols * scale}px`;
	root.style.height = `${rows.length * scale}px`;
	if (opts.style) {
		Object.assign(root.style, opts.style);
	}
	for (let y = 0; y < rows.length; y++) {
		for (let x = 0; x < cols; x++) {
			const ch = rows[y][x];
			const color = palette[ch];
			if (!color || color === 'transparent') {
				continue;
			}
			const cell = document.createElement('div');
			cell.style.position = 'absolute';
			cell.style.left = `${x * scale}px`;
			cell.style.top = `${y * scale}px`;
			cell.style.width = `${scale}px`;
			cell.style.height = `${scale}px`;
			cell.style.background = color;
			root.appendChild(cell);
		}
	}
	return root;
}

/* ============================================================
   GLITCH — the Vibe Check mascot (18 rows x 16 cols, 9 moods)
   Composed from a static body silhouette + eye overlay + mouth
   overlay + antenna LED. The body never changes, so Glitch always
   looks like Glitch regardless of mood.
   ============================================================ */

export const GLITCH_PALETTE: PaletteMap = {
	'.': 'transparent',
	'0': '#1a1a1a',  // outline / pupil
	'1': '#ff77b8',  // body pink (brand)
	'2': '#c84d8e',  // body shadow
	'3': '#ffffff',  // eye highlight
	'4': '#1a1a1a',  // pupil (alias of 0)
	'5': '#ffd23f',  // gold (antenna LED, stars)
	'6': '#4ec9ff',  // screen cyan
	'7': '#0a0a0a',  // hard drop shadow
	'8': '#6fdc7a',  // green (happy / correct)
	'9': '#ff5a6a',  // red (sad / error)
	'a': '#ffb3d4',  // body highlight
	'b': '#2b7fa8',  // screen deep shadow
	'c': '#7a2851',  // body deep shadow
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

/* Eye overlays — 8 wide x 6 tall, painted into rows 6-11 cols 4-11.
   '.' leaves the underlying screen cyan untouched. */
const EYES: Record<string, string[]> = {
	open: ['...00...', '..0440..', '.044440.', '.043440.', '..0440..', '...00...'],
	up:   ['..0440..', '.044340.', '.044440.', '..0440..', '...00...', '........'],
	side: ['........', '....000.', '...0440.', '...0430.', '....000.', '........'],
	closed: ['........', '........', '.0....0.', '00....00', '.000000.', '........'],
	sad:  ['.000000.', '0......0', '...00...', '..0440..', '...00...', '........'],
	wide: ['..0000..', '.044440.', '.044340.', '.044440.', '.044440.', '..0000..'],
	star: ['...55...', '..5555..', '.555555.', '.555555.', '..5555..', '...55...'],
	focus: ['00000000', '00000000', '...00...', '..0440..', '...00...', '........'],
	sleep: ['..0000..', '0....50.', '....50..', '...50000', '..00000.', '........'],
	load:  ['........', '00000000', '........', '00000000', '........', '00000000'],
};

/* Mouth overlays — 8 wide x 2 tall, painted into rows 13-14 cols 4-11. */
const MOUTHS: Record<string, string[]> = {
	flat:     ['........', '..0000..'],
	smile:    ['.0....0.', '..0000..'],
	bigsmile: ['.000000.', '.088880.'],
	frown:    ['..0000..', '.0....0.'],
	o:        ['..0000..', '..0990..'],
	wave:     ['.0.00.0.', '..0..0..'],
	grin:     ['.000000.', '.000000.'],
};

/* Antenna LED color (palette key, applied to row 3 cols 7-8). */
const ANTENNA: Record<string, string> = {
	default: '5',
	red:     '9',
	green:   '8',
	cyan:    '6',
	off:     '2',
};

interface MoodRecipe {
	eyes: keyof typeof EYES;
	mouth: keyof typeof MOUTHS;
	antenna?: keyof typeof ANTENNA;
}

const MOOD_RECIPES = {
	idle:     { eyes: 'open',   mouth: 'flat',     antenna: 'default' },
	happy:    { eyes: 'closed', mouth: 'bigsmile', antenna: 'green'   },
	sad:      { eyes: 'sad',    mouth: 'frown',    antenna: 'off'     },
	surprise: { eyes: 'wide',   mouth: 'o',        antenna: 'red'     },
	think:    { eyes: 'side',   mouth: 'wave',     antenna: 'cyan'    },
	win:      { eyes: 'star',   mouth: 'grin',     antenna: 'default' },
	focus:    { eyes: 'focus',  mouth: 'flat',     antenna: 'default' },
	sleep:    { eyes: 'sleep',  mouth: 'flat',     antenna: 'off'     },
	load:     { eyes: 'load',   mouth: 'flat',     antenna: 'cyan'    },
} as const satisfies Record<string, MoodRecipe>;

export type GlitchMood = keyof typeof MOOD_RECIPES;

function composeGlitch(recipe: MoodRecipe): string {
	const rows = GLITCH_BASE.trim().split('\n').map((r) => r.split(''));

	// Antenna LED — row 3, cols 7-8
	const led = ANTENNA[recipe.antenna ?? 'default'];
	rows[3][7] = led;
	rows[3][8] = led;

	// Eye overlay — 8 wide x 6 tall into rows 6-11, cols 4-11
	const eye = EYES[recipe.eyes];
	for (let dy = 0; dy < 6; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = eye[dy][dx];
			if (c !== '.') {
				rows[6 + dy][4 + dx] = c;
			}
		}
	}

	// Mouth overlay — rows 13-14, cols 4-11
	const m = MOUTHS[recipe.mouth];
	for (let dy = 0; dy < 2; dy++) {
		for (let dx = 0; dx < 8; dx++) {
			const c = m[dy][dx];
			if (c !== '.') {
				rows[13 + dy][4 + dx] = c;
			}
		}
	}

	return rows.map((r) => r.join('')).join('\n');
}

const MOODS: Record<GlitchMood, string> = Object.fromEntries(
	(Object.entries(MOOD_RECIPES) as [GlitchMood, MoodRecipe][]).map(([k, recipe]) => [
		k,
		composeGlitch(recipe),
	])
) as Record<GlitchMood, string>;

export function glitch(
	mood: GlitchMood = 'idle',
	scale = 2,
	opts: { animate?: boolean } = {}
): HTMLDivElement {
	const wrap = h('div', {
		className: opts.animate !== false ? 'anim-blink' : '',
		style: { display: 'inline-block' },
	});
	wrap.appendChild(pixelGrid(MOODS[mood], GLITCH_PALETTE, { scale }));
	return wrap;
}

/* ============================================================
   Pixel icons (8x8 / 10x10 / 10x12)
   ============================================================ */

const ICON_FLAME = `
....1.....
...121....
..12231...
.1223321..
.1223321..
12233321.0
12333321.0
13333331.0
13333331.0
.1333331..
.1333331..
..11331...
`;

const ICON_STAR = `
....11....
....11....
...1331...
.1133311..
1113333111
.1113311..
..11331...
.113.311..
.11...11..
`;

const ICON_LOCK = `
..0000....
.001100...
.010010...
.010010...
00000000..
01111110..
01100110..
01101110..
01111110..
00000000..
`;

const ICON_CHECK = `
........11
.......110
......110.
00...110..
.00.110...
..0010....
...000....
....0.....
`;

const ICON_HEART = `
..00..00..
.0330033..
.3333333..
.3333333..
.3333333..
..33333...
...333....
....3.....
`;

const ICON_TROPHY = `
2.222222.2
22222222.2
.022220.22
.022220.2.
..0220....
..0220....
..0220....
.022220...
.222222...
`;

const ICON_CODE = `
.0......0.
0........0
0..00.00.0
0.0.0..0.0
0.0.0..0.0
0..00.00.0
0........0
.0......0.
`;

const ICON_CAP = `
....0.....
...000....
..00000...
.0000000..
0000000000
.0000000..
.0..0..0..
....0.....
....00....
`;

/* Thumb up — outline 0, fill 1. 10x10. */
const ICON_THUMB_UP = `
..........
....00....
...0110...
...0110...
.000110...
01111100..
01111110..
01111110..
00000000..
..........
`;

/* Thumb down — vertical flip of thumb up. 10x10. */
const ICON_THUMB_DOWN = `
..........
00000000..
01111110..
01111110..
01111100..
.000110...
...0110...
...0110...
....00....
..........
`;

export type IconKind =
	| 'flame'
	| 'star'
	| 'lock'
	| 'check'
	| 'heart'
	| 'trophy'
	| 'code'
	| 'cap'
	| 'thumbUp'
	| 'thumbDown';

interface IconDef {
	art: string;
	build: (color: string) => PaletteMap;
}

const ICON_REGISTRY: Record<IconKind, IconDef> = {
	flame: {
		art: ICON_FLAME,
		build: () => ({
			'.': 'transparent',
			'0': '#1a1a1a',
			'1': '#ff7a3d',
			'2': '#ffd23f',
			'3': '#ff5a6a',
			'4': '#ffffff',
		}),
	},
	star: {
		art: ICON_STAR,
		build: () => ({
			'.': 'transparent',
			'0': '#1a1a1a',
			'1': '#ffd23f',
			'2': '#c89a1a',
			'3': '#ffffff',
		}),
	},
	lock: {
		art: ICON_LOCK,
		build: (color) => ({ '.': 'transparent', '0': color, '1': '#ffd23f' }),
	},
	check: {
		art: ICON_CHECK,
		build: (color) => ({ '.': 'transparent', '0': color, '1': '#ffffff' }),
	},
	heart: {
		art: ICON_HEART,
		build: () => ({ '.': 'transparent', '0': '#1a1a1a', '3': '#ff5a6a' }),
	},
	trophy: {
		art: ICON_TROPHY,
		build: () => ({ '.': 'transparent', '0': '#1a1a1a', '2': '#ffd23f' }),
	},
	code: {
		art: ICON_CODE,
		build: (color) => ({ '.': 'transparent', '0': color }),
	},
	cap: {
		art: ICON_CAP,
		build: (color) => ({ '.': 'transparent', '0': color }),
	},
	thumbUp: {
		art: ICON_THUMB_UP,
		build: () => ({
			'.': 'transparent',
			'0': '#1a1a1a',
			'1': '#ffd23f',
		}),
	},
	thumbDown: {
		art: ICON_THUMB_DOWN,
		build: () => ({
			'.': 'transparent',
			'0': '#1a1a1a',
			'1': '#ff5a6a',
		}),
	},
};

export function pixelIcon(
	kind: IconKind,
	opts: { scale?: number; color?: string; className?: string } = {}
): HTMLDivElement {
	const def = ICON_REGISTRY[kind] ?? ICON_REGISTRY.star;
	return pixelGrid(def.art, def.build(opts.color ?? 'currentColor'), {
		scale: opts.scale ?? 2,
		className: opts.className,
	});
}

export function topicIcon(topic: string): IconKind {
	switch (topic) {
		case 'code':
			return 'code';
		case 'security':
			return 'lock';
		case 'tools':
			return 'star';
		case 'infrastructure':
		case 'architecture':
		default:
			return 'cap';
	}
}
