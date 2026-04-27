import * as vscode from 'vscode';
import { EnvironmentDetector } from './EnvironmentDetector';
import { AgentArtifact, LineRange } from './types';

export interface PulseEvent {
	document: vscode.TextDocument;
	insertedText: string;
	lineRange: LineRange;
	source: 'agent-insertion' | 'agent-artifact';
	artifact?: AgentArtifact;
}

export type PulseListener = (ev: PulseEvent) => void;

const MIN_LINES = 5;
const MIN_CHARS = 200;
const DEBOUNCE_MS = 350;

export class PulseObserver implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private listeners: PulseListener[] = [];
	private buffers = new Map<string, { text: string; range: LineRange; timer: NodeJS.Timeout }>();

	constructor() {
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(this.onChange, this)
		);

		this.hookAntigravityArtifacts();
	}

	onPulse(listener: PulseListener): vscode.Disposable {
		this.listeners.push(listener);
		return new vscode.Disposable(() => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		});
	}

	private onChange(ev: vscode.TextDocumentChangeEvent): void {
		if (ev.document.uri.scheme !== 'file') {
			return;
		}
		if (!this.looksLikeAgentEdit(ev)) {
			return;
		}

		for (const change of ev.contentChanges) {
			if (change.text.length < MIN_CHARS && change.text.split('\n').length < MIN_LINES) {
				continue;
			}

			const startLine = change.range.start.line;
			const endLine = startLine + change.text.split('\n').length - 1;

			this.bufferInsertion(ev.document, change.text, { start: startLine, end: endLine });
		}
	}

	private looksLikeAgentEdit(ev: vscode.TextDocumentChangeEvent): boolean {
		// Heuristic: AI agents typically insert >1 line in a single change without selection.
		// User typing produces single-character changes. Pastes are large but happen on user
		// action; we accept those as worth quizzing too — the user might not have read what
		// they pasted from an LLM chat window.
		return ev.contentChanges.some(
			(c) => c.text.length >= MIN_CHARS || c.text.split('\n').length >= MIN_LINES
		);
	}

	private bufferInsertion(doc: vscode.TextDocument, text: string, range: LineRange): void {
		const key = doc.uri.toString();
		const existing = this.buffers.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			existing.text += '\n' + text;
			existing.range.end = Math.max(existing.range.end, range.end);
			existing.range.start = Math.min(existing.range.start, range.start);
			existing.timer = setTimeout(() => this.flush(doc), DEBOUNCE_MS);
			return;
		}

		this.buffers.set(key, {
			text,
			range: { ...range },
			timer: setTimeout(() => this.flush(doc), DEBOUNCE_MS),
		});
	}

	private flush(doc: vscode.TextDocument): void {
		const key = doc.uri.toString();
		const buf = this.buffers.get(key);
		if (!buf) {
			return;
		}
		this.buffers.delete(key);
		this.emit({
			document: doc,
			insertedText: buf.text,
			lineRange: buf.range,
			source: 'agent-insertion',
		});
	}

	private hookAntigravityArtifacts(): void {
		if (EnvironmentDetector.detect() !== 'antigravity') {
			return;
		}
		const ag = EnvironmentDetector.getAntigravity();
		if (!ag?.agent?.onArtifact) {
			return;
		}
		try {
			const sub = ag.agent.onArtifact((raw) => {
				const artifact = this.normalizeArtifact(raw);
				const editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}
				this.emit({
					document: editor.document,
					insertedText: artifact.plan ?? '',
					lineRange: { start: 0, end: editor.document.lineCount - 1 },
					source: 'agent-artifact',
					artifact,
				});
			});
			this.disposables.push(sub);
		} catch (err) {
			console.error('[VibeCheck] Failed to hook Antigravity artifacts:', err);
		}
	}

	private normalizeArtifact(raw: unknown): AgentArtifact {
		const r = (raw ?? {}) as Record<string, unknown>;
		return {
			plan: typeof r.plan === 'string' ? r.plan : undefined,
			files: Array.isArray(r.files) ? (r.files as string[]) : undefined,
			rationale: typeof r.rationale === 'string' ? r.rationale : undefined,
			timestamp: Date.now(),
		};
	}

	private emit(ev: PulseEvent): void {
		for (const l of this.listeners) {
			try {
				l(ev);
			} catch (err) {
				console.error('[VibeCheck] Pulse listener failed:', err);
			}
		}
	}

	dispose(): void {
		for (const buf of this.buffers.values()) {
			clearTimeout(buf.timer);
		}
		this.buffers.clear();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables = [];
		this.listeners = [];
	}
}
