import { store } from './store';
import { render } from './render';
import { send } from './api';
import { clearLessonLocalSelection } from './components/lesson';
import type { HostMessage } from './types';

const root = document.getElementById('vc-root');
if (!root) {
	throw new Error('vc-root element missing');
}

store.subscribe((state) => {
	render(root, state);
});

window.addEventListener('message', (ev: MessageEvent<HostMessage>) => {
	const msg = ev.data;
	if (!msg || typeof msg !== 'object') {
		return;
	}
	switch (msg.type) {
		case 'state':
			store.hydrate(msg.state);
			return;
		case 'wrongFeedback': {
			store.updateFeedback((f) =>
				f.questionId === msg.questionId
					? { ...f, personalizedMessage: msg.message, personalizedLoading: false }
					: f
			);
			return;
		}
		case 'error':
			store.setError(msg.message);
			return;
	}
});

// Reset selection state whenever lesson activeId changes (handled by hydrate),
// also clear when lesson becomes null.
let lastLessonKey = '';
store.subscribe((state) => {
	const key = state.activeLesson
		? `${state.activeLesson.lessonId}:${state.activeLesson.currentIndex}`
		: '';
	if (key !== lastLessonKey) {
		clearLessonLocalSelection();
		lastLessonKey = key;
	}
});

send({ type: 'ready' });

// Initial paint with empty state so the user sees something while host hydrates.
render(root, store.getState());
