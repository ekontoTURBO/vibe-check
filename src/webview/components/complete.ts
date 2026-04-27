import { h } from '../dom';
import { glitch, pixelIcon } from '../pixelArt';
import { send } from '../api';
import type { ViewState } from '../types';

const CONFETTI_COLORS = ['var(--vc-pink)', 'var(--vc-gold)', 'var(--vc-cyan)', 'var(--vc-green)'];

function confettiPiece(idx: number, total: number): HTMLElement {
	const left = (idx * 7919) % 100;
	const delay = ((idx * 1031) % 50) / 100;
	const size = 3 + (idx % 3) * 2;
	const color = CONFETTI_COLORS[idx % CONFETTI_COLORS.length];
	void total;
	return h('div', {
		className: 'vc-confetti',
		style: {
			left: `${left}%`,
			width: `${size}px`,
			height: `${size}px`,
			background: color,
			animation: `confetti-fall 1.4s ${delay}s steps(8) forwards`,
		},
	});
}

export function renderComplete(state: ViewState): HTMLElement | null {
	if (state.screen.kind !== 'complete') {
		return null;
	}
	const { correct, total, xpEarned, passed } = state.screen;

	const confetti = passed
		? Array.from({ length: 30 }, (_, i) => confettiPiece(i, 30))
		: [];

	const stats = h(
		'div',
		{ className: 'vc-complete__stats pixel-card' },
		h(
			'div',
			{ className: 'vc-complete__stat' },
			pixelIcon('check', { scale: 2, color: 'var(--vc-green)' }),
			h(
				'span',
				{ className: 'vc-complete__stat-value', style: { color: 'var(--vc-green)' } },
				`${correct}/${total}`
			),
			h('span', { className: 'vc-complete__stat-label' }, 'CORRECT')
		),
		h(
			'div',
			{ className: 'vc-complete__stat' },
			pixelIcon('star', { scale: 2 }),
			h(
				'span',
				{ className: 'vc-complete__stat-value', style: { color: 'var(--vc-gold)' } },
				`+${xpEarned}`
			),
			h('span', { className: 'vc-complete__stat-label' }, 'XP EARNED')
		)
	);

	const streakRow =
		passed && state.progress.streak > 0
			? h(
					'div',
					{ className: 'vc-complete__streak' },
					h('div', { className: 'anim-flame' }, pixelIcon('flame', { scale: 2 })),
					h(
						'span',
						{ className: 'vc-complete__streak-text' },
						`${state.progress.streak} DAY STREAK!`
					)
			  )
			: null;

	return h(
		'div',
		{ className: 'vc-complete' },
		confetti,
		h(
			'div',
			{
				className: 'anim-pop',
				style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' },
			},
			glitch(passed ? 'win' : 'sad', 5)
		),
		h(
			'div',
			{
				className: `vc-complete__title vc-complete__title--${passed ? 'win' : 'fail'}`,
			},
			passed ? 'LESSON\nCOMPLETE!' : 'KEEP\nTRYING'
		),
		stats,
		streakRow,
		h(
			'button',
			{
				className: `pbtn ${passed ? 'pbtn--gold' : 'pbtn--red'} pbtn--block`,
				on: { click: () => send({ type: 'completeAcknowledged' }) },
			},
			passed ? 'NEXT LESSON ▶' : 'TRY AGAIN'
		)
	);
}
