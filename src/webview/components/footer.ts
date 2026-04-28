import { h } from '../dom';
import { send } from '../api';

const SUPPORT_URL = 'https://buymeacoffee.com/ekontoturbo';

export function renderFooter(): HTMLElement {
	return h(
		'div',
		{ className: 'vc-footer' },
		h(
			'button',
			{
				className: 'vc-footer__link',
				title: 'Support development on Buy Me a Coffee',
				on: {
					click: () => send({ type: 'openExternal', url: SUPPORT_URL }),
				},
			},
			h('span', { className: 'vc-footer__icon', 'aria-hidden': 'true' }, '♥'),
			h('span', { className: 'vc-footer__text' }, 'BUY ME A COFFEE'),
			h('span', { className: 'vc-footer__chev', 'aria-hidden': 'true' }, '↗')
		)
	);
}
