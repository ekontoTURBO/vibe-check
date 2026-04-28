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
	fillBlank?: number;
}

let local: LocalSelection | null = null;

function ensureLocal(q: Question): LocalSelection {
	if (!local || local.questionId !== q.id) {
		local = {
			questionId: q.id,
			mc: undefined,
			order: q.type === 'code-order' ? shuffleSeq(q.correctSequence.length, q.id) : undefined,
			fillBlank: undefined,
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
	const pre = h('pre', { className: 'vc-code-block' }, code);
	if (!sourceFile || !lineRange) {
		return h('div', { className: 'vc-code-frame' }, pre);
	}
	const header = h(
		'div',
		{ className: 'vc-code-frame__bar' },
		h(
			'span',
			{ className: 'vc-code-frame__range' },
			`L${lineRange.start + 1}-${lineRange.end + 1}`
		),
		h(
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
		)
	);
	return h('div', { className: 'vc-code-frame' }, header, pre);
}

function renderMultipleChoice(
	q: Question & { type: 'multiple-choice' },
	feedback: FeedbackUiState | null
): HTMLElement {
	const showResult = !!feedback;
	const sel = ensureLocal(q);

	return h(
		'div',
		{ className: 'vc-question' },
		h('div', { className: 'vc-question__kind vc-question__kind--mc' }, '▸ MULTIPLE CHOICE'),
		h('div', { className: 'vc-question__prompt' }, renderPromptText(q.prompt, q.sourceFile)),
		q.codeSnippet ? codeBlock(q.codeSnippet, q.sourceFile, q.lineRange) : null,
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

function renderFillBlank(
	q: Question & { type: 'fill-blank' },
	feedback: FeedbackUiState | null
): HTMLElement {
	const showResult = !!feedback;
	const sel = ensureLocal(q);
	const chosenIdx = sel.fillBlank;

	const gapText = (() => {
		if (showResult) {
			return q.options[q.correctIndex] ?? '___';
		}
		if (typeof chosenIdx === 'number') {
			return q.options[chosenIdx] ?? '___';
		}
		return '___';
	})();

	const gapClass = showResult
		? 'vc-fb__gap vc-fb__gap--reveal'
		: typeof chosenIdx === 'number'
		? 'vc-fb__gap vc-fb__gap--filled'
		: 'vc-fb__gap';

	const pre = h(
		'pre',
		{ className: 'vc-code-block vc-fb__code' },
		document.createTextNode(q.codeBefore),
		h('span', { className: gapClass }, gapText),
		document.createTextNode(q.codeAfter)
	);
	const codeBlockEl =
		q.sourceFile && q.lineRange
			? h(
					'div',
					{ className: 'vc-code-frame' },
					h(
						'div',
						{ className: 'vc-code-frame__bar' },
						h(
							'span',
							{ className: 'vc-code-frame__range' },
							`L${q.lineRange.start + 1}-${q.lineRange.end + 1}`
						),
						h(
							'button',
							{
								className: 'vc-code-block__show',
								on: {
									click: (ev) => {
										ev.stopPropagation();
										send({
											type: 'revealLines',
											file: q.sourceFile!,
											startLine: q.lineRange!.start,
											endLine: q.lineRange!.end,
										});
									},
								},
							},
							'📍 SHOW'
						)
					),
					pre
			  )
			: h('div', { className: 'vc-code-frame' }, pre);

	return h(
		'div',
		{ className: 'vc-question' },
		h('div', { className: 'vc-question__kind vc-question__kind--fb' }, '▸ FILL THE BLANK'),
		h('div', { className: 'vc-question__prompt' }, renderPromptText(q.prompt, q.sourceFile)),
		codeBlockEl,
		h(
			'div',
			{ className: 'vc-options' },
			q.options.map((opt, i) => {
				const isSel = chosenIdx === i;
				const isCorrect = i === q.correctIndex;
				let cls = 'vc-option vc-option--code';
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
										sel.fillBlank = i;
										store.patch({});
									},
							  },
					},
					h('div', { className: 'vc-option__chip' }, String.fromCharCode(65 + i)),
					h('span', { className: 'vc-option__text vc-option__text--code' }, opt),
					showResult && isCorrect
						? h('span', { style: { color: 'var(--vc-green)', fontFamily: 'var(--pixel)', fontSize: '10px' } }, '✓')
						: null
				);
			})
		)
	);
}

/** HTML5 drag-and-drop reorder. Drag handle on left, drop indicator on hover, snap into place on drop. */
function renderCodeOrder(
	q: Question & { type: 'code-order' },
	feedback: FeedbackUiState | null
): HTMLElement {
	const showResult = !!feedback;
	const sel = ensureLocal(q);
	const order = sel.order ?? Array.from({ length: q.correctSequence.length }, (_, i) => i);

	const moveItem = (from: number, to: number): void => {
		if (from === to || from < 0 || to < 0 || from >= order.length || to > order.length) {
			return;
		}
		const next = [...order];
		const [moved] = next.splice(from, 1);
		next.splice(to > from ? to - 1 : to, 0, moved);
		sel.order = next;
		store.patch({});
	};

	const rows = order.map((lineIdx, pos) => {
		const isCorrectPos = q.correctSequence[pos] === q.correctSequence[lineIdx];
		let rowCls = 'vc-order__row';
		if (showResult) {
			rowCls += isCorrectPos ? ' vc-order__row--correct' : ' vc-order__row--wrong';
		}

		const row = h(
			'div',
			{
				className: rowCls,
				draggable: showResult ? false : true,
				'data-pos': String(pos),
			},
			!showResult
				? h('span', { className: 'vc-order__handle', 'aria-hidden': 'true' }, '⋮⋮')
				: null,
			h('span', { className: 'vc-order__num' }, String(pos + 1)),
			h('span', { className: 'vc-order__line' }, q.correctSequence[lineIdx])
		);

		if (showResult) {
			return row;
		}

		row.addEventListener('dragstart', (ev) => {
			row.classList.add('vc-order__row--dragging');
			if (ev.dataTransfer) {
				ev.dataTransfer.effectAllowed = 'move';
				ev.dataTransfer.setData('text/plain', String(pos));
			}
		});
		row.addEventListener('dragend', () => {
			row.classList.remove('vc-order__row--dragging');
			document
				.querySelectorAll('.vc-order__row--drop-before, .vc-order__row--drop-after')
				.forEach((el) => {
					el.classList.remove('vc-order__row--drop-before', 'vc-order__row--drop-after');
				});
		});
		row.addEventListener('dragover', (ev) => {
			ev.preventDefault();
			if (ev.dataTransfer) {
				ev.dataTransfer.dropEffect = 'move';
			}
			const rect = row.getBoundingClientRect();
			const middle = rect.top + rect.height / 2;
			row.classList.toggle('vc-order__row--drop-before', ev.clientY < middle);
			row.classList.toggle('vc-order__row--drop-after', ev.clientY >= middle);
		});
		row.addEventListener('dragleave', () => {
			row.classList.remove('vc-order__row--drop-before', 'vc-order__row--drop-after');
		});
		row.addEventListener('drop', (ev) => {
			ev.preventDefault();
			const fromStr = ev.dataTransfer?.getData('text/plain');
			row.classList.remove('vc-order__row--drop-before', 'vc-order__row--drop-after');
			if (typeof fromStr !== 'string') {
				return;
			}
			const from = Number(fromStr);
			if (Number.isNaN(from)) {
				return;
			}
			const rect = row.getBoundingClientRect();
			const middle = rect.top + rect.height / 2;
			const dropAfter = ev.clientY >= middle;
			const to = dropAfter ? pos + 1 : pos;
			moveItem(from, to);
		});

		return row;
	});

	return h(
		'div',
		{ className: 'vc-question' },
		h('div', { className: 'vc-question__kind vc-question__kind--order' }, '▸ DRAG TO REORDER'),
		h('div', { className: 'vc-question__prompt' }, renderPromptText(q.prompt, q.sourceFile)),
		h(
			'div',
			{ className: 'vc-order' + (showResult ? '' : ' vc-order--draggable') },
			rows
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
	if (q.type === 'fill-blank') {
		const choice = local?.fillBlank;
		if (typeof choice !== 'number') {
			return { correct: false, payload: null, userText: '(no selection)' };
		}
		return {
			correct: choice === q.correctIndex,
			payload: { kind: 'fill-blank', choiceIndex: choice },
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
			: q.type === 'fill-blank'
			? typeof local?.fillBlank === 'number'
			: q.type === 'code-order'
			? !!local?.order
			: false;
	const label =
		q.type === 'code-order'
			? 'CHECK ORDER'
			: q.type === 'fill-blank'
			? 'FILL IT'
			: 'CHECK ANSWER';
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
			label
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
	if (q.type === 'multiple-choice' || q.type === 'fill-blank') {
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

	const body =
		q.type === 'multiple-choice'
			? renderMultipleChoice(q, fb)
			: q.type === 'fill-blank'
			? renderFillBlank(q, fb)
			: renderCodeOrder(q, fb);

	const footer = fb
		? renderFeedback(fb, q, lesson)
		: submitButton(q, lesson);

	return h('div', null, questionHeader(lesson), body, footer);
}
