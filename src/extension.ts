import * as vscode from 'vscode';
import { EnvironmentDetector } from './EnvironmentDetector';
import { LLMService } from './LLMService';
import { TeacherProvider } from './TeacherProvider';
import { FSRSManager } from './FSRSManager';
import { PulseObserver, PulseEvent } from './PulseObserver';
import { SidebarView } from './SidebarView';
import { ContextGatherer } from './ContextGatherer';
import { ProviderSecrets } from './providers/secrets';
import { ProviderRegistry } from './providers/registry';
import { registerProviderCommands } from './providers/commands';
import { PROVIDER_LABELS } from './providers/types';
import { pickMixedTopics, sizeForContext } from './TeacherProvider';
import { Telemetry } from './telemetry/Telemetry';
import { maybePromptForConsent, showTelemetrySettings } from './telemetry/firstRun';
import {
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
	const host = EnvironmentDetector.host();
	console.log(`[VibeCheck] Activated in ${env} (host=${host})`);

	const telemetry = Telemetry.init(context);
	const FIRST_RUN_KEY = 'vibeCheck.firstRunActivated.v1';
	const isFirstRun = !context.globalState.get<boolean>(FIRST_RUN_KEY);
	if (isFirstRun) {
		void context.globalState.update(FIRST_RUN_KEY, true);
	}
	const lastActivationAt = context.globalState.get<number>('vibeCheck.lastActivationAt') ?? 0;
	void context.globalState.update('vibeCheck.lastActivationAt', Date.now());
	telemetry.track('extension.activated', {
		firstRun: isFirstRun,
		secondsSinceLastActivation: lastActivationAt
			? Math.floor((Date.now() - lastActivationAt) / 1000)
			: undefined,
	});
	telemetry.track('host.detected', { host, appName: vscode.env.appName ?? '' });

	// Fire the consent prompt asynchronously after a short delay so it
	// doesn't fight the welcome walkthrough for screen real-estate.
	void (async () => {
		await new Promise((r) => setTimeout(r, 2500));
		await maybePromptForConsent(telemetry);
	})();

	const secrets = new ProviderSecrets(context);
	const registry = new ProviderRegistry(secrets);
	registerProviderCommands(context, registry);

	// One-time migration of plain-text api keys (if any) into SecretStorage.
	void (async () => {
		const { migrated } = await secrets.migrateFromSettings();
		if (migrated.length > 0) {
			vscode.window.showInformationMessage(
				`Vibe Check: moved ${migrated.length} API key${migrated.length > 1 ? 's' : ''} into encrypted SecretStorage (${migrated.map((id) => PROVIDER_LABELS[id]).join(', ')}). Plain-settings entries cleared.`
			);
		}
	})();

	// First-run welcome — open the Get Started walkthrough so the user sees a guided
	// onboarding instead of having to discover the wizard via the command palette.
	void (async () => {
		const FLAG_KEY = 'vibeCheck.welcomeShown.v2';
		if (context.globalState.get<boolean>(FLAG_KEY)) {
			return;
		}
		void context.globalState.update(FLAG_KEY, true);
		// Wait briefly for the workbench to fully initialize before opening.
		await new Promise((r) => setTimeout(r, 1200));
		try {
			await vscode.commands.executeCommand(
				'workbench.action.openWalkthrough',
				{
					category: 'cognitra.vibe-check#vibeCheck.gettingStarted',
					step: 'cognitra.vibe-check#vibeCheck.gettingStarted#setup-provider',
				},
				false
			);
		} catch (err) {
			// Walkthrough API not supported by this host — fall back to the toast.
			console.warn('[VibeCheck] openWalkthrough failed, falling back to toast:', err);
			const choice = await vscode.window.showInformationMessage(
				'Welcome to Vibe Check! Set up an AI provider to start generating quizzes.',
				'Set up now',
				'Later'
			);
			if (choice === 'Set up now') {
				await vscode.commands.executeCommand('vibeCheck.configureProvider');
			}
		}
	})();

	const llm = new LLMService(registry);
	const teacher = new TeacherProvider(llm);
	const fsrs = new FSRSManager(context, telemetry);
	const pulse = new PulseObserver();
	const gatherer = new ContextGatherer();
	const sidebar = new SidebarView(context.extensionUri, fsrs, telemetry);

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
		opts?: {
			explicitCode?: string;
			explicitFile?: string;
			explicitRange?: { start: number; end: number };
			/** Auto-fired modules quiz the same code from multiple angles (one topic per lesson). */
			mixed?: boolean;
		}
	): Promise<void> => {
		if (inFlight) {
			vscode.window.showInformationMessage('Vibe Check is already generating.');
			return;
		}
		const track = fsrs.getProgress().activeTrack;
		inFlight = true;
		sidebar.setGenerating(true, topic);

		const startedAt = Date.now();
		try {
			const ctx = await gatherer.gather(topic, opts);
			const topicMix = opts?.mixed
				? pickMixedTopics(sizeForContext(ctx.content.length).lessons)
				: undefined;
			const sizing = sizeForContext(ctx.content.length);
			const source: 'manual' | 'auto-pulse' | 'selection' =
				opts?.mixed ? 'auto-pulse' : opts?.explicitCode ? 'selection' : 'manual';
			telemetry.track('module.generation_started', {
				topic,
				track,
				source,
				mixed: !!opts?.mixed,
				contextChars: ctx.content.length,
				lessonCount: sizing.lessons,
				questionsPerLesson: sizing.questionsPerLesson,
			});
			const module = await teacher.generateModuleSkeleton({
				topic,
				track,
				context: ctx.content,
				contextLabel: ctx.label,
				sourceFile: ctx.sourceFile,
				baseLine: ctx.lineRange?.start ?? 0,
				topicMix,
			});
			fsrs.addModule(module);
			lastModuleAt = Date.now();
			telemetry.track('module.generation_completed', {
				topic,
				track,
				durationMs: Date.now() - startedAt,
				lessons: module.lessons.length,
			});
			sidebar.openModule(module.id);
			vscode.window.showInformationMessage(
				`Vibe Check: created module "${module.title}" with ${module.lessons.length} lesson${module.lessons.length === 1 ? '' : 's'}.`
			);
		} catch (err) {
			const msg = (err as Error).message;
			console.error('[VibeCheck] Module generation failed:', err);
			let providerLabel = 'unknown';
			try {
				providerLabel = (await registry.resolveActive()).provider.id;
			} catch {
				// resolveActive can throw before any provider is configured — fine.
			}
			telemetry.track('module.generation_failed', {
				topic,
				track,
				provider: providerLabel,
				errorClass: (err as Error).constructor?.name ?? 'Error',
			});
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

		let questions = lesson.questions;
		if (!questions || questions.length === 0) {
			sidebar.setGenerating(true, module.topic);
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

	sidebar.setWrongFeedbackHandler(async (questionId, userAnswerText) => {
		const session = sidebar.currentSession();
		const q = session?.questions.find((qq) => qq.id === questionId);
		if (!q) {
			return 'Question expired.';
		}
		try {
			return await teacher.explainWrongAnswer(q, userAnswerText, describeCorrectAnswer(q));
		} catch (err) {
			console.error('[VibeCheck] Personalized explanation failed:', err);
			return q.explanation;
		}
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

		const lineCount = ev.insertedText.split('\n').length;
		const charCount = ev.insertedText.length;
		sidebar.notifyPulse({ chars: charCount, lines: lineCount });

		const cfg = vscode.workspace.getConfiguration('vibeCheck');
		const autoQuiz = cfg.get<boolean>('autoQuiz', true);
		telemetry.track('pulse.observed', { chars: charCount, lines: lineCount, autoQuiz });

		if (!autoQuiz) {
			const choice = await vscode.window.showInformationMessage(
				`Vibe Check: AI just inserted ${lineCount} lines. Quiz yourself?`,
				'Vibe Check Me',
				'Later'
			);
			const accepted = choice === 'Vibe Check Me';
			telemetry.track('pulse.prompted', { chars: charCount, lines: lineCount, accepted });
			if (!accepted) {
				return;
			}
		} else {
			telemetry.track('pulse.auto_fired', { chars: charCount, lines: lineCount });
			vscode.window.setStatusBarMessage(
				`$(mortar-board) Vibe Check: quizzing ${lineCount} lines…`,
				6000
			);
		}

		const codeSnippet = sliceSnippet(ev.document, ev.lineRange.start, ev.lineRange.end);
		// Auto-fire = mix topic angles (code → security → architecture → tools → code-deep)
		await generateModule('code', {
			explicitCode: codeSnippet,
			explicitFile: ev.document.fileName,
			explicitRange: ev.lineRange,
			mixed: true,
		});
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('vibeCheck.startReview', async () => {
			telemetry.track('command.invoked', { command: 'vibeCheck.startReview' });
			const track = fsrs.getProgress().activeTrack;
			const due = fsrs.dueCards(track);
			if (due.length === 0) {
				telemetry.track('review.empty', { track });
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
			telemetry.track('command.invoked', { command: 'vibeCheck.newModule' });
			sidebar.openPicker();
		}),
		vscode.commands.registerCommand('vibeCheck.quizSelection', async () => {
			telemetry.track('command.invoked', { command: 'vibeCheck.quizSelection' });
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
			telemetry.track('command.invoked', { command: 'vibeCheck.setTrack' });
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
		vscode.commands.registerCommand('vibeCheck.openWalkthrough', async () => {
			telemetry.track('command.invoked', { command: 'vibeCheck.openWalkthrough' });
			telemetry.track('walkthrough.opened', { source: 'command' });
			await vscode.commands.executeCommand(
				'workbench.action.openWalkthrough',
				'cognitra.vibe-check#vibeCheck.gettingStarted',
				false
			);
		}),
		vscode.commands.registerCommand('vibeCheck.resetProgress', async () => {
			telemetry.track('command.invoked', { command: 'vibeCheck.resetProgress' });
			const choice = await vscode.window.showWarningMessage(
				'Reset all Vibe Check progress (XP, streaks, modules, due cards)?',
				{ modal: true },
				'Reset'
			);
			if (choice === 'Reset') {
				telemetry.track('progress.reset', {});
				await fsrs.resetAll();
				sidebar.refresh();
				vscode.window.showInformationMessage('Vibe Check: progress reset.');
			}
		}),
		vscode.commands.registerCommand('vibeCheck.toggleTelemetry', async () => {
			telemetry.track('command.invoked', { command: 'vibeCheck.toggleTelemetry' });
			await showTelemetrySettings(telemetry);
		})
	);
}

export async function deactivate(): Promise<void> {
	try {
		await Telemetry.get().dispose();
	} catch {
		// Telemetry was never initialized — fine.
	}
}

function sliceSnippet(doc: vscode.TextDocument, start: number, end: number): string {
	const lastLine = doc.lineCount - 1;
	const s = Math.max(0, Math.min(start, lastLine));
	const e = Math.max(s, Math.min(end, lastLine));
	const range = new vscode.Range(s, 0, e, doc.lineAt(e).text.length);
	return doc.getText(range);
}

function describeCorrectAnswer(q: Question): string {
	if (q.type === 'multiple-choice' || q.type === 'fill-blank') {
		return q.options[q.correctIndex];
	}
	return q.correctSequence.map((l, i) => `${i + 1}. ${l}`).join('\n');
}
