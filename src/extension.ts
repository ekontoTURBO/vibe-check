import * as vscode from 'vscode';
import { EnvironmentDetector } from './EnvironmentDetector';
import { LLMService } from './LLMService';
import { TeacherProvider } from './TeacherProvider';
import { FSRSManager } from './FSRSManager';
import { PulseObserver, PulseEvent } from './PulseObserver';
import { SidebarView, GradeResult } from './SidebarView';
import { ContextGatherer } from './ContextGatherer';
import {
	AnswerPayload,
	Question,
	QuizSession,
	Topic,
	TOPICS,
	Track,
	TRACKS,
} from './types';

const QUIZ_COOLDOWN_MS = 30_000;

export function activate(context: vscode.ExtensionContext) {
	const env = EnvironmentDetector.detect();
	console.log(`[VibeCheck] Activated in ${env}`);

	const llm = new LLMService();
	const teacher = new TeacherProvider(llm);
	const fsrs = new FSRSManager(context);
	const pulse = new PulseObserver();
	const gatherer = new ContextGatherer();
	const sidebar = new SidebarView(context.extensionUri, fsrs);

	context.subscriptions.push(
		llm,
		pulse,
		sidebar,
		vscode.window.registerWebviewViewProvider(SidebarView.viewType, sidebar),
		vscode.window.onDidChangeActiveTextEditor(() => sidebar.refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => sidebar.refresh())
	);

	let lastModuleAt = 0;
	let inFlight = false;

	const generateModule = async (
		topic: Topic,
		opts?: { explicitCode?: string; explicitFile?: string; explicitRange?: { start: number; end: number } }
	): Promise<void> => {
		if (inFlight) {
			vscode.window.showInformationMessage('Vibe Check is already generating.');
			return;
		}
		const track = fsrs.getProgress().activeTrack;
		inFlight = true;
		sidebar.setGenerating(true, topic, track);

		try {
			const ctx = await gatherer.gather(topic, opts);
			const module = await teacher.generateModuleSkeleton({
				topic,
				track,
				context: ctx.content,
				contextLabel: ctx.label,
				sourceFile: ctx.sourceFile,
				baseLine: ctx.lineRange?.start ?? 0,
			});
			fsrs.addModule(module);
			lastModuleAt = Date.now();
			sidebar.refresh();
			vscode.window.showInformationMessage(
				`Vibe Check: created module "${module.title}" with 5 lessons.`
			);
		} catch (err) {
			const msg = (err as Error).message;
			console.error('[VibeCheck] Module generation failed:', err);
			sidebar.notifyError(`Module generation failed: ${msg}`);
			vscode.window.showWarningMessage(`Vibe Check: ${msg}`);
		} finally {
			inFlight = false;
			sidebar.setGenerating(false);
		}
	};

	sidebar.setTrackChangeHandler(async (track: Track) => {
		if (!TRACKS.includes(track)) {
			return;
		}
		await fsrs.setActiveTrack(track);
	});

	sidebar.setGenerateHandler(async (topic: Topic) => {
		if (!TOPICS.includes(topic)) {
			return;
		}
		await generateModule(topic);
	});

	sidebar.setLessonStartHandler(async (moduleId, lessonId): Promise<QuizSession | null> => {
		const found = fsrs.getLesson(moduleId, lessonId);
		if (!found) {
			return null;
		}
		const { module, lesson } = found;
		if (lesson.state === 'locked') {
			sidebar.notifyError('This lesson is locked. Pass the previous one first.');
			return null;
		}

		// Generate questions if missing
		let questions = lesson.questions;
		if (!questions || questions.length === 0) {
			sidebar.setGenerating(true, module.topic, module.track);
			try {
				questions = await teacher.generateLessonQuestions(module, lesson);
				fsrs.saveLessonQuestions(module.id, lesson.id, questions);
			} catch (err) {
				const msg = (err as Error).message;
				console.error('[VibeCheck] Lesson question generation failed:', err);
				sidebar.notifyError(`Couldn't generate lesson: ${msg}`);
				return null;
			} finally {
				sidebar.setGenerating(false);
			}
		}

		return {
			moduleId: module.id,
			lessonId: lesson.id,
			title: `${module.title} · ${lesson.title}`,
			topic: module.topic,
			track: module.track,
			questions,
			currentIndex: 0,
			startedAt: Date.now(),
			isReview: false,
		};
	});

	sidebar.setReviewStartHandler(async (): Promise<QuizSession | null> => {
		const track = fsrs.getProgress().activeTrack;
		const due = fsrs.dueCards(track);
		if (due.length === 0) {
			return null;
		}
		const questions = due.slice(0, 5).map((c) => c.question);
		return {
			moduleId: 'review',
			lessonId: `review-${Date.now()}`,
			title: `Review (${questions.length})`,
			topic: questions[0].topic,
			track,
			questions,
			currentIndex: 0,
			startedAt: Date.now(),
			isReview: true,
		};
	});

	sidebar.setSessionFinishHandler(async (session, correctCount) => {
		if (session.isReview) {
			return { passed: correctCount >= Math.ceil(session.questions.length * 0.8) };
		}
		return fsrs.recordLessonResult(
			session.moduleId,
			session.lessonId,
			correctCount,
			session.questions.length
		);
	});

	// Submit just checks correctness + (if wrong) generates personalized explanation.
	// FSRS grading + XP credit happen on finalize (Next / Skip).
	sidebar.setGradeHandler(async (questionId, answer): Promise<GradeResult> => {
		const session = sidebar.currentSession();
		const q = session?.questions.find((qq) => qq.id === questionId);
		if (!q) {
			return { correct: false, explanation: 'Question expired.', xpDelta: 0, correctAnswer: '' };
		}
		const correct = isAnswerCorrect(q, answer);
		const correctAnswerText = describeCorrectAnswer(q);
		let explanation = q.explanation;
		if (!correct) {
			try {
				explanation = await teacher.explainWrongAnswer(
					q,
					describeUserAnswer(q, answer),
					correctAnswerText
				);
			} catch (err) {
				console.error('[VibeCheck] Personalized explanation failed:', err);
				// Fall back to canonical explanation
			}
		}
		const xpDelta = correct ? trackXp(q.track) : 0;
		return { correct, explanation, xpDelta, correctAnswer: correctAnswerText };
	});

	sidebar.setFinalizeHandler(async (questionId, outcome) => {
		await fsrs.grade(questionId, outcome === 'correct');
	});

	pulse.onPulse(async (ev: PulseEvent) => {
		if (inFlight) {
			return;
		}
		if (Date.now() - lastModuleAt < QUIZ_COOLDOWN_MS) {
			return;
		}
		if (ev.insertedText.trim().length < 40) {
			return;
		}
		const codeSnippet = sliceSnippet(ev.document, ev.lineRange.start, ev.lineRange.end);
		await generateModule('code', {
			explicitCode: codeSnippet,
			explicitFile: ev.document.fileName,
			explicitRange: ev.lineRange,
		});
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('vibeCheck.startReview', async () => {
			const track = fsrs.getProgress().activeTrack;
			const due = fsrs.dueCards(track);
			if (due.length === 0) {
				vscode.window.showInformationMessage(
					`Vibe Check: nothing due on the ${track} track.`
				);
				return;
			}
			sidebar.startSession({
				moduleId: 'review',
				lessonId: `review-${Date.now()}`,
				title: `Review (${Math.min(5, due.length)})`,
				topic: due[0].question.topic,
				track,
				questions: due.slice(0, 5).map((c) => c.question),
				currentIndex: 0,
				startedAt: Date.now(),
				isReview: true,
			});
		}),
		vscode.commands.registerCommand('vibeCheck.newModule', async () => {
			const choice = await vscode.window.showQuickPick(
				TOPICS.map((t) => ({ label: t, description: topicDescription(t) })),
				{ placeHolder: 'Pick a module topic' }
			);
			if (!choice) {
				return;
			}
			await generateModule(choice.label as Topic);
		}),
		vscode.commands.registerCommand('vibeCheck.quizSelection', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.isEmpty) {
				vscode.window.showInformationMessage(
					'Vibe Check: select code first, then run this command.'
				);
				return;
			}
			const code = editor.document.getText(editor.selection);
			await generateModule('code', {
				explicitCode: code,
				explicitFile: editor.document.fileName,
				explicitRange: {
					start: editor.selection.start.line,
					end: editor.selection.end.line,
				},
			});
		}),
		vscode.commands.registerCommand('vibeCheck.setTrack', async () => {
			const choice = await vscode.window.showQuickPick(
				TRACKS.map((t) => ({ label: t })),
				{ placeHolder: 'Select your active track' }
			);
			if (!choice) {
				return;
			}
			await fsrs.setActiveTrack(choice.label as Track);
			sidebar.refresh();
		}),
		vscode.commands.registerCommand('vibeCheck.resetProgress', async () => {
			const choice = await vscode.window.showWarningMessage(
				'Reset all Vibe Check progress (XP, streaks, modules, due cards)?',
				{ modal: true },
				'Reset'
			);
			if (choice === 'Reset') {
				await fsrs.resetAll();
				sidebar.refresh();
				vscode.window.showInformationMessage('Vibe Check: progress reset.');
			}
		})
	);
}

export function deactivate() {}

function sliceSnippet(doc: vscode.TextDocument, start: number, end: number): string {
	const lastLine = doc.lineCount - 1;
	const s = Math.max(0, Math.min(start, lastLine));
	const e = Math.max(s, Math.min(end, lastLine));
	const range = new vscode.Range(s, 0, e, doc.lineAt(e).text.length);
	return doc.getText(range);
}

function isAnswerCorrect(q: Question, answer: AnswerPayload): boolean {
	if (q.type === 'multiple-choice' && answer.kind === 'multiple-choice') {
		return answer.choiceIndex === q.correctIndex;
	}
	if (q.type === 'code-order' && answer.kind === 'code-order') {
		if (answer.sequence.length !== q.correctSequence.length) {
			return false;
		}
		return answer.sequence.every((line, i) => line === q.correctSequence[i]);
	}
	return false;
}

function describeCorrectAnswer(q: Question): string {
	if (q.type === 'multiple-choice') {
		return q.options[q.correctIndex];
	}
	return q.correctSequence.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

function describeUserAnswer(q: Question, answer: AnswerPayload): string {
	if (q.type === 'multiple-choice' && answer.kind === 'multiple-choice') {
		const opt = q.options[answer.choiceIndex];
		return opt !== undefined ? opt : '(no selection)';
	}
	if (q.type === 'code-order' && answer.kind === 'code-order') {
		return answer.sequence.map((l, i) => `${i + 1}. ${l}`).join('\n');
	}
	return '(invalid)';
}

function trackXp(track: Question['track']): number {
	switch (track) {
		case 'beginner':
			return 5;
		case 'intermediate':
			return 10;
		case 'expert':
			return 20;
	}
}

function topicDescription(t: Topic): string {
	switch (t) {
		case 'code':
			return 'Selection or current file';
		case 'infrastructure':
			return 'Build & config files';
		case 'tools':
			return 'Dependencies and scripts';
		case 'architecture':
			return 'Project structure';
		case 'security':
			return 'Security review of current file';
	}
}
