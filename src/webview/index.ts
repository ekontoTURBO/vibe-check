import { store } from './store';
import { render } from './render';
import { send } from './api';
import { clearLessonLocalSelection } from './components/lesson';
import type { HostMessage } from './types';

const root = document.getElementById('vc-root');
if (!root) {
	throw new Error('vc-root element missing');
}

// IMPORTANT: cleanup MUST be subscribed BEFORE render. Subscribers fire in registration order;
// if render runs first it captures the stale `local` selection in click-handler closures, then
// cleanup nulls out `local`, which causes the next click to write to an orphaned object that
// the next render discards — manifesting as a "first click does nothing" bug.
let lastLessonId = '';
store.subscribe((state) => {
	const lessonId = state.activeLesson?.lessonId ?? '';
	if (lessonId !== lastLessonId) {
		clearLessonLocalSelection();
		lastLessonId = lessonId;
	}
});

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

send({ type: 'ready' });

// Initial paint with empty state so the user sees something while host hydrates.
render(root, store.getState());
