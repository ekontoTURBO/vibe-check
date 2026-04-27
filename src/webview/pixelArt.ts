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
   GLITCH — the Vibe Check mascot (16x16, 6 moods)
   ============================================================ */

export const GLITCH_PALETTE: PaletteMap = {
	'.': 'transparent',
	'0': '#1a1a1a',
	'1': '#ff77b8',
	'2': '#c84d8e',
	'3': '#ffffff',
	'4': '#1a1a1a',
	'5': '#ffd23f',
	'6': '#4ec9ff',
	'7': '#7a2851',
	'8': '#6fdc7a',
	'9': '#ff5a6a',
	'a': '#ffb3d4',
};

const GLITCH_IDLE = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163400340312..
.0163443344312..
.0163400340312..
.0163333333312..
.01666666666127.
.0111111111112..
.0111155551112..
.02222222222227.
..7777777777777.
`;

const GLITCH_HAPPY = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163008008312..
.0163008008312..
.0163008008312..
.0163333333312..
.01666688866127.
.0111188888112..
.0111155551112..
.02222222222227.
..7777777777777.
`;

const GLITCH_SAD = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163443344312..
.0163400440312..
.0163400440312..
.0163333333312..
.01666666666127.
.0111199999112..
.0111159995112..
.02222222222227.
..7777777777777.
`;

const GLITCH_SURPRISE = `
................
................
.000000000000...
.0aaaaaaaaaa0...
.01111111111027.
.0166666666612.7
.0163333333312..
.0163040040312..
.0163040040312..
.0163040040312..
.0163333333312..
.01666666666127.
.0111199911112..
.0111199911112..
.02222222222227.
..7777777777777.
`;

const GLITCH_THINK = `
................
................
.000000000000.55
.0aaaaaaaaaa0.5.
.0111111111102.5
.0166666666612.7
.0163333333312..
.0163004400312..
.0163004400312..
.0163400040312..
.0163333333312..
.01666666666127.
.0111111551112..
.0111155555112..
.02222222222227.
..7777777777777.
`;

const GLITCH_WIN = `
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
`;

export type GlitchMood = 'idle' | 'happy' | 'sad' | 'surprise' | 'think' | 'win';

const MOODS: Record<GlitchMood, string> = {
	idle: GLITCH_IDLE,
	happy: GLITCH_HAPPY,
	sad: GLITCH_SAD,
	surprise: GLITCH_SURPRISE,
	think: GLITCH_THINK,
	win: GLITCH_WIN,
};

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

export type IconKind = 'flame' | 'star' | 'lock' | 'check' | 'heart' | 'trophy' | 'code' | 'cap';

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
