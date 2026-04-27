import { h } from '../dom';
import { glitch, pixelIcon } from '../pixelArt';
import { send } from '../api';
import type { Track, ViewState } from '../types';

const TRACKS: { id: Track; label: string }[] = [
	{ id: 'beginner', label: 'BEGIN' },
	{ id: 'intermediate', label: 'INTER' },
	{ id: 'expert', label: 'EXPRT' },
];

const TRACK_ACCENT: Record<Track, string> = {
	beginner: 'var(--vc-cyan)',
	intermediate: 'var(--vc-pink)',
	expert: 'var(--vc-violet)',
};

const TRACK_BG: Record<Track, string> = {
	beginner: 'rgba(78,201,255,0.12)',
	intermediate: 'rgba(255,119,184,0.12)',
	expert: 'rgba(177,140,255,0.14)',
};

const TRACK_LABEL: Record<Track, string> = {
	beginner: 'BEGINNER',
	intermediate: 'INTERMED',
	expert: 'EXPERT',
};

function trackBadge(track: Track): HTMLElement {
	return h(
		'span',
		{
			className: 'chip',
			style: {
				background: TRACK_BG[track],
				color: TRACK_ACCENT[track],
				fontSize: '8px',
			},
		},
		`◆ ${TRACK_LABEL[track]}`
	);
}

function dailyRing(value: number, goal: number): HTMLElement {
	const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0));
	const deg = pct * 360;
	const pie = h('div', {
		className: 'vc-ring__pie',
		style: {
			background: `conic-gradient(var(--vc-gold) 0deg ${deg}deg, var(--vc-bg-4) ${deg}deg 360deg)`,
		},
	});
	const inner = h(
		'div',
		{ className: 'vc-ring__inner' },
		h('span', { className: 'vc-ring__value' }, String(Math.min(value, goal))),
		h('span', { className: 'vc-ring__goal' }, `/${goal}`)
	);
	return h('div', { className: 'vc-ring' }, pie, inner);
}

function statRow(
	icon: HTMLElement,
	value: string | number,
	label: string,
	color: string
): HTMLElement {
	return h(
		'div',
		{ className: 'vc-stat-row' },
		icon,
		h(
			'div',
			{ className: 'col' },
			h('span', { className: 'vc-stat-row__value', style: { color } }, String(value)),
			h('span', { className: 'vc-stat-row__label' }, label)
		)
	);
}

export function renderHeader(state: ViewState): HTMLElement {
	const { progress, track } = state;

	const brandRow = h(
		'div',
		{ className: 'vc-header__brand' },
		glitch('idle', 2),
		h(
			'div',
			{ className: 'col grow' },
			h('span', { className: 'vc-header__title' }, 'VIBE CHECK'),
			h('span', { className: 'vc-header__tagline' }, 'LEVEL UP YOUR CODE')
		),
		trackBadge(track)
	);

	const tabs = h(
		'div',
		{ className: 'vc-header__tracks' },
		TRACKS.map((t) =>
			h(
				'button',
				{
					className: `vc-track-btn${t.id === track ? ' vc-track-btn--active' : ''}`,
					on: {
						click: () => send({ type: 'setTrack', track: t.id }),
					},
				},
				t.label
			)
		)
	);

	const flameIcon = h(
		'div',
		{ className: 'anim-flame', style: { color: 'var(--vc-flame)' } },
		pixelIcon('flame', { scale: 2 })
	);

	const stats = h(
		'div',
		{ className: 'vc-stats' },
		dailyRing(progress.dailyXp, progress.dailyGoal),
		h(
			'div',
			{ className: 'vc-stats__col' },
			statRow(pixelIcon('star', { scale: 2 }), progress.xp, 'XP', 'var(--vc-gold)'),
			statRow(flameIcon, progress.streak, 'DAY STREAK', 'var(--vc-flame)'),
			progress.rank
				? statRow(pixelIcon('trophy', { scale: 2 }), progress.rank, 'RANK', 'var(--vc-fg)')
				: statRow(
						pixelIcon('check', { scale: 2, color: 'var(--vc-green)' }),
						progress.totalCorrect,
						'CORRECT',
						'var(--vc-fg)'
				  )
		)
	);

	return h('div', { className: 'vc-header' }, brandRow, tabs, stats);
}
