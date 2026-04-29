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

/**
 * Finer-grained host id used by telemetry to slice metrics per fork.
 * - `vscode`     — Microsoft VS Code or @vscode/test-electron
 * - `antigravity`— Google Antigravity
 * - `cursor`     — Cursor (Anysphere)
 * - `windsurf`   — Codeium Windsurf
 * - `vscodium`   — VSCodium / open-source VS Code rebuilds
 * - `trae`       — ByteDance Trae
 * - `theia`      — Eclipse Theia-based hosts
 * - `code-server`— browser-based VS Code (coder.com / linuxserver)
 * - `unknown`    — host name didn't match any known fork
 */
export type Host =
	| 'vscode'
	| 'antigravity'
	| 'cursor'
	| 'windsurf'
	| 'vscodium'
	| 'trae'
	| 'theia'
	| 'code-server'
	| 'unknown';

export class EnvironmentDetector {
	private static cached: Environment | null = null;
	private static cachedHost: Host | null = null;

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

	/**
	 * Detects the actual editor host. More granular than `detect()` — used by
	 * telemetry so the dashboard can slice metrics by fork (Cursor vs VS Code
	 * vs VSCodium etc).
	 */
	static host(): Host {
		if (this.cachedHost) {
			return this.cachedHost;
		}

		const appName = (vscode.env.appName ?? '').toLowerCase();
		const appHost = (vscode.env.appHost ?? '').toLowerCase();
		const hasAntigravityGlobal =
			typeof globalThis !== 'undefined' &&
			typeof (globalThis as Record<string, unknown>).antigravity !== 'undefined';

		// Order matters: more-specific forks first, fall through to plain vscode.
		let host: Host;
		if (appName.includes('antigravity') || appHost.includes('antigravity') || hasAntigravityGlobal) {
			host = 'antigravity';
		} else if (appName.includes('cursor')) {
			host = 'cursor';
		} else if (appName.includes('windsurf')) {
			host = 'windsurf';
		} else if (appName.includes('codium')) {
			host = 'vscodium';
		} else if (appName.includes('trae')) {
			host = 'trae';
		} else if (appName.includes('theia')) {
			host = 'theia';
		} else if (appName.includes('code-server') || appHost === 'web') {
			host = 'code-server';
		} else if (appName.includes('visual studio code') || appName.includes('vscode')) {
			host = 'vscode';
		} else {
			host = 'unknown';
		}

		this.cachedHost = host;
		return host;
	}

	static getAntigravity(): AntigravityGlobal | undefined {
		const g = globalThis as Record<string, unknown>;
		return g.antigravity as AntigravityGlobal | undefined;
	}

	static reset(): void {
		this.cached = null;
		this.cachedHost = null;
	}
}
