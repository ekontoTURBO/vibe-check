import { h } from '../dom';
import { glitch, pixelIcon, topicIcon, type IconKind } from '../pixelArt';
import { send } from '../api';
import type { ModuleSummary, Topic, Track, ViewState } from '../types';

const TOPIC_ICON_COLOR: Record<Topic, string> = {
	code: 'var(--vc-pink)',
	infrastructure: 'var(--vc-cyan)',
	tools: 'var(--vc-gold)',
	architecture: 'var(--vc-green)',
	security: 'var(--vc-red)',
};

const TRACK_LABEL: Record<Track, string> = {
	beginner: 'BEG',
	intermediate: 'INT',
	expert: 'EXP',
};

function progressBar(progress: number, total: number): HTMLElement {
	const pct = total === 0 ? 0 : Math.max(0, Math.min(100, (progress / total) * 100));
	return h(
		'div',
		{ className: 'pbar pbar--lesson', style: { height: '6px' } },
		h('div', { className: 'fill', style: { width: `${pct}%` } })
	);
}

function moduleRow(m: ModuleSummary, isActive: boolean): HTMLElement {
	const completed = m.lessons.filter((l) => l.state === 'completed').length;
	const iconKind: IconKind = topicIcon(m.topic);
	const color = TOPIC_ICON_COLOR[m.topic];

	return h(
		'div',
		{ className: `vc-module${isActive ? ' vc-module--active' : ''}` },
		h(
			'button',
			{
				className: 'vc-module__main',
				on: {
					click: () => send({ type: 'openModule', moduleId: m.id }),
				},
			},
			h(
				'div',
				{ className: 'vc-module__icon', style: { color } },
				pixelIcon(iconKind, { scale: 2, color })
			),
			h(
				'div',
				{ className: 'vc-module__body' },
				h(
					'div',
					{ className: 'vc-module__row' },
					h('div', { className: 'vc-module__title' }, m.title.toUpperCase()),
					h('span', { className: `vc-track-chip vc-track-chip--${m.track}` }, TRACK_LABEL[m.track])
				),
				h('div', { className: 'vc-module__sub' }, m.topic),
				h(
					'div',
					{ className: 'vc-module__progress' },
					progressBar(completed, m.lessons.length),
					h('span', { className: 'vc-module__count' }, `${completed}/${m.lessons.length}`)
				)
			)
		),
		h(
			'button',
			{
				className: 'vc-module__delete',
				title: 'Delete module',
				'aria-label': 'Delete module',
				on: {
					click: (ev) => {
						ev.stopPropagation();
						if (confirm(`Delete "${m.title}" and its review cards? This cannot be undone.`)) {
							send({ type: 'deleteModule', moduleId: m.id });
						}
					},
				},
			},
			'✕'
		)
	);
}

export function renderHome(state: ViewState): HTMLElement {
	const { modules, dueCount, capabilities } = state;
	const noWorkspace = !capabilities.hasWorkspaceFolder && !capabilities.hasActiveEditor;

	const head = h(
		'div',
		{ className: 'vc-list' },
		h(
			'div',
			{ className: 'vc-list__head' },
			h('span', { className: 'vc-list__title' }, 'YOUR MODULES'),
			h(
				'button',
				{
					className: 'pbtn pbtn--xs',
					on: { click: () => send({ type: 'openPicker' }) },
				},
				'+ NEW'
			)
		)
	);

	let body: HTMLElement;
	if (modules.length === 0) {
		body = h(
			'div',
			{ className: 'vc-empty' },
			h('div', { className: 'vc-empty__mascot' }, glitch('idle', 4)),
			h(
				'div',
				{ className: 'vc-empty__title' },
				noWorkspace ? 'NO WORKSPACE' : 'NO QUIZZES YET'
			),
			h(
				'div',
				{ className: 'vc-empty__msg' },
				noWorkspace
					? 'Open a file or workspace folder so Vibe Check has something to quiz on.'
					: 'Hit '
			),
			noWorkspace
				? null
				: h(
						'div',
						{ className: 'vc-empty__actions' },
						h(
							'button',
							{
								className: 'pbtn pbtn--cyan pbtn--small',
								on: { click: () => send({ type: 'openPicker' }) },
							},
							'+ NEW MODULE'
						),
						h(
							'div',
							{ className: 'vc-empty__hint' },
							'…or let an AI agent insert >5 lines into the editor — Vibe Check auto-fires.'
						)
				  )
		);
	} else {
		body = h(
			'div',
			{ className: 'vc-modules' },
			modules.map((m) => moduleRow(m, m.id === state.activeModule?.id))
		);
	}

	const reviewBtn = h(
		'button',
		{
			className: 'pbtn pbtn--cyan pbtn--small pbtn--block',
			disabled: dueCount === 0,
			on: { click: () => send({ type: 'startReview' }) },
		},
		dueCount > 0 ? `↻ START DUE REVIEW (${dueCount})` : '↻ NOTHING DUE'
	);

	return h('div', null, head, body, h('div', { className: 'vc-bottom-bar' }, reviewBtn));
}
