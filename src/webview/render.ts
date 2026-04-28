import { h, clear } from './dom';
import { glitch } from './pixelArt';
import { send } from './api';
import type { ViewState } from './types';
import { renderHeader } from './components/header';
import { renderHome } from './components/home';
import { renderPath } from './components/path';
import { renderLessonScreen } from './components/lesson';
import { renderComplete } from './components/complete';
import { renderPicker } from './components/picker';
import { renderPulse } from './components/pulse';
import { renderFooter } from './components/footer';

function generatingOverlay(state: ViewState): HTMLElement {
	const label = state.generatingTopic
		? `GENERATING ${state.generatingTopic.toUpperCase()} MODULE…`
		: 'WORKING…';
	return h(
		'div',
		{ className: 'vc-generating' },
		glitch('think', 4),
		h('div', { className: 'vc-generating__text' }, label)
	);
}

function errorBanner(message: string): HTMLElement {
	return h(
		'div',
		{ className: 'vc-error-banner', on: { click: () => send({ type: 'dismissError' }) } },
		message
	);
}

function renderScreenBody(state: ViewState): HTMLElement {
	if (state.isGenerating) {
		return generatingOverlay(state);
	}
	switch (state.screen.kind) {
		case 'home':
			return renderHome(state) ?? renderHome(state);
		case 'path': {
			const path = renderPath(state);
			return path ?? renderHome(state);
		}
		case 'lesson': {
			const lesson = renderLessonScreen(state);
			return lesson ?? renderHome(state);
		}
		case 'complete':
			return renderComplete(state) ?? renderHome(state);
		case 'picker':
			return renderPicker(state);
	}
}

function showHeader(state: ViewState): boolean {
	if (state.isGenerating) {
		return true;
	}
	if (state.screen.kind === 'lesson') {
		return false;
	}
	return true;
}

export function render(rootEl: HTMLElement, state: ViewState): void {
	clear(rootEl);

	const screen = h('div', { id: 'vc-screen' });

	if (showHeader(state)) {
		rootEl.appendChild(renderHeader(state));
	}

	if (state.error) {
		rootEl.appendChild(errorBanner(state.error));
	}

	if (state.pulse && state.screen.kind === 'home') {
		rootEl.appendChild(renderPulse(state.pulse));
	}

	screen.appendChild(renderScreenBody(state));
	rootEl.appendChild(screen);
	rootEl.appendChild(renderFooter());
}
