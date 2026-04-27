import * as vscode from 'vscode';
import { Environment } from './types';

interface AntigravityGlobal {
	ai?: {
		generateText?: (opts: { model: string; prompt: string }) => Promise<{ text: string }>;
	};
	agent?: {
		onArtifact?: (cb: (artifact: unknown) => void) => vscode.Disposable;
	};
}

declare const antigravity: AntigravityGlobal | undefined;

export class EnvironmentDetector {
	private static cached: Environment | null = null;

	static detect(): Environment {
		if (this.cached) {
			return this.cached;
		}

		const appName = (vscode.env.appName ?? '').toLowerCase();
		const appHost = (vscode.env.appHost ?? '').toLowerCase();
		const hasAntigravityGlobal =
			typeof globalThis !== 'undefined' &&
			typeof (globalThis as Record<string, unknown>).antigravity !== 'undefined';

		const isAntigravity =
			appName.includes('antigravity') ||
			appHost.includes('antigravity') ||
			hasAntigravityGlobal;

		this.cached = isAntigravity ? 'antigravity' : 'vscode';
		return this.cached;
	}

	static getAntigravity(): AntigravityGlobal | undefined {
		const g = globalThis as Record<string, unknown>;
		return g.antigravity as AntigravityGlobal | undefined;
	}

	static reset(): void {
		this.cached = null;
	}
}
