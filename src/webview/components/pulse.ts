import { h } from '../dom';
import { glitch } from '../pixelArt';
import { send } from '../api';
import type { PulseInfo } from '../types';

export function renderPulse(info: PulseInfo): HTMLElement {
	return h(
		'div',
		{ className: 'vc-pulse anim-pop' },
		glitch('surprise', 3),
		h(
			'div',
			{ className: 'vc-pulse__body' },
			h(
				'div',
				{ className: 'vc-pulse__head' },
				h('div', { className: 'vc-pulse__title' }, 'PULSE DETECTED'),
				h(
					'button',
					{
						className: 'vc-pulse__close',
						on: { click: () => send({ type: 'dismissPulse' }) },
					},
					'✕'
				)
			),
			h(
				'div',
				{ className: 'vc-pulse__msg' },
				'AI just inserted ',
				h('strong', null, `${info.lines} lines`),
				` (${info.chars} chars). Quiz yourself before you ship?`
			),
			h(
				'div',
				{ className: 'vc-pulse__actions' },
				h(
					'button',
					{
						className: 'pbtn pbtn--xs',
						on: { click: () => send({ type: 'openPicker' }) },
					},
					'VIBE CHECK ME'
				),
				h(
					'button',
					{
						className: 'pbtn pbtn--ghost pbtn--xs',
						on: { click: () => send({ type: 'dismissPulse' }) },
					},
					'LATER'
				)
			)
		)
	);
}
