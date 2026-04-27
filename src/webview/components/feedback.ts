import { h } from '../dom';
import { glitch } from '../pixelArt';
import { send } from '../api';
import { store } from '../store';
import { resetCurrentLessonSelection } from './lesson';
import { renderPromptText } from '../promptText';
import type { ActiveLessonState, FeedbackUiState, Question } from '../types';

export function renderFeedback(
	fb: FeedbackUiState,
	q: Question,
	lesson: ActiveLessonState
): HTMLElement {
	if (fb.correct) {
		return h(
			'div',
			{ className: 'vc-feedback vc-feedback--correct anim-pop' },
			glitch('happy', 3),
			h(
				'div',
				{ className: 'vc-feedback__body' },
				h('div', { className: 'vc-feedback__title' }, `NICE! +${fb.xpDelta} XP`),
				h(
					'div',
					{ className: 'vc-feedback__msg' },
					renderPromptText(fb.canonicalMessage, q.sourceFile)
				)
			),
			h(
				'button',
				{
					className: 'pbtn pbtn--green pbtn--small',
					on: {
						click: () => {
							finalizeAndAdvance(q, lesson, 'correct');
						},
					},
				},
				'NEXT ▶'
			)
		);
	}

	const message = fb.personalizedMessage
		? fb.personalizedMessage
		: fb.personalizedLoading
		? 'thinking…'
		: fb.canonicalMessage;

	const messageNodes: Node[] =
		message === 'thinking…'
			? [document.createTextNode(message)]
			: renderPromptText(message, q.sourceFile);

	const showWhyBtn = !fb.personalizedRequested;

	return h(
		'div',
		{ className: 'vc-feedback vc-feedback--wrong anim-shake' },
		glitch('sad', 3),
		h(
			'div',
			{ className: 'vc-feedback__body' },
			h('div', { className: 'vc-feedback__title' }, 'NOT QUITE'),
			h('div', { className: 'vc-feedback__msg' }, messageNodes),
			h(
				'div',
				{ className: 'vc-feedback__actions' },
				showWhyBtn
					? h(
							'button',
							{
								className: 'pbtn pbtn--cyan pbtn--small',
								title: 'Ask the model to explain why your answer was wrong',
								on: {
									click: () => {
										send({
											type: 'requestWrongFeedback',
											questionId: q.id,
											userAnswerText: fb.userAnswerText,
										});
										store.updateFeedback((f) => ({
											...f,
											personalizedRequested: true,
											personalizedLoading: true,
										}));
									},
								},
							},
							'? WHY'
					  )
					: null,
				h(
					'button',
					{
						className: 'pbtn pbtn--small',
						on: {
							click: () => {
								send({ type: 'tryAgain', questionId: q.id });
								store.setFeedback(null);
								resetCurrentLessonSelection();
								store.patch({});
							},
						},
					},
					'↻ TRY AGAIN'
				),
				h(
					'button',
					{
						className: 'pbtn pbtn--ghost pbtn--small',
						on: {
							click: () => {
								finalizeAndAdvance(q, lesson, 'wrong');
							},
						},
					},
					'SKIP'
				)
			)
		)
	);
}

function finalizeAndAdvance(
	q: Question,
	lesson: ActiveLessonState,
	outcome: 'correct' | 'wrong'
): void {
	send({ type: 'finalizeQuestion', questionId: q.id, outcome });
	store.setFeedback(null);
	resetCurrentLessonSelection();
	void lesson;
}
