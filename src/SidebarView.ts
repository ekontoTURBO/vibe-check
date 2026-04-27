import * as vscode from 'vscode';
import { FSRSManager } from './FSRSManager';
import { EnvironmentDetector } from './EnvironmentDetector';
import { detectCapabilities } from './ContextGatherer';
import {
	AnswerPayload,
	ExtensionMessage,
	Question,
	QuizSession,
	SidebarState,
	Topic,
	Track,
	WebviewMessage,
} from './types';

const GLOW_DECORATION: vscode.DecorationRenderOptions = {
	backgroundColor: 'rgba(255, 215, 0, 0.18)',
	border: '1px solid rgba(255, 215, 0, 0.55)',
	borderRadius: '3px',
	overviewRulerColor: 'rgba(255, 215, 0, 0.85)',
	overviewRulerLane: vscode.OverviewRulerLane.Right,
	isWholeLine: true,
};

export interface GradeResult {
	correct: boolean;
	explanation: string;
	xpDelta: number;
	correctAnswer: string;
}

export type GradeHandler = (questionId: string, answer: AnswerPayload) => Promise<GradeResult>;
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

export class SidebarView implements vscode.WebviewViewProvider {
	public static readonly viewType = 'vibeCheck.sidebar';

	private view: vscode.WebviewView | undefined;
	private activeSession: QuizSession | null = null;
	private sessionCorrectCount = 0;
	private isGenerating = false;

	private decoration: vscode.TextEditorDecorationType;

	private gradeHandler: GradeHandler | null = null;
	private finalizeHandler: FinalizeHandler | null = null;
	private lessonStartHandler: LessonStartHandler | null = null;
	private reviewStartHandler: ReviewStartHandler | null = null;
	private generateHandler: ModuleGenerateHandler | null = null;
	private trackChangeHandler: TrackChangeHandler | null = null;
	private sessionFinishHandler: SessionFinishHandler | null = null;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly fsrs: FSRSManager
	) {
		this.decoration = vscode.window.createTextEditorDecorationType(GLOW_DECORATION);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		view.webview.html = this.renderHtml(view.webview);
		view.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
		void this.pushState();
	}

	setGradeHandler(h: GradeHandler): void {
		this.gradeHandler = h;
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

	startSession(session: QuizSession): void {
		this.activeSession = session;
		this.sessionCorrectCount = 0;
		this.post({ type: 'sessionStarted', session });
		void this.pushState();
		void this.glowQuestion(session.questions[session.currentIndex], false);
		if (this.view) {
			this.view.show?.(true);
		} else {
			void vscode.commands.executeCommand('vibeCheck.sidebar.focus');
		}
	}

	setGenerating(state: boolean, topic?: Topic, track?: Track): void {
		this.isGenerating = state;
		if (state && topic && track) {
			this.post({ type: 'moduleGenerating', topic, track });
		}
		void this.pushState();
	}

	notifyError(message: string): void {
		this.post({ type: 'error', message });
	}

	refresh(): void {
		void this.pushState();
	}

	private async onMessage(msg: WebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'requestState':
				await this.pushState();
				return;
			case 'glowQuestion': {
				const q = this.findQuestion(msg.questionId);
				if (q) {
					void this.glowQuestion(q, true);
				}
				return;
			}
			case 'submitAnswer': {
				if (!this.gradeHandler || !this.activeSession) {
					return;
				}
				const result = await this.gradeHandler(msg.questionId, msg.answer);
				this.post({
					type: 'feedback',
					questionId: msg.questionId,
					correct: result.correct,
					explanation: result.explanation,
					xpDelta: result.xpDelta,
					correctAnswer: result.correctAnswer,
				});
				return;
			}
			case 'finalizeQuestion': {
				if (!this.activeSession) {
					return;
				}
				if (msg.outcome === 'correct') {
					this.sessionCorrectCount++;
				}
				if (this.finalizeHandler) {
					await this.finalizeHandler(msg.questionId, msg.outcome);
				}
				await this.advanceSession(msg.questionId);
				await this.pushState();
				return;
			}
			case 'startLesson': {
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
				if (!this.reviewStartHandler) {
					return;
				}
				const session = await this.reviewStartHandler();
				if (session) {
					this.startSession(session);
				}
				return;
			}
			case 'generateModule':
				if (this.generateHandler) {
					await this.generateHandler(msg.topic);
				}
				return;
			case 'setTrack':
				if (this.trackChangeHandler) {
					await this.trackChangeHandler(msg.track);
				}
				await this.pushState();
				return;
			case 'dismissSession':
				this.activeSession = null;
				this.sessionCorrectCount = 0;
				this.clearGlow();
				await this.pushState();
				return;
		}
	}

	private async advanceSession(answeredId: string): Promise<void> {
		if (!this.activeSession) {
			return;
		}
		const idx = this.activeSession.questions.findIndex((q) => q.id === answeredId);
		if (idx === -1) {
			return;
		}
		const next = idx + 1;
		if (next >= this.activeSession.questions.length) {
			const total = this.activeSession.questions.length;
			const correct = this.sessionCorrectCount;
			let passed = false;
			if (this.sessionFinishHandler && !this.activeSession.isReview) {
				const res = await this.sessionFinishHandler(this.activeSession, correct);
				passed = res.passed;
			} else {
				passed = correct >= Math.ceil(total * 0.8);
			}
			this.post({ type: 'sessionFinished', passed, score: correct, total });
			this.activeSession = null;
			this.sessionCorrectCount = 0;
			this.clearGlow();
		} else {
			this.activeSession.currentIndex = next;
			void this.glowQuestion(this.activeSession.questions[next], false);
		}
	}

	currentSession(): QuizSession | null {
		return this.activeSession;
	}

	private findQuestion(id: string): Question | undefined {
		return this.activeSession?.questions.find((q) => q.id === id);
	}

	/**
	 * Glows the question's source range in the editor.
	 * When `takeFocus` is true (explicit user click), opens the file if needed and pulls focus.
	 * When false (automatic on session advance), only highlights if the file is already visible.
	 */
	private async glowQuestion(q: Question, takeFocus = false): Promise<void> {
		if (!q.sourceFile || !q.lineRange) {
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

		if (takeFocus && editor.document.fileName === q.sourceFile) {
			// Bring it forward when the user explicitly asked
			await vscode.window.showTextDocument(editor.document, {
				preserveFocus: false,
				preview: false,
				viewColumn: editor.viewColumn ?? vscode.ViewColumn.One,
			});
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

	private async pushState(): Promise<void> {
		const progress = this.fsrs.getProgress();
		const capabilities = await detectCapabilities();
		const state: SidebarState = {
			progress,
			activeSession: this.activeSession,
			modules: this.fsrs.listModules(progress.activeTrack),
			dueCount: this.fsrs.dueCards(progress.activeTrack).length,
			environment: EnvironmentDetector.detect(),
			isGenerating: this.isGenerating,
			capabilities,
		};
		this.post({ type: 'state', payload: state });
	}

	private post(msg: ExtensionMessage): void {
		this.view?.webview.postMessage(msg);
	}

	private renderHtml(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
:root { color-scheme: dark light; }
body {
	font-family: var(--vscode-font-family);
	color: var(--vscode-foreground);
	background: transparent;
	padding: 12px;
	margin: 0;
	font-size: 13px;
}
.tracks {
	display: flex; gap: 4px; margin-bottom: 12px;
	border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px;
}
.track-btn {
	flex: 1; background: transparent; color: var(--vscode-foreground);
	border: 1px solid var(--vscode-panel-border); padding: 6px 4px;
	border-radius: 4px; font-size: 11px; text-transform: uppercase;
	letter-spacing: 0.5px; cursor: pointer; opacity: 0.6; transition: all 0.15s;
}
.track-btn:hover { opacity: 0.9; }
.track-btn.active { opacity: 1; font-weight: 600; }
.track-btn.beginner.active { background: rgba(46, 204, 113, 0.18); border-color: #2ecc71; color: #2ecc71; }
.track-btn.intermediate.active { background: rgba(241, 196, 15, 0.18); border-color: #f1c40f; color: #f1c40f; }
.track-btn.expert.active { background: rgba(231, 76, 60, 0.18); border-color: #e74c3c; color: #e74c3c; }

.summary { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.streak { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.streak-flame { font-size: 22px; filter: drop-shadow(0 0 4px rgba(255, 140, 0, 0.45)); }
.xp { margin-left: auto; font-size: 12px; opacity: 0.85; }
.xp strong { font-size: 15px; color: var(--vscode-charts-yellow, gold); }
.env-badge {
	display: inline-block; padding: 1px 6px; border-radius: 999px;
	font-size: 9px; letter-spacing: 0.6px; text-transform: uppercase;
	background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
}

h3 {
	font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase;
	opacity: 0.65; margin: 14px 0 8px; font-weight: 600;
}

.topic-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
.topic-btn {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-panel-border);
	padding: 8px; border-radius: 4px; cursor: pointer;
	font-size: 12px; text-align: left;
	transition: all 0.1s;
}
.topic-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.topic-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.topic-btn .icon { margin-right: 4px; }

.review-btn {
	width: 100%; background: var(--vscode-button-background);
	color: var(--vscode-button-foreground); border: none;
	padding: 8px; border-radius: 4px; cursor: pointer;
	font-weight: 600; margin-bottom: 12px;
}
.review-btn:hover { opacity: 0.9; }

/* Module path */
.modules { display: flex; flex-direction: column; gap: 14px; }
.module-card {
	background: var(--vscode-list-hoverBackground, rgba(127,127,127,0.05));
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px; padding: 12px;
}
.module-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.module-title { font-weight: 600; font-size: 13px; flex: 1; }
.module-meta { font-size: 10px; opacity: 0.6; }
.topic-pill {
	display: inline-block; font-size: 9px; padding: 1px 6px;
	border-radius: 999px; background: rgba(127,127,127,0.2);
	text-transform: uppercase; letter-spacing: 0.5px;
}

.path { display: flex; flex-direction: column; gap: 0; }
.path-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.path-spine {
	display: flex; flex-direction: column; align-items: center;
	width: 36px; flex-shrink: 0;
}
.node {
	width: 32px; height: 32px; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	font-weight: 700; font-size: 13px;
	border: 2px solid var(--vscode-panel-border);
	background: var(--vscode-editor-background);
	color: var(--vscode-descriptionForeground);
	cursor: not-allowed; flex-shrink: 0;
	transition: all 0.15s;
}
.node.available {
	background: var(--vscode-button-background);
	border-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	cursor: pointer;
	box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.7);
	animation: pulse-node 2s infinite;
}
@keyframes pulse-node {
	0% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.5); }
	70% { box-shadow: 0 0 0 8px rgba(255, 215, 0, 0); }
	100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0); }
}
.node.available:hover { transform: scale(1.08); }
.node.completed {
	background: rgba(46, 204, 113, 0.85);
	border-color: rgba(46, 204, 113, 0.85);
	color: white; cursor: pointer;
}
.node.completed:hover { transform: scale(1.05); }
.node.locked { opacity: 0.5; }
.connector {
	width: 2px; height: 18px;
	background: var(--vscode-panel-border);
	margin: -2px 0;
}
.connector.completed { background: rgba(46, 204, 113, 0.5); }
.lesson-info { flex: 1; min-width: 0; }
.lesson-title { font-size: 12px; font-weight: 500; }
.lesson-state { font-size: 10px; opacity: 0.6; margin-top: 2px; }
.path-row.locked .lesson-info { opacity: 0.4; }
.path-row.available .lesson-title { color: var(--vscode-charts-yellow, gold); }

.empty-msg { font-size: 12px; opacity: 0.7; line-height: 1.5; padding: 14px 4px; text-align: center; }
.empty-msg em { color: var(--vscode-charts-yellow, gold); font-style: normal; font-weight: 500; }

/* Quiz session */
.session { display: flex; flex-direction: column; }
.session-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.session-title { flex: 1; font-weight: 600; font-size: 13px; }
.dismiss-btn { background: transparent; color: var(--vscode-foreground); border: none; cursor: pointer; font-size: 11px; opacity: 0.6; }
.dismiss-btn:hover { opacity: 1; }

.progress-pips { display: flex; gap: 3px; margin-bottom: 12px; }
.pip { flex: 1; height: 4px; border-radius: 2px; background: var(--vscode-panel-border); }
.pip.done { background: var(--vscode-charts-green, #2ecc71); }
.pip.done.wrong { background: var(--vscode-charts-red, #e74c3c); }
.pip.current { background: var(--vscode-charts-yellow, gold); }

.q-prompt { font-size: 14px; line-height: 1.5; margin-bottom: 12px; font-weight: 500; }
.q-meta { font-size: 10px; opacity: 0.6; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.show-code-btn {
	background: transparent;
	color: var(--vscode-textLink-foreground, #3794ff);
	border: 1px solid var(--vscode-panel-border);
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 10px;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	gap: 3px;
	font-family: var(--vscode-font-family);
}
.show-code-btn:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-focusBorder); }
.q-meta-info { flex: 1; }

.options { display: flex; flex-direction: column; gap: 6px; }
.option {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-panel-border);
	padding: 10px 12px; border-radius: 4px; cursor: pointer;
	text-align: left; font-size: 13px; font-family: var(--vscode-font-family);
	transition: all 0.1s;
}
.option:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); border-color: var(--vscode-focusBorder); }
.option.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
.option.correct { background: rgba(46, 204, 113, 0.18); border-color: #2ecc71; }
.option.wrong { background: rgba(231, 76, 60, 0.18); border-color: #e74c3c; }
.option:disabled { cursor: default; }

.code-area {
	background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.08));
	padding: 8px; border-radius: 4px; min-height: 60px;
	margin-bottom: 8px; display: flex; flex-direction: column; gap: 4px;
}
.code-line {
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	padding: 6px 8px; border-radius: 3px;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 12px; cursor: pointer; white-space: pre; overflow-x: auto;
}
.code-line:hover { border-color: var(--vscode-focusBorder); }
.code-line.placed { opacity: 0.45; cursor: default; }
.code-area-label { font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }

.actions { display: flex; gap: 6px; margin-top: 12px; }
button.primary {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: none; padding: 7px 14px; border-radius: 3px;
	cursor: pointer; font-size: 12px;
}
button.primary:hover:not(:disabled) { opacity: 0.9; }
button.primary:disabled { opacity: 0.4; cursor: not-allowed; }
button.secondary {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: none; padding: 7px 14px; border-radius: 3px;
	cursor: pointer; font-size: 12px;
}

.feedback { margin-top: 14px; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; }
.feedback.correct { background: rgba(46, 204, 113, 0.15); border-left: 3px solid #2ecc71; }
.feedback.wrong { background: rgba(231, 76, 60, 0.15); border-left: 3px solid #e74c3c; }
.feedback strong { display: block; margin-bottom: 4px; }
.feedback .correct-answer { font-style: italic; opacity: 0.85; margin-top: 4px; white-space: pre-wrap; }

.summary-screen {
	text-align: center; padding: 24px 12px;
}
.summary-screen .big {
	font-size: 36px; margin-bottom: 8px;
}
.summary-screen .label {
	font-size: 14px; font-weight: 600; margin-bottom: 4px;
}
.summary-screen .score { font-size: 12px; opacity: 0.7; margin-bottom: 16px; }

.generating { padding: 12px; text-align: center; font-size: 12px; opacity: 0.75; }
.generating .dot { animation: pulse 1.4s infinite; display: inline-block; }
.generating .dot:nth-child(2) { animation-delay: 0.2s; }
.generating .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }

.error-toast {
	background: rgba(231, 76, 60, 0.15);
	border-left: 3px solid #e74c3c;
	padding: 8px 10px; border-radius: 3px; margin-bottom: 10px; font-size: 12px;
}
</style>
</head>
<body>
<div class="tracks" id="tracks"></div>
<div class="summary">
	<div class="streak"><span class="streak-flame">🔥</span><span id="streak">0</span></div>
	<div class="xp"><strong id="xp">0</strong> XP</div>
	<div class="env-badge" id="env">vscode</div>
</div>
<div id="errors"></div>
<div id="content"></div>

<script nonce="${nonce}">
(function () {
const vscode = acquireVsCodeApi();
const TOPICS = [
	{ id: 'code', label: 'Code', icon: '📝', needs: 'open file' },
	{ id: 'infrastructure', label: 'Infra', icon: '🏗️', needs: 'workspace folder' },
	{ id: 'tools', label: 'Tools', icon: '🛠️', needs: 'package.json' },
	{ id: 'architecture', label: 'Arch', icon: '🧱', needs: 'workspace folder' },
	{ id: 'security', label: 'Security', icon: '🔐', needs: 'open file or workspace' }
];
const $tracks = document.getElementById('tracks');
const $streak = document.getElementById('streak');
const $xp = document.getElementById('xp');
const $env = document.getElementById('env');
const $content = document.getElementById('content');
const $errors = document.getElementById('errors');

let state = null;
let answeredQuestions = {};
let codeOrderState = {};
let mcSelection = {};
let pipResults = [];
let lastFinishedSummary = null;

function send(msg) { vscode.postMessage(msg); }

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, c =>
		({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function shuffle(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function isTopicEnabled(topic, caps) {
	switch (topic) {
		case 'code': return caps.hasActiveEditor;
		case 'infrastructure':
		case 'architecture': return caps.hasWorkspaceFolder;
		case 'tools': return caps.hasPackageJson;
		case 'security': return caps.hasActiveEditor || caps.hasWorkspaceFolder;
	}
	return true;
}

function renderTracks() {
	const tracks = ['beginner', 'intermediate', 'expert'];
	$tracks.innerHTML = tracks.map(t => {
		const cls = 'track-btn ' + t + (t === state.progress.activeTrack ? ' active' : '');
		return '<button class="' + cls + '" data-track="' + t + '">' + t + '</button>';
	}).join('');
	$tracks.querySelectorAll('.track-btn').forEach(btn => {
		btn.addEventListener('click', () => send({ type: 'setTrack', track: btn.dataset.track }));
	});
}

function renderHeader() {
	const tp = state.progress.tracks[state.progress.activeTrack];
	$streak.textContent = tp.streak;
	$xp.textContent = tp.xp;
	$env.textContent = state.environment;
}

function renderEmpty() {
	const caps = state.capabilities;
	let html = '';

	if (lastFinishedSummary) {
		const s = lastFinishedSummary;
		const emoji = s.passed ? '🎉' : '💪';
		const label = s.passed ? 'Lesson passed!' : 'Almost there';
		html += '<div class="summary-screen">';
		html += '<div class="big">' + emoji + '</div>';
		html += '<div class="label">' + label + '</div>';
		html += '<div class="score">' + s.score + ' / ' + s.total + ' correct' + (s.passed ? ' · Next lesson unlocked' : ' · Need 80% to pass — try again') + '</div>';
		html += '<button class="primary" id="closeSummary">Continue</button>';
		html += '</div>';
		$content.innerHTML = html;
		document.getElementById('closeSummary').addEventListener('click', () => {
			lastFinishedSummary = null;
			send({ type: 'requestState' });
		});
		return;
	}

	if (state.isGenerating) {
		html += '<div class="generating">Generating module<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></div>';
	}

	if (state.dueCount > 0) {
		html += '<button class="review-btn" id="reviewBtn">📚 Review (' + state.dueCount + ' due)</button>';
	}

	html += '<h3>New Module</h3>';
	html += '<div class="topic-grid">';
	for (const t of TOPICS) {
		const enabled = isTopicEnabled(t.id, caps);
		const dis = enabled ? '' : ' disabled title="needs ' + t.needs + '"';
		html += '<button class="topic-btn" data-topic="' + t.id + '"' + dis + '><span class="icon">' + t.icon + '</span>' + t.label + '</button>';
	}
	html += '</div>';

	if (state.modules.length > 0) {
		html += '<h3>Your Modules</h3><div class="modules">';
		for (const m of state.modules) {
			html += renderModule(m);
		}
		html += '</div>';
	} else if (!state.isGenerating) {
		html += '<div class="empty-msg">No modules yet on the <em>' + state.progress.activeTrack + '</em> track.<br/>Pick a topic above, or paste a chunk of AI code into a file.</div>';
	}

	$content.innerHTML = html;

	const rb = document.getElementById('reviewBtn');
	if (rb) rb.addEventListener('click', () => send({ type: 'startReview' }));

	$content.querySelectorAll('.topic-btn').forEach(b => {
		if (b.disabled) return;
		b.addEventListener('click', () => send({ type: 'generateModule', topic: b.dataset.topic }));
	});
	$content.querySelectorAll('.node[data-clickable="1"]').forEach(n => {
		n.addEventListener('click', () => {
			send({ type: 'startLesson', moduleId: n.dataset.moduleId, lessonId: n.dataset.lessonId });
		});
	});
}

function renderModule(m) {
	let html = '<div class="module-card">';
	html += '<div class="module-head">';
	html += '<span class="topic-pill">' + m.topic + '</span>';
	html += '<span class="module-title">' + escapeHtml(m.title) + '</span>';
	html += '<span class="module-meta">' + m.completedCount + '/5</span>';
	html += '</div>';
	html += '<div class="path">';
	m.lessons.forEach((l, i) => {
		const lessonId = m.id + '-l' + l.index;
		const clickable = l.state === 'available' || l.state === 'completed';
		const nodeContent = l.state === 'completed' ? '✓' : (l.state === 'locked' ? '🔒' : (l.index + 1));
		html += '<div class="path-row ' + l.state + '">';
		html += '<div class="path-spine">';
		html += '<div class="node ' + l.state + '"' +
			(clickable ? ' data-clickable="1"' : '') +
			' data-module-id="' + m.id + '" data-lesson-id="' + lessonId + '">' +
			nodeContent + '</div>';
		if (i < m.lessons.length - 1) {
			const connCls = l.state === 'completed' ? 'connector completed' : 'connector';
			html += '<div class="' + connCls + '"></div>';
		}
		html += '</div>';
		html += '<div class="lesson-info">';
		html += '<div class="lesson-title">' + escapeHtml(l.title) + '</div>';
		const stateLabel = l.state === 'completed'
			? ('Passed' + (typeof l.bestScore === 'number' ? ' · ' + Math.round(l.bestScore * 100) + '%' : ''))
			: (l.state === 'available' ? 'Tap to start' : 'Locked');
		html += '<div class="lesson-state">' + stateLabel + '</div>';
		html += '</div>';
		html += '</div>';
	});
	html += '</div>';
	html += '</div>';
	return html;
}

function renderSession() {
	const session = state.activeSession;
	const q = session.questions[session.currentIndex];
	const answered = answeredQuestions[q.id];

	const pips = session.questions.map((_, i) => {
		let cls = 'pip';
		const result = pipResults[i];
		if (result !== undefined) {
			cls += ' done' + (result.correct ? '' : ' wrong');
		} else if (i === session.currentIndex) {
			cls += ' current';
		}
		return '<div class="' + cls + '"></div>';
	}).join('');

	let html = '<div class="session">';
	html += '<div class="session-header">';
	html += '<div class="session-title">' + escapeHtml(session.title) + '</div>';
	html += '<button class="dismiss-btn" id="dismiss">✕</button>';
	html += '</div>';
	html += '<div class="progress-pips">' + pips + '</div>';
	const hasSource = !!(q.sourceFile && q.lineRange);
	const showCodeBtn = hasSource
		? '<button class="show-code-btn" id="showCodeBtn" title="Open file and highlight referenced code">📍 Show in editor</button>'
		: '';
	html += '<div class="q-meta">' +
		'<span class="q-meta-info">' + (session.currentIndex + 1) + ' / ' + session.questions.length + ' · ' + q.topic + ' · ' + q.track + '</span>' +
		showCodeBtn +
		'</div>';
	html += '<div class="q-prompt">' + escapeHtml(q.prompt) + '</div>';

	if (q.type === 'multiple-choice') {
		html += renderMC(q, answered);
	} else {
		html += renderCO(q, answered);
	}

	if (answered) {
		const cls = answered.correct ? 'feedback correct' : 'feedback wrong';
		const head = answered.correct ? 'Correct! +' + answered.xpDelta + ' XP' : 'Not quite.';
		const ca = !answered.correct
			? '<div class="correct-answer">Correct: ' + escapeHtml(answered.correctAnswer) + '</div>'
			: '';
		html += '<div class="' + cls + '"><strong>' + head + '</strong>' + escapeHtml(answered.explanation) + ca + '</div>';

		if (answered.correct) {
			html += '<div class="actions"><button class="primary" id="nextBtn">' +
				(session.currentIndex + 1 >= session.questions.length ? 'Finish' : 'Next →') + '</button></div>';
		} else {
			html += '<div class="actions">' +
				'<button class="primary" id="retryBtn">↻ Try Again</button>' +
				'<button class="secondary" id="skipBtn">Skip</button>' +
				'</div>';
		}
	}

	html += '</div>';
	$content.innerHTML = html;
	wireSession(q, answered);
}

function renderMC(q, answered) {
	const sel = mcSelection[q.id];
	let html = '<div class="options">';
	q.options.forEach((opt, i) => {
		let cls = 'option';
		if (answered) {
			if (i === q.correctIndex) cls += ' correct';
			else if (i === sel && !answered.correct) cls += ' wrong';
		} else if (sel === i) cls += ' selected';
		const dis = answered ? ' disabled' : '';
		html += '<button class="' + cls + '" data-i="' + i + '"' + dis + '>' + escapeHtml(opt) + '</button>';
	});
	html += '</div>';
	if (!answered) {
		html += '<div class="actions"><button class="primary" id="submitBtn"' + (sel === undefined ? ' disabled' : '') + '>Submit</button>';
		html += '<button class="secondary" id="skipBtn">Skip</button></div>';
	}
	return html;
}

function renderCO(q, answered) {
	if (!codeOrderState[q.id]) {
		codeOrderState[q.id] = { available: shuffle(q.correctSequence), placed: [] };
	}
	const cs = codeOrderState[q.id];
	let html = '<div class="code-area-label">Your answer (tap to remove)</div>';
	html += '<div class="code-area">';
	if (cs.placed.length === 0) {
		html += '<div style="opacity:0.5;font-size:11px;padding:6px">Tap lines below to build the sequence</div>';
	} else {
		cs.placed.forEach((line, i) => {
			html += '<div class="code-line" data-placed-i="' + i + '">' + escapeHtml(line) + '</div>';
		});
	}
	html += '</div>';
	html += '<div class="code-area-label">Available lines</div>';
	html += '<div class="code-area">';
	cs.available.forEach((line, i) => {
		const isPlaced = cs.placed.indexOf(line) !== -1;
		const cls = 'code-line' + (isPlaced ? ' placed' : '');
		html += '<div class="' + cls + '" data-avail-i="' + i + '">' + escapeHtml(line) + '</div>';
	});
	html += '</div>';
	if (answered) {
		html += '<div class="code-area-label">Correct sequence</div>';
		html += '<div class="code-area">';
		q.correctSequence.forEach(line => {
			html += '<div class="code-line">' + escapeHtml(line) + '</div>';
		});
		html += '</div>';
	} else {
		const ready = cs.placed.length === q.correctSequence.length;
		html += '<div class="actions"><button class="primary" id="submitBtn"' + (ready ? '' : ' disabled') + '>Submit</button>';
		html += '<button class="secondary" id="skipBtn">Skip</button></div>';
	}
	return html;
}

function wireSession(q, answered) {
	const dismiss = document.getElementById('dismiss');
	if (dismiss) dismiss.addEventListener('click', () => send({ type: 'dismissSession' }));

	const showCode = document.getElementById('showCodeBtn');
	if (showCode) showCode.addEventListener('click', () => {
		send({ type: 'glowQuestion', questionId: q.id });
	});

	// Next: only shown after a CORRECT answer. Finalize as correct.
	const next = document.getElementById('nextBtn');
	if (next) next.addEventListener('click', () => {
		const session = state.activeSession;
		pipResults[session.currentIndex] = { correct: true };
		send({ type: 'finalizeQuestion', questionId: q.id, outcome: 'correct' });
	});

	// Try Again: clear answer state for THIS question, re-render so user can retry.
	const retry = document.getElementById('retryBtn');
	if (retry) retry.addEventListener('click', () => {
		delete answeredQuestions[q.id];
		delete mcSelection[q.id];
		delete codeOrderState[q.id];
		renderSession();
	});

	if (q.type === 'multiple-choice') {
		document.querySelectorAll('.option').forEach(btn => {
			btn.addEventListener('click', () => {
				if (answered) return;
				mcSelection[q.id] = parseInt(btn.dataset.i, 10);
				renderSession();
			});
		});
	} else {
		document.querySelectorAll('[data-avail-i]').forEach(el => {
			el.addEventListener('click', () => {
				if (answered) return;
				const cs = codeOrderState[q.id];
				const i = parseInt(el.dataset.availI, 10);
				const line = cs.available[i];
				if (cs.placed.indexOf(line) !== -1) return;
				cs.placed.push(line);
				renderSession();
			});
		});
		document.querySelectorAll('[data-placed-i]').forEach(el => {
			el.addEventListener('click', () => {
				if (answered) return;
				const cs = codeOrderState[q.id];
				const i = parseInt(el.dataset.placedI, 10);
				cs.placed.splice(i, 1);
				renderSession();
			});
		});
	}

	const submit = document.getElementById('submitBtn');
	if (submit) submit.addEventListener('click', () => {
		// While checking, show pending state on the button
		submit.disabled = true;
		submit.textContent = 'Checking…';
		if (q.type === 'multiple-choice') {
			const sel = mcSelection[q.id];
			if (sel === undefined) return;
			send({ type: 'submitAnswer', questionId: q.id, answer: { kind: 'multiple-choice', choiceIndex: sel } });
		} else {
			const cs = codeOrderState[q.id];
			send({ type: 'submitAnswer', questionId: q.id, answer: { kind: 'code-order', sequence: cs.placed } });
		}
	});

	// Skip: appears either before any submit (give up) or after wrong (move on, finalize as wrong).
	const skip = document.getElementById('skipBtn');
	if (skip) skip.addEventListener('click', () => {
		const session = state.activeSession;
		pipResults[session.currentIndex] = { correct: false };
		send({ type: 'finalizeQuestion', questionId: q.id, outcome: 'wrong' });
	});
}

function render() {
	renderTracks();
	renderHeader();
	if (state.activeSession) {
		renderSession();
	} else {
		renderEmpty();
	}
}

window.addEventListener('message', (event) => {
	const msg = event.data;
	if (msg.type === 'state') {
		state = msg.payload;
		render();
	} else if (msg.type === 'sessionStarted') {
		answeredQuestions = {};
		codeOrderState = {};
		mcSelection = {};
		pipResults = [];
		lastFinishedSummary = null;
	} else if (msg.type === 'feedback') {
		answeredQuestions[msg.questionId] = {
			correct: msg.correct, explanation: msg.explanation,
			xpDelta: msg.xpDelta, correctAnswer: msg.correctAnswer
		};
		render();
	} else if (msg.type === 'sessionFinished') {
		lastFinishedSummary = { passed: msg.passed, score: msg.score, total: msg.total };
	} else if (msg.type === 'error') {
		const e = document.createElement('div');
		e.className = 'error-toast';
		e.textContent = msg.message;
		$errors.appendChild(e);
		setTimeout(() => e.remove(), 6000);
	}
});

send({ type: 'requestState' });
})();
</script>
</body>
</html>`;
	}

	dispose(): void {
		this.decoration.dispose();
	}
}

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 32; i++) {
		s += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return s;
}
