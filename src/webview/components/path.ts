import { h } from '../dom';
import { pixelIcon, topicIcon } from '../pixelArt';
import { send } from '../api';
import type { ActiveModuleDetail, ModulePathLesson, ViewState } from '../types';

type NodeVisual = 'locked' | 'available' | 'current' | 'complete';

const OFFSETS = [0, 36, 24, -24, -36, -24, 0, 24, 36, 24];

function pixelNode(
	state: NodeVisual,
	topic: string,
	onClick: () => void
): HTMLElement {
	const animating = state === 'available' || state === 'current';
	const cls = `vc-node vc-node--${state}${animating ? ' anim-pulse' : ''}`;
	const iconKind = state === 'locked' ? 'lock' : state === 'complete' ? 'check' : topicIcon(topic);
	const iconColor =
		state === 'locked' ? '#888' : state === 'complete' ? '#062b0c' : '#2a1f00';

	const button = h(
		'button',
		{
			className: cls,
			disabled: state === 'locked',
			on: { click: state === 'locked' ? () => {} : onClick },
		},
		h(
			'div',
			{ style: { color: iconColor, display: 'flex' } },
			pixelIcon(iconKind, { scale: 3, color: iconColor })
		)
	);

	if (state === 'available' || state === 'current') {
		button.appendChild(h('div', { className: 'vc-node__ring anim-ring' }));
	}

	return button;
}

function lessonRow(
	lesson: ModulePathLesson,
	totalLessons: number,
	moduleTopic: string,
	moduleId: string,
	currentIdx: number,
	isLast: boolean
): HTMLElement {
	const moduleLessonId = lesson.id;
	const offset = OFFSETS[lesson.index % OFFSETS.length];
	const isCurrent = lesson.state === 'available' && lesson.index === currentIdx;
	const visual: NodeVisual =
		lesson.state === 'completed'
			? 'complete'
			: isCurrent
			? 'current'
			: lesson.state;

	const node = pixelNode(visual, moduleTopic, () => {
		send({ type: 'startLesson', moduleId, lessonId: moduleLessonId });
	});

	const label = h(
		'div',
		{
			className: `vc-path__label${lesson.state === 'locked' ? ' vc-path__label--locked' : ''}`,
		},
		`L${lesson.index + 1}: ${truncate(lesson.title, 18)}`
	);

	const wrap = h(
		'div',
		{
			className: 'vc-path__node-wrap',
			style: { transform: `translateX(${offset}px)` },
		},
		node,
		label,
		isCurrent
			? h('div', { className: 'vc-path__start-hint anim-pulse' }, '▼ START')
			: null
	);

	const row = h('div', { className: 'vc-path__row' }, wrap);
	if (!isLast) {
		const completedSoFar = lesson.state === 'completed';
		row.appendChild(
			h('div', {
				className: `vc-path__connector vc-path__connector--${
					completedSoFar ? 'complete' : 'pending'
				}`,
			})
		);
	}
	void totalLessons;
	return row;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) {
		return s;
	}
	return s.slice(0, max - 1) + '…';
}

function moduleProgressBar(completed: number, total: number): HTMLElement {
	const pct = total === 0 ? 0 : (completed / total) * 100;
	return h(
		'div',
		{ style: { width: '100%' } },
		h(
			'div',
			{
				className: 'row',
				style: { justifyContent: 'space-between', marginBottom: '4px' },
			},
			h(
				'span',
				{
					className: 'font-pixel',
					style: { fontSize: '8px', color: 'var(--vc-fg-dim)' },
				},
				'MODULE PROGRESS'
			),
			h(
				'span',
				{
					className: 'font-pixel',
					style: { fontSize: '8px', color: 'var(--vc-fg-dim)' },
				},
				`${completed}/${total}`
			)
		),
		h(
			'div',
			{ className: 'pbar pbar--lesson', style: { height: '8px' } },
			h('div', { className: 'fill', style: { width: `${pct}%` } })
		)
	);
}

export function renderPath(state: ViewState): HTMLElement | null {
	const detail = state.activeModule;
	if (!detail) {
		return null;
	}
	return renderPathInner(detail);
}

function renderPathInner(detail: ActiveModuleDetail): HTMLElement {
	const completed = detail.completedCount;
	const total = detail.lessons.length;
	const currentIdx = detail.lessons.findIndex((l) => l.state === 'available');

	const head = h(
		'div',
		{ className: 'vc-path-head' },
		h(
			'button',
			{
				className: 'vc-path-back',
				on: { click: () => send({ type: 'closeModule' }) },
			},
			'◀ BACK'
		),
		h('div', { className: 'vc-path-title' }, detail.title.toUpperCase()),
		h(
			'div',
			{ className: 'vc-path-sub', title: detail.contextLabel },
			detail.sourceFile
				? truncate(detail.sourceFile.replace(/\\/g, '/').split('/').slice(-2).join('/'), 40)
				: detail.contextLabel
		),
		h('div', { style: { marginTop: '8px' } }, moduleProgressBar(completed, total))
	);

	const path = h(
		'div',
		{ className: 'vc-path' },
		detail.lessons.map((l, i) =>
			lessonRow(
				l,
				total,
				detail.topic,
				detail.id,
				currentIdx,
				i === detail.lessons.length - 1
			)
		)
	);

	return h('div', null, head, path);
}
