import * as vscode from 'vscode';
import { FSRSManager } from './FSRSManager';
import { EnvironmentDetector } from './EnvironmentDetector';
import { detectCapabilities } from './ContextGatherer';
import { Telemetry } from './telemetry/Telemetry';
import {
	AnswerPayload,
	ModuleSummary,
	Module,
	ModuleLesson,
	Question,
	QuizSession,
	Topic,
	Track,
} from './types';

function buildGlowDecoration(): vscode.DecorationRenderOptions {
	return {
		backgroundColor: 'rgba(255, 215, 0, 0.18)',
		border: '1px solid rgba(255, 215, 0, 0.55)',
		borderRadius: '3px',
		overviewRulerColor: 'rgba(255, 215, 0, 0.85)',
		overviewRulerLane: vscode.OverviewRulerLane.Right,
		isWholeLine: true,
	};
}

export type FinalizeHandler = (questionId: string, outcome: 'correct' | 'wrong') => Promise<void>;
export type LessonStartHandler = (
	moduleId: string,
	lessonId: string
) => Promise<QuizSession | null>;
export type ReviewStartHandler = () => Promise<QuizSession | null>;
export type ModuleGenerateHandler = (topic: Topic) => Promise<void>;
export type TrackChangeHandler = (track: Track) => Promise<void>;
export type SessionFinishHandler = (
	session: QuizSession,
	correctCount: number
) => Promise<{ passed: boolean }>;
export type WrongFeedbackHandler = (
	questionId: string,
	userAnswerText: string
) => Promise<string>;

interface ScreenState {
	kind: 'home' | 'path' | 'lesson' | 'complete' | 'picker';
	moduleId?: string;
	complete?: { correct: number; total: number; xpEarned: number; passed: boolean };
}

interface ActiveLesson {
	module: Module;
	lesson: ModuleLesson;
	session: QuizSession;
	correctSoFar: number;
	xpEarnedSoFar: number;
	startedAt: number;
	questionStartedAt: number;
	questionAttempts: number;
}

export class SidebarView implements vscode.WebviewViewProvider {
	public static readonly viewType = 'vibeCheck.sidebar';

	private view: vscode.WebviewView | undefined;
	private screen: ScreenState = { kind: 'home' };
	private activeLesson: ActiveLesson | null = null;
	private isGenerating = false;
	private generatingTopic: Topic | undefined;
	private pulse: { chars: number; lines: number; when: number } | null = null;
	private lastError: string | null = null;

	private decoration: vscode.TextEditorDecorationType;

	private finalizeHandler: FinalizeHandler | null = null;
	private lessonStartHandler: LessonStartHandler | null = null;
	private reviewStartHandler: ReviewStartHandler | null = null;
	private generateHandler: ModuleGenerateHandler | null = null;
	private trackChangeHandler: TrackChangeHandler | null = null;
	private sessionFinishHandler: SessionFinishHandler | null = null;
	private wrongFeedbackHandler: WrongFeedbackHandler | null = null;
	private cancelGeneration: (() => void) | null = null;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly fsrs: FSRSManager,
		private readonly telemetry?: Telemetry
	) {
		this.decoration = vscode.window.createTextEditorDecorationType(buildGlowDecoration());
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};
		view.webview.html = this.renderHtml(view.webview);
		view.webview.onDidReceiveMessage((msg: ClientMessage) => this.onMessage(msg));
		void this.pushState();
	}

	setFinalizeHandler(h: FinalizeHandler): void {
		this.finalizeHandler = h;
	}
	setLessonStartHandler(h: LessonStartHandler): void {
		this.lessonStartHandler = h;
	}
	setReviewStartHandler(h: ReviewStartHandler): void {
		this.reviewStartHandler = h;
	}
	setGenerateHandler(h: ModuleGenerateHandler): void {
		this.generateHandler = h;
	}
	setTrackChangeHandler(h: TrackChangeHandler): void {
		this.trackChangeHandler = h;
	}
	setSessionFinishHandler(h: SessionFinishHandler): void {
		this.sessionFinishHandler = h;
	}
	setWrongFeedbackHandler(h: WrongFeedbackHandler): void {
		this.wrongFeedbackHandler = h;
	}
	setCancelGenerationHandler(h: (() => void) | null): void {
		this.cancelGeneration = h;
	}

	startSession(session: QuizSession): void {
		const found = this.fsrs.getLesson(session.moduleId, session.lessonId);
		if (!found && !session.isReview) {
			this.notifyError('Lesson not found.');
			return;
		}
		const now = Date.now();
		this.activeLesson = {
			module: found?.module ?? this.makeReviewShim(session),
			lesson: found?.lesson ?? this.makeReviewLessonShim(session),
			session,
			correctSoFar: 0,
			xpEarnedSoFar: 0,
			startedAt: now,
			questionStartedAt: now,
			questionAttempts: 0,
		};
		this.screen = { kind: 'lesson', moduleId: session.moduleId };
		if (session.isReview) {
			this.telemetry?.track('review.started', {
				dueCount: session.questions.length,
				track: session.track,
			});
		} else if (found) {
			this.telemetry?.track('lesson.started', {
				lessonIndex: found.lesson.index,
				questionCount: session.questions.length,
				track: session.track,
				topic: session.topic,
				isReview: false,
			});
		}
		const firstQ = session.questions[session.currentIndex];
		if (firstQ) {
			this.telemetry?.track('question.shown', {
				type: firstQ.type,
				track: session.track,
				topic: firstQ.topic,
				lessonIndex: found?.lesson.index ?? 0,
				questionIndex: session.currentIndex,
				isReview: session.isReview,
				hasCodeSnippet: !!firstQ.codeSnippet || !!firstQ.lineRange,
			});
		}
		void this.glowQuestion(firstQ, false);
		void this.pushState();
		if (this.view) {
			this.view.show?.(true);
		} else {
			void vscode.commands.executeCommand('vibeCheck.sidebar.focus');
		}
	}

	openModule(moduleId: string): void {
		this.screen = { kind: 'path', moduleId };
		void this.pushState();
	}

	openPicker(): void {
		this.screen = { kind: 'picker' };
		void this.pushState();
	}

	setGenerating(state: boolean, topic?: Topic): void {
		this.isGenerating = state;
		this.generatingTopic = topic;
		void this.pushState();
	}

	notifyError(message: string): void {
		this.lastError = message;
		void this.pushState();
	}

	notifyPulse(info: { chars: number; lines: number }): void {
		this.pulse = { ...info, when: Date.now() };
		this.screen = { kind: 'home' };
		void this.pushState();
	}

	refresh(): void {
		void this.pushState();
	}

	currentSession(): QuizSession | null {
		return this.activeLesson?.session ?? null;
	}

	private async onMessage(msg: ClientMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.telemetry?.track('sidebar.opened', {});
				await this.pushState();
				return;
			case 'setTrack':
				this.telemetry?.track('sidebar.button_clicked', { button: 'setTrack', screen: this.screen.kind });
				if (this.trackChangeHandler) {
					await this.trackChangeHandler(msg.track);
				}
				this.screen = { kind: 'home' };
				this.activeLesson = null;
				this.clearGlow();
				await this.pushState();
				return;
			case 'openModule':
				this.telemetry?.track('sidebar.button_clicked', { button: 'openModule', screen: this.screen.kind });
				{
					const m = this.fsrs.getModule(msg.moduleId);
					if (m) {
						this.telemetry?.track('module.opened', {
							lessonsTotal: m.lessons.length,
							lessonsCompleted: m.lessons.filter((l) => l.state === 'completed').length,
						});
					}
				}
				this.screen = { kind: 'path', moduleId: msg.moduleId };
				await this.pushState();
				return;
			case 'closeModule':
				this.telemetry?.track('sidebar.button_clicked', { button: 'closeModule', screen: this.screen.kind });
				this.screen = { kind: 'home' };
				await this.pushState();
				return;
			case 'deleteModule': {
				const result = this.fsrs.deleteModule(msg.moduleId);
				this.telemetry?.track('module.deleted', {
					questionsRemoved: result.questionsRemoved,
					deleted: result.deleted,
				});
				// If we were viewing the deleted module, bounce back to home.
				if (this.screen.kind === 'path' && this.screen.moduleId === msg.moduleId) {
					this.screen = { kind: 'home' };
				}
				if (this.activeLesson?.module.id === msg.moduleId) {
					this.activeLesson = null;
					this.clearGlow();
				}
				await this.pushState();
				return;
			}
			case 'cancelGeneration':
				this.cancelGeneration?.();
				return;
			case 'rateQuestion':
				this.telemetry?.track('question.rated', {
					rating: msg.rating,
					type: this.currentQuestionType() ?? 'unknown',
				});
				return;
			case 'openPicker':
				this.telemetry?.track('sidebar.picker_opened', {});
				this.screen = { kind: 'picker' };
				await this.pushState();
				return;
			case 'closePicker':
				this.telemetry?.track('sidebar.button_clicked', { button: 'closePicker', screen: this.screen.kind });
				this.screen = { kind: 'home' };
				await this.pushState();
				return;
			case 'newModule':
				this.telemetry?.track('sidebar.button_clicked', { button: 'newModule', screen: this.screen.kind });
				this.screen = { kind: 'home' };
				await this.pushState();
				if (this.generateHandler) {
					await this.generateHandler(msg.topic);
				}
				return;
			case 'startLesson': {
				this.telemetry?.track('sidebar.button_clicked', { button: 'startLesson', screen: this.screen.kind });
				if (!this.lessonStartHandler) {
					return;
				}
				const session = await this.lessonStartHandler(msg.moduleId, msg.lessonId);
				if (session) {
					this.startSession(session);
				}
				return;
			}
			case 'startReview': {
				this.telemetry?.track('sidebar.button_clicked', { button: 'startReview', screen: this.screen.kind });
				if (!this.reviewStartHandler) {
					return;
				}
				const session = await this.reviewStartHandler();
				if (session) {
					this.startSession(session);
				} else {
					this.notifyError('Nothing due on this track.');
				}
				return;
			}
			case 'submitAnswer':
				if (this.activeLesson) {
					this.activeLesson.questionAttempts++;
				}
				return;
			case 'requestWrongFeedback': {
				this.telemetry?.track('question.why_clicked', {
					type: this.currentQuestionType() ?? 'unknown',
					wasCorrect: false,
				});
				if (!this.wrongFeedbackHandler) {
					return;
				}
				try {
					const message = await this.wrongFeedbackHandler(
						msg.questionId,
						msg.userAnswerText
					);
					this.post({ type: 'wrongFeedback', questionId: msg.questionId, message });
				} catch (err) {
					console.error('[VibeCheck] wrongFeedback failed:', err);
				}
				return;
			}
			case 'tryAgain':
				this.telemetry?.track('question.tried_again', { type: this.currentQuestionType() ?? 'unknown' });
				if (this.activeLesson) {
					this.activeLesson.questionStartedAt = Date.now();
				}
				return;
			case 'finalizeQuestion': {
				if (!this.activeLesson) {
					return;
				}
				if (msg.outcome === 'correct') {
					this.activeLesson.correctSoFar++;
					this.activeLesson.xpEarnedSoFar += this.trackXp(
						this.activeLesson.session.track
					);
				}
				const session = this.activeLesson.session;
				const q = session.questions.find((qq) => qq.id === msg.questionId);
				if (q) {
					this.telemetry?.track('question.answered', {
						type: q.type,
						track: session.track,
						topic: q.topic,
						correct: msg.outcome === 'correct',
						durationMs: Date.now() - this.activeLesson.questionStartedAt,
						attempts: Math.max(1, this.activeLesson.questionAttempts),
						isReview: session.isReview,
					});
				}
				if (this.finalizeHandler) {
					await this.finalizeHandler(msg.questionId, msg.outcome);
				}
				await this.advanceSession(msg.questionId);
				await this.pushState();
				return;
			}
			case 'exitLesson':
				if (this.activeLesson) {
					const { lesson, session } = this.activeLesson;
					this.telemetry?.track('lesson.exited', {
						lessonIndex: lesson.index,
						answeredCount: session.currentIndex,
						totalQuestions: session.questions.length,
					});
				}
				this.activeLesson = null;
				this.screen = { kind: 'home' };
				this.clearGlow();
				await this.pushState();
				return;
			case 'revealLines':
				this.telemetry?.track('question.code_show_clicked', {
					type: this.currentQuestionType() ?? 'unknown',
				});
				await this.revealLines(msg.file, msg.startLine, msg.endLine);
				return;
			case 'revealSnippet':
				this.telemetry?.track('question.code_ref_clicked', {
					type: this.currentQuestionType() ?? 'unknown',
				});
				await this.revealSnippet(msg.snippet, msg.file);
				return;
			case 'openExternal': {
				// Whitelist scheme to avoid any chance of `file://` or `command:` shenanigans.
				try {
					const parsed = vscode.Uri.parse(msg.url, true);
					if (parsed.scheme !== 'https' && parsed.scheme !== 'http') {
						return;
					}
					await vscode.env.openExternal(parsed);
				} catch (err) {
					console.error('[VibeCheck] openExternal failed:', err);
				}
				return;
			}
			case 'dismissPulse':
				this.pulse = null;
				await this.pushState();
				return;
			case 'dismissError':
				this.lastError = null;
				await this.pushState();
				return;
			case 'completeAcknowledged':
				this.screen = this.screen.kind === 'complete' && this.screen.moduleId
					? { kind: 'path', moduleId: this.screen.moduleId }
					: { kind: 'home' };
				await this.pushState();
				return;
		}
	}

	private async advanceSession(answeredId: string): Promise<void> {
		if (!this.activeLesson) {
			return;
		}
		const session = this.activeLesson.session;
		const idx = session.questions.findIndex((q) => q.id === answeredId);
		if (idx === -1) {
			return;
		}
		const next = idx + 1;
		if (next >= session.questions.length) {
			const total = session.questions.length;
			const correct = this.activeLesson.correctSoFar;
			const xpEarned = this.activeLesson.xpEarnedSoFar;
			let passed = false;
			if (this.sessionFinishHandler && !session.isReview) {
				const res = await this.sessionFinishHandler(session, correct);
				passed = res.passed;
			} else {
				passed = correct >= Math.ceil(total * 0.8);
			}
			const moduleId = this.activeLesson.module.id;
			const durationMs = Date.now() - this.activeLesson.startedAt;
			if (session.isReview) {
				this.telemetry?.track('review.completed', {
					cardsReviewed: total,
					correct,
					durationMs,
					track: session.track,
				});
			} else {
				this.telemetry?.track('lesson.completed', {
					lessonIndex: this.activeLesson.lesson.index,
					correct,
					total,
					passed,
					track: session.track,
					topic: session.topic,
					durationMs,
					isReview: false,
				});
			}
			this.screen = {
				kind: 'complete',
				moduleId,
				complete: { correct, total, xpEarned, passed },
			};
			this.activeLesson = null;
			this.clearGlow();
		} else {
			session.currentIndex = next;
			this.activeLesson.questionStartedAt = Date.now();
			this.activeLesson.questionAttempts = 0;
			const q = session.questions[next];
			this.telemetry?.track('question.shown', {
				type: q.type,
				track: session.track,
				topic: q.topic,
				lessonIndex: this.activeLesson.lesson.index,
				questionIndex: next,
				isReview: session.isReview,
				hasCodeSnippet: !!q.codeSnippet || !!q.lineRange,
			});
			void this.glowQuestion(q, false);
		}
	}

	private currentQuestionType(): string | null {
		const s = this.activeLesson?.session;
		if (!s) {
			return null;
		}
		return s.questions[s.currentIndex]?.type ?? null;
	}

	private async revealSnippet(snippet: string, hint?: string): Promise<void> {
		const trimmed = snippet.trim();
		if (!trimmed) {
			return;
		}

		// Candidate files: explicit hint, then the active question's source,
		// then the active module's source, then any visible/active editor.
		const seen = new Set<string>();
		const candidates: string[] = [];
		const push = (f: string | undefined): void => {
			if (!f || seen.has(f)) {
				return;
			}
			seen.add(f);
			candidates.push(f);
		};
		push(hint);
		const session = this.activeLesson?.session;
		const currentQ = session?.questions[session.currentIndex];
		push(currentQ?.sourceFile);
		push(this.activeLesson?.module.sourceFile);
		push(vscode.window.activeTextEditor?.document.fileName);
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.scheme === 'file') {
				push(editor.document.fileName);
			}
		}

		for (const file of candidates) {
			if (await this.tryRevealSnippet(file, trimmed)) {
				return;
			}
		}

		// Workspace-wide fallback — important for topics like Architecture where the
		// question may reference content (e.g. an npm script) that lives in a closed file.
		if (await this.tryRevealInWorkspace(trimmed, seen)) {
			return;
		}

		this.notifyError(`Couldn't find "${truncate(trimmed, 40)}" anywhere in the workspace.`);
	}

	/** Scan up to 200 workspace files (skipping common build/dep dirs) for the snippet. */
	private async tryRevealInWorkspace(snippet: string, alreadyTried: Set<string>): Promise<boolean> {
		try {
			const files = await vscode.workspace.findFiles(
				'**/*',
				'{**/node_modules/**,**/dist/**,**/out/**,**/build/**,**/.git/**,**/.next/**,**/.turbo/**,**/target/**,**/__pycache__/**,**/*.lock,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.webp,**/*.ico,**/*.woff,**/*.woff2,**/*.ttf,**/*.pdf,**/*.zip}',
				200
			);
			// Prioritise small + likely-config files first (package.json, README, etc).
			const ranked = files.slice().sort((a, b) => weight(a.fsPath) - weight(b.fsPath));
			for (const uri of ranked) {
				if (alreadyTried.has(uri.fsPath)) {
					continue;
				}
				if (await this.tryRevealSnippet(uri.fsPath, snippet)) {
					return true;
				}
			}
		} catch (err) {
			console.error('[VibeCheck] workspace snippet scan failed:', err);
		}
		return false;
	}

	private async tryRevealSnippet(file: string, snippet: string): Promise<boolean> {
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const text = doc.getText();
			let idx = text.indexOf(snippet);
			if (idx === -1) {
				// Quote-style fallback: try swapping ' and "
				const swapped = swapQuotes(snippet);
				if (swapped !== snippet) {
					idx = text.indexOf(swapped);
				}
			}
			if (idx === -1) {
				return false;
			}
			const startPos = doc.positionAt(idx);
			const endPos = doc.positionAt(idx + snippet.length);
			const editor = await vscode.window.showTextDocument(doc, {
				preserveFocus: false,
				preview: false,
				viewColumn: vscode.ViewColumn.One,
			});
			const range = new vscode.Range(
				startPos.line,
				0,
				endPos.line,
				Number.MAX_SAFE_INTEGER
			);
			editor.setDecorations(this.decoration, [range]);
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			return true;
		} catch {
			return false;
		}
	}

	private async revealLines(file: string, startLine: number, endLine: number): Promise<void> {
		if (!file) {
			return;
		}
		try {
			// Wipe prior highlights first — otherwise repeat clicks on SHOW for the SAME doc
			// don't visually re-paint the new range (the old decoration sticks).
			this.clearGlow();
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const shown = await vscode.window.showTextDocument(doc, {
				preserveFocus: false,
				preview: false,
				viewColumn: vscode.ViewColumn.One,
			});
			// Prefer the current activeTextEditor — when the doc was already open, `shown` can be a
			// stale handle whose setDecorations call is silently no-op'd.
			const editor =
				vscode.window.activeTextEditor &&
				vscode.window.activeTextEditor.document.uri.toString() === doc.uri.toString()
					? vscode.window.activeTextEditor
					: shown;
			const last = doc.lineCount - 1;
			const start = Math.max(0, Math.min(startLine, last));
			const end = Math.max(start, Math.min(endLine, last));
			const range = new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER);
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			// Apply the decoration on the next tick — gives the editor time to settle after focus/scroll
			// and ensures the paint actually happens on a fresh frame.
			setTimeout(() => {
				try {
					editor.setDecorations(this.decoration, [range]);
				} catch (err) {
					console.error('[VibeCheck] setDecorations (deferred) failed:', err);
				}
			}, 0);
		} catch (err) {
			console.error('[VibeCheck] revealLines failed:', err);
		}
	}

	private async glowQuestion(q: Question | undefined, takeFocus: boolean): Promise<void> {
		if (!q || !q.sourceFile || !q.lineRange) {
			this.clearGlow();
			return;
		}

		let editor =
			vscode.window.visibleTextEditors.find((e) => e.document.fileName === q.sourceFile) ??
			null;

		if (!editor && takeFocus) {
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(q.sourceFile));
				editor = await vscode.window.showTextDocument(doc, {
					preserveFocus: false,
					preview: false,
					viewColumn: vscode.ViewColumn.One,
				});
			} catch (err) {
				console.error('[VibeCheck] Failed to open source file:', err);
				return;
			}
		}

		if (!editor) {
			return;
		}

		const last = editor.document.lineCount - 1;
		const start = Math.max(0, Math.min(q.lineRange.start, last));
		const end = Math.max(start, Math.min(q.lineRange.end, last));
		const range = new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER);
		editor.setDecorations(this.decoration, [range]);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}

	private clearGlow(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			editor.setDecorations(this.decoration, []);
		}
	}

	private makeReviewShim(session: QuizSession): Module {
		return {
			id: session.moduleId,
			title: session.title,
			topic: session.topic,
			track: session.track,
			lessons: [],
			context: '',
			contextLabel: 'review',
			baseLine: 0,
			createdAt: Date.now(),
		};
	}

	private makeReviewLessonShim(session: QuizSession): ModuleLesson {
		return {
			id: session.lessonId,
			index: 0,
			title: session.title,
			objective: 'Spaced-repetition review',
			state: 'available',
		};
	}

	private trackXp(track: Track): number {
		switch (track) {
			case 'beginner':
				return 5;
			case 'intermediate':
				return 10;
			case 'expert':
				return 20;
		}
	}

	private async pushState(): Promise<void> {
		const progress = this.fsrs.getProgress();
		const capabilities = await detectCapabilities();
		const modules = this.fsrs.listModules();
		const dueCount = this.fsrs.dueCards().length;
		const userProgress = progress.progress;

		const screen = this.computeScreen();
		const activeModule = this.computeActiveModule(modules);
		const activeLesson = this.computeActiveLesson();

		const state: ViewStatePayload = {
			screen,
			track: progress.activeTrack,
			progress: {
				xp: userProgress.xp,
				streak: userProgress.streak,
				dailyXp: userProgress.dailyXp,
				dailyGoal: this.fsrs.getDailyGoal(),
				rank: null,
				totalAnswered: userProgress.totalAnswered,
				totalCorrect: userProgress.totalCorrect,
				freezesAvailable: userProgress.freezesAvailable ?? 0,
			},
			modules,
			activeModule,
			activeLesson,
			dueCount,
			environment: EnvironmentDetector.detect(),
			isGenerating: this.isGenerating,
			generatingTopic: this.generatingTopic,
			capabilities,
			pulse: this.pulse,
			error: this.lastError,
			feedback: null,
		};
		this.post({ type: 'state', state });
	}

	private computeScreen(): ScreenPayload {
		switch (this.screen.kind) {
			case 'home':
				return { kind: 'home' };
			case 'path':
				return { kind: 'path', moduleId: this.screen.moduleId ?? '' };
			case 'lesson':
				return { kind: 'lesson' };
			case 'complete': {
				const c = this.screen.complete ?? { correct: 0, total: 0, xpEarned: 0, passed: false };
				return { kind: 'complete', ...c };
			}
			case 'picker':
				return { kind: 'picker' };
		}
	}

	private computeActiveModule(modules: ModuleSummary[]): ActiveModulePayload | null {
		if (this.screen.kind !== 'path' && this.screen.kind !== 'lesson' && this.screen.kind !== 'complete') {
			return null;
		}
		const id = this.screen.moduleId;
		if (!id) {
			return null;
		}
		const summary = modules.find((m) => m.id === id);
		if (!summary) {
			return null;
		}
		const full = this.fsrs.getModule(id);
		return {
			id: summary.id,
			title: summary.title,
			topic: summary.topic,
			track: summary.track,
			contextLabel: full?.contextLabel ?? '',
			sourceFile: full?.sourceFile,
			lessons: summary.lessons.map((l, idx) => ({
				id: full?.lessons[idx]?.id ?? `${summary.id}-l${l.index}`,
				index: l.index,
				title: l.title,
				state: l.state,
				bestScore: l.bestScore,
			})),
			completedCount: summary.completedCount,
		};
	}

	private computeActiveLesson(): ActiveLessonPayload | null {
		if (!this.activeLesson) {
			return null;
		}
		const { module, lesson, session } = this.activeLesson;
		return {
			moduleId: module.id,
			lessonId: lesson.id,
			moduleTitle: module.title,
			moduleSourceFile: module.sourceFile,
			lessonTitle: lesson.title,
			lessonObjective: lesson.objective,
			lessonIndex: lesson.index,
			totalLessons: module.lessons.length || session.questions.length,
			topic: session.topic,
			track: session.track,
			isReview: session.isReview,
			questions: session.questions,
			currentIndex: session.currentIndex,
		};
	}

	private post(msg: HostMessage): void {
		this.view?.webview.postMessage(msg);
	}

	private renderHtml(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css')
		);
		const jsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js')
		);
		const csp = [
			`default-src 'none'`,
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
			`img-src ${webview.cspSource} data:`,
		].join('; ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${cssUri}" />
<title>Vibe Check</title>
</head>
<body>
<div id="vc-root"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
	}

	dispose(): void {
		this.decoration.dispose();
	}
}

function truncate(s: string, max: number): string {
	if (s.length <= max) {
		return s;
	}
	return s.slice(0, max - 1) + '…';
}

/** Lower weight = higher priority in workspace snippet scan. */
function weight(fsPath: string): number {
	const lower = fsPath.toLowerCase();
	const name = lower.split(/[\\/]/).pop() ?? '';
	if (name === 'package.json' || name === 'readme.md') {
		return 0;
	}
	if (name === 'tsconfig.json' || name === 'cargo.toml' || name === 'pyproject.toml' || name === 'go.mod') {
		return 1;
	}
	if (/\.(json|toml|yaml|yml|md|txt|cfg|ini)$/.test(name)) {
		return 2;
	}
	if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|php|swift)$/.test(name)) {
		return 3;
	}
	return 4;
}

function swapQuotes(s: string): string {
	let out = '';
	for (const ch of s) {
		if (ch === '"') {
			out += "'";
		} else if (ch === "'") {
			out += '"';
		} else {
			out += ch;
		}
	}
	return out;
}

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 32; i++) {
		s += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return s;
}

/* =================== Webview message protocol =================== */

interface ProgressPayload {
	xp: number;
	streak: number;
	dailyXp: number;
	dailyGoal: number;
	rank: string | null;
	totalAnswered: number;
	totalCorrect: number;
	freezesAvailable: number;
}

interface ActiveModulePayload {
	id: string;
	title: string;
	topic: Topic;
	track: Track;
	contextLabel: string;
	sourceFile?: string;
	lessons: Array<{
		id: string;
		index: number;
		title: string;
		state: 'locked' | 'available' | 'completed';
		bestScore?: number;
	}>;
	completedCount: number;
}

interface ActiveLessonPayload {
	moduleId: string;
	lessonId: string;
	moduleTitle: string;
	moduleSourceFile?: string;
	lessonTitle: string;
	lessonObjective: string;
	lessonIndex: number;
	totalLessons: number;
	topic: Topic;
	track: Track;
	isReview: boolean;
	questions: Question[];
	currentIndex: number;
}

type ScreenPayload =
	| { kind: 'home' }
	| { kind: 'path'; moduleId: string }
	| { kind: 'lesson' }
	| { kind: 'complete'; correct: number; total: number; xpEarned: number; passed: boolean; moduleId?: string }
	| { kind: 'picker' };

interface ViewStatePayload {
	screen: ScreenPayload;
	track: Track;
	progress: ProgressPayload;
	modules: ModuleSummary[];
	activeModule: ActiveModulePayload | null;
	activeLesson: ActiveLessonPayload | null;
	dueCount: number;
	environment: 'antigravity' | 'vscode';
	isGenerating: boolean;
	generatingTopic?: Topic;
	capabilities: { hasActiveEditor: boolean; hasWorkspaceFolder: boolean; hasPackageJson: boolean };
	pulse: { chars: number; lines: number; when: number } | null;
	error: string | null;
	feedback: null;
}

type HostMessage =
	| { type: 'state'; state: ViewStatePayload }
	| { type: 'wrongFeedback'; questionId: string; message: string }
	| { type: 'error'; message: string };

type ClientMessage =
	| { type: 'ready' }
	| { type: 'setTrack'; track: Track }
	| { type: 'openModule'; moduleId: string }
	| { type: 'closeModule' }
	| { type: 'openPicker' }
	| { type: 'closePicker' }
	| { type: 'newModule'; topic: Topic }
	| { type: 'deleteModule'; moduleId: string }
	| { type: 'cancelGeneration' }
	| { type: 'rateQuestion'; questionId: string; rating: 'up' | 'down' }
	| { type: 'startLesson'; moduleId: string; lessonId: string }
	| { type: 'startReview' }
	| { type: 'submitAnswer'; questionId: string; answer: AnswerPayload; correct: boolean }
	| { type: 'requestWrongFeedback'; questionId: string; userAnswerText: string }
	| { type: 'tryAgain'; questionId: string }
	| { type: 'finalizeQuestion'; questionId: string; outcome: 'correct' | 'wrong' }
	| { type: 'exitLesson' }
	| { type: 'revealLines'; file: string; startLine: number; endLine: number }
	| { type: 'revealSnippet'; snippet: string; file?: string }
	| { type: 'openExternal'; url: string }
	| { type: 'dismissPulse' }
	| { type: 'dismissError' }
	| { type: 'completeAcknowledged' };
