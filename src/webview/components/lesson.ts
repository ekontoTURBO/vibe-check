import { h } from '../dom';
import { send } from '../api';
import type {
	ActiveLessonState,
	AnswerPayload,
	FeedbackUiState,
	Question,
	ViewState,
} from '../types';
import { store } from '../store';
import { renderFeedback } from './feedback';
import { renderPromptText } from '../promptText';

interface LocalSelection {
	questionId: string;
	mc?: number;
	order?: number[];
}

let local: LocalSelection | null = null;

function ensureLocal(q: Question): LocalSelection {
	if (!local || local.questionId !== q.id) {
		local = {
			questionId: q.id,
			mc: undefined,
			order: q.type === 'code-order' ? shuffleSeq(q.correctSequence.length, q.id) : undefined,
		};
	}
	return local;
}

function shuffleSeq(length: number, seed: string): number[] {
	const arr = Array.from({ length }, (_, i) => i);
	let h = 0;
	for (let i = 0; i < seed.length; i++) {
		h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	}
	for (let i = arr.length - 1; i > 0; i--) {
		h = (h * 1664525 + 1013904223) >>> 0;
		const j = h % (i + 1);
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	if (length > 1 && arr.every((v, i) => v === i)) {
		[arr[0], arr[1]] = [arr[1], arr[0]];
	}
	return arr;
}

function questionHeader(lesson: ActiveLessonState): HTMLElement {
	const q = lesson.currentIndex + 1;
	const total = lesson.questions.length;
	const pct = (q / total) * 100;

	return h(
		'div',
		{ className: 'vc-qheader' },
		h(
			'div',
			{ className: 'vc-qheader__row' },
			h(
				'button',
				{
					className: 'vc-qheader__exit',
					on: { click: () => send({ type: 'exitLesson' }) },
				},
				'◀ EXIT'
			),
			h(
				'div',
				{ className: 'grow' },
				h(
					'div',
					{ className: 'pbar pbar--lesson', style: { height: '8px' } },
					h('div', { className: 'fill', style: { width: `${pct}%` } })
				)
			),
			h('span', { className: 'vc-qheader__counter' }, `${q}/${total}`)
		)
	);
}

function codeBlock(code: string, sourceFile?: string, lineRange?: { start: number; end: number }): HTMLElement {
	const block = h('pre', { className: 'vc-code-block' }, code);
	if (sourceFile && lineRange) {
		const showBtn = h(
			'button',
			{
				className: 'vc-code-block__show',
				on: {
					click: (ev) => {
						ev.stopPropagation();
						send({
							type: 'revealLines',
							file: sourceFile,
							startLine: lineRange.start,
							endLine: lineRange.end,
						});
					},
				},
			},
			'📍 SHOW'
		);
		block.appendChild(showBtn);
	}
	return block;
}

function renderMultipleChoice(
	q: Question & { type: 'multiple-choice' },
	feedback: FeedbackUiState | null,
	codeContext?: string
): HTMLElement {
	const showResult = !!feedback;
	const sel = ensureLocal(q);

	return h(
		'div',
		{ className: 'vc-question' },
		h('div', { className: 'vc-question__kind vc-question__kind--mc' }, '▸ MULTIPLE CHOICE'),
		h('div', { className: 'vc-question__prompt' }, renderPromptText(q.prompt, q.sourceFile)),
		codeContext
			? codeBlock(codeContext, q.sourceFile, q.lineRange)
			: null,
		h(
			'div',
			{ className: 'vc-options' },
			q.options.map((opt, i) => {
				const isSel = sel.mc === i;
				const isCorrect = i === q.correctIndex;
				let cls = 'vc-option';
				if (showResult) {
					if (isCorrect) {
						cls += ' vc-option--correct';
					} else if (isSel) {
						cls += ' vc-option--wrong';
					}
				} else if (isSel) {
					cls += ' vc-option--selected';
				}
				return h(
					'button',
					{
						className: cls,
						'data-locked': showResult ? 'true' : undefined,
						on: showResult
							? {}
							: {
									click: () => {
										sel.mc = i;
										store.patch({});
									},
							  },
					},
					h(
						'div',
						{ className: 'vc-option__chip' },
						String.fromCharCode(65 + i)
					),
					h('span', { className: 'vc-option__text' }, opt),
					showResult && isCorrect
						? h('span', { style: { color: 'var(--vc-green)', fontFamily: 'var(--pixel)', fontSize: '10px' } }, '✓')
						: null
				);
			})
		)
	);
}

function renderCodeOrder(
	q: Question & { type: 'code-order' },
	feedback: FeedbackUiState | null
): HTMLElement {
	const showResult = !!feedback;
	const sel = ensureLocal(q);
	const order = sel.order ?? Array.from({ length: q.correctSequence.length }, (_, i) => i);

	return h(
		'div',
		{ className: 'vc-question' },
		h('div', { className: 'vc-question__kind vc-question__kind--order' }, '▸ ORDER THE LINES'),
		h('div', { className: 'vc-question__prompt' }, renderPromptText(q.prompt, q.sourceFile)),
		h(
			'div',
			{ className: 'vc-order' },
			order.map((lineIdx, pos) => {
				const isCorrectPos = q.correctSequence[pos] === q.correctSequence[lineIdx];
				let rowCls = 'vc-order__row';
				if (showResult) {
					rowCls += isCorrectPos ? ' vc-order__row--correct' : ' vc-order__row--wrong';
				}
				return h(
					'div',
					{ className: rowCls },
					h('span', { className: 'vc-order__num' }, String(pos + 1)),
					h('span', { className: 'vc-order__line' }, q.correctSequence[lineIdx]),
					!showResult
						? h(
								'div',
								{ className: 'vc-order__arrows' },
								h(
									'button',
									{
										className: 'vc-order__arrow',
										disabled: pos === 0,
										on: {
											click: () => {
												if (pos === 0) {
													return;
												}
												const next = [...order];
												[next[pos], next[pos - 1]] = [next[pos - 1], next[pos]];
												sel.order = next;
												store.patch({});
											},
										},
									},
									'▲'
								),
								h(
									'button',
									{
										className: 'vc-order__arrow',
										disabled: pos === order.length - 1,
										on: {
											click: () => {
												if (pos === order.length - 1) {
													return;
												}
												const next = [...order];
												[next[pos], next[pos + 1]] = [next[pos + 1], next[pos]];
												sel.order = next;
												store.patch({});
											},
										},
									},
									'▼'
								)
						  )
						: null
				);
			})
		)
	);
}

function checkAnswer(q: Question): { correct: boolean; payload: AnswerPayload | null; userText: string } {
	if (q.type === 'multiple-choice') {
		const choice = local?.mc;
		if (typeof choice !== 'number') {
			return { correct: false, payload: null, userText: '(no selection)' };
		}
		return {
			correct: choice === q.correctIndex,
			payload: { kind: 'multiple-choice', choiceIndex: choice },
			userText: q.options[choice] ?? '(invalid)',
		};
	}
	const order = local?.order ?? Array.from({ length: q.correctSequence.length }, (_, i) => i);
	const sequence = order.map((i) => q.correctSequence[i]);
	const correct = sequence.every((line, i) => line === q.correctSequence[i]);
	return {
		correct,
		payload: { kind: 'code-order', sequence },
		userText: sequence.map((l, i) => `${i + 1}. ${l}`).join('\n'),
	};
}

function submitButton(q: Question, lesson: ActiveLessonState): HTMLElement {
	const isReady =
		q.type === 'multiple-choice'
			? typeof local?.mc === 'number'
			: q.type === 'code-order'
			? !!local?.order
			: false;
	return h(
		'div',
		{ className: 'vc-question-actions' },
		h(
			'button',
			{
				className: 'pbtn pbtn--block',
				disabled: !isReady,
				on: {
					click: () => {
						const r = checkAnswer(q);
						if (!r.payload) {
							return;
						}
						const xpDelta = r.correct ? trackXp(lesson.track) : 0;
						const correctText = correctAnswerText(q);
						const fb: FeedbackUiState = {
							questionId: q.id,
							correct: r.correct,
							canonicalMessage: q.explanation,
							personalizedMessage: null,
							personalizedLoading: false,
							personalizedRequested: false,
							userAnswerText: r.userText,
							correctAnswerText: correctText,
							xpDelta,
						};
						store.setFeedback(fb);
						send({
							type: 'submitAnswer',
							questionId: q.id,
							answer: r.payload,
							correct: r.correct,
						});
					},
				},
			},
			q.type === 'code-order' ? 'CHECK ORDER' : 'CHECK ANSWER'
		)
	);
}

function trackXp(track: ActiveLessonState['track']): number {
	switch (track) {
		case 'beginner':
			return 5;
		case 'intermediate':
			return 10;
		case 'expert':
			return 20;
	}
}

function correctAnswerText(q: Question): string {
	if (q.type === 'multiple-choice') {
		return q.options[q.correctIndex] ?? '';
	}
	return q.correctSequence.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

export function clearLessonLocalSelection(): void {
	local = null;
}

export function resetCurrentLessonSelection(): void {
	local = null;
}

export function renderLessonScreen(state: ViewState): HTMLElement | null {
	const lesson = state.activeLesson;
	if (!lesson) {
		return null;
	}
	const q = lesson.questions[lesson.currentIndex];
	if (!q) {
		return null;
	}

	const fb = state.feedback && state.feedback.questionId === q.id ? state.feedback : null;

	const codeForMC =
		q.type === 'multiple-choice' && q.lineRange && q.sourceFile
			? undefined
			: undefined;

	const body =
		q.type === 'multiple-choice'
			? renderMultipleChoice(q, fb, codeForMC)
			: renderCodeOrder(q, fb);

	const footer = fb
		? renderFeedback(fb, q, lesson)
		: submitButton(q, lesson);

	return h('div', null, questionHeader(lesson), body, footer);
}
