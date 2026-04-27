import { h } from '../dom';
import { glitch, pixelIcon, type IconKind } from '../pixelArt';
import { send } from '../api';
import type { Capabilities, Topic, ViewState } from '../types';

interface TopicEntry {
	id: Topic;
	icon: IconKind;
	label: string;
	desc: string;
	color: string;
}

const TOPICS: TopicEntry[] = [
	{ id: 'code', icon: 'code', label: 'CODE', desc: 'Active selection or file', color: 'var(--vc-pink)' },
	{ id: 'infrastructure', icon: 'cap', label: 'INFRASTRUCTURE', desc: 'package.json, configs, build', color: 'var(--vc-cyan)' },
	{ id: 'tools', icon: 'star', label: 'TOOLS', desc: 'Deps, scripts, what they do', color: 'var(--vc-gold)' },
	{ id: 'architecture', icon: 'cap', label: 'ARCHITECTURE', desc: 'Directory tree & boundaries', color: 'var(--vc-green)' },
	{ id: 'security', icon: 'lock', label: 'SECURITY', desc: 'Injection, validation gaps', color: 'var(--vc-red)' },
];

function isAvailable(t: Topic, caps: Capabilities): boolean {
	switch (t) {
		case 'code':
			return caps.hasActiveEditor;
		case 'infrastructure':
		case 'architecture':
			return caps.hasWorkspaceFolder;
		case 'tools':
			return caps.hasPackageJson;
		case 'security':
			return caps.hasActiveEditor || caps.hasWorkspaceFolder;
	}
}

export function renderPicker(state: ViewState): HTMLElement {
	const caps = state.capabilities;

	const head = h(
		'div',
		{ className: 'vc-picker__head' },
		glitch('think', 3),
		h(
			'div',
			{ className: 'col grow' },
			h('div', { className: 'vc-picker__title' }, 'NEW MODULE'),
			h('div', { className: 'vc-picker__sub' }, 'What do you want to learn?')
		),
		h(
			'button',
			{
				className: 'vc-picker__close',
				on: { click: () => send({ type: 'closePicker' }) },
			},
			'✕'
		)
	);

	const rows = h(
		'div',
		{ className: 'vc-picker__rows' },
		TOPICS.map((t) => {
			const available = isAvailable(t.id, caps);
			return h(
				'button',
				{
					className: 'vc-picker__row',
					disabled: !available,
					style: {
						boxShadow: `inset 4px 0 0 0 ${t.color}, inset 0 0 0 1px var(--vc-line)`,
					},
					on: {
						click: () => {
							if (!available) {
								return;
							}
							send({ type: 'newModule', topic: t.id });
						},
					},
				},
				h(
					'div',
					{ className: 'vc-picker__icon', style: { color: t.color } },
					pixelIcon(t.icon, { scale: 2, color: t.color })
				),
				h(
					'div',
					{ className: 'vc-picker__body' },
					h('div', { className: 'vc-picker__label', style: { color: t.color } }, t.label),
					h(
						'div',
						{ className: 'vc-picker__desc' },
						available ? t.desc : `${t.desc} · unavailable`
					)
				),
				h('span', { className: 'vc-picker__chev' }, '▶')
			);
		})
	);

	return h('div', { className: 'vc-picker' }, head, rows);
}
