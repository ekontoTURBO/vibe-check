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
		h('div', { className: 'vc-generating__text' }, label),
		h(
			'button',
			{
				className: 'pbtn pbtn--small pbtn--ghost',
				on: { click: () => send({ type: 'cancelGeneration' }) },
			},
			'CANCEL'
		)
	);
}

function errorBanner(message: string): HTMLElement {
	return h(
		'div',
		{ className: 'vc-error-banner' },
		h('span', { className: 'vc-error-banner__msg' }, message),
		h(
			'button',
			{
				className: 'vc-error-banner__close',
				title: 'Dismiss',
				'aria-label': 'Dismiss error',
				on: { click: () => send({ type: 'dismissError' }) },
			},
			'✕'
		)
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

/** Per-screen scroll memory — keyed by a string the renderer can build from state. */
const scrollMemory = new Map<string, number>();

function scrollKey(state: ViewState): string {
	switch (state.screen.kind) {
		case 'lesson':
			return `lesson:${state.activeLesson?.lessonId ?? ''}:${state.activeLesson?.currentIndex ?? 0}`;
		case 'path':
			return `path:${state.screen.moduleId}`;
		default:
			return state.screen.kind;
	}
}

export function render(rootEl: HTMLElement, state: ViewState): void {
	// Capture scroll position BEFORE wiping the DOM so we can restore it on the new node.
	const priorScreen = rootEl.querySelector<HTMLDivElement>('#vc-screen');
	if (priorScreen) {
		// Stash under whatever key the OUTGOING state had — but we no longer have that.
		// Instead use the current key: while answering options or hitting "? WHY", the key
		// is stable, so saving under the current key preserves the scroll across that render.
		scrollMemory.set(scrollKey(state), priorScreen.scrollTop);
	}

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

	const restored = scrollMemory.get(scrollKey(state));
	if (typeof restored === 'number' && restored > 0) {
		// Defer to next frame so the browser has laid out the new content before we scroll.
		requestAnimationFrame(() => {
			screen.scrollTop = restored;
		});
	}
}
